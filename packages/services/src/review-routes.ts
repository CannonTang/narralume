import { randomUuid } from "@narrative-lantern/domain";

import {
  DecideCanonChangeSetRequestSchema,
  DecideReviewIssueRequestSchema,
  DecideRevisionProposalRequestSchema,
  ReviewIssueDecisionSchema,
  ReviewWorkspaceSchema,
} from "@narrative-lantern/contracts";
import {
  CanonChangeSetDecisionConflictError,
  CanonChangeSetNotFoundError,
  ReviewIssueDecisionConflictError,
  ReviewIssueNotFoundError,
  RevisionProposalDecisionConflictError,
  RevisionProposalNotFoundError,
  SqliteAutomationRepository,
  SqliteProjectRepository,
  SqliteRequestReplayRepository,
  SqliteReviewRepository,
  SqliteRunRepository,
  SqliteStoryRepository,
  type NarrativeDatabase,
} from "@narrative-lantern/persistence";
import {
  SettlementApplicationError,
  SettlementApplicationService,
  SettlementConflictError,
  RevisionApplicationError,
  RevisionApplicationService,
} from "@narrative-lantern/narrative";
import { z } from "zod";

import type { RouteApp } from "@narrative-lantern/services";
import { hashRequest } from "@narrative-lantern/services";

const ProjectParamsSchema = z.object({ projectId: z.string().trim().min(1) });
const IssueParamsSchema = z.object({
  projectId: z.string().trim().min(1),
  issueId: z.string().trim().min(1),
});
const ChangeSetParamsSchema = z.object({
  projectId: z.string().trim().min(1),
  changeSetId: z.string().trim().min(1),
});
const ProposalParamsSchema = z.object({
  projectId: z.string().trim().min(1),
  proposalId: z.string().trim().min(1),
});

export function registerReviewRoutes(
  app: RouteApp,
  database: NarrativeDatabase,
  options: {
    onSettlementDecisionResolved?: () => void;
  } = {},
): void {
  const projects = new SqliteProjectRepository(database);
  const reviews = new SqliteReviewRepository(database);
  const requestReplays = new SqliteRequestReplayRepository(database);
  const settlementApplication = new SettlementApplicationService(database);
  const revisionApplication = new RevisionApplicationService(database);
  const runs = new SqliteRunRepository(database);
  const story = new SqliteStoryRepository(database);
  const automation = new SqliteAutomationRepository(database);

  app.route("GET", "/api/projects/:projectId/reviews", async (request) => {
    const { projectId } = ProjectParamsSchema.parse(request.params);
    if (!projects.get(projectId))
      throw new ReviewRouteError("project.not_found", "作品不存在", 404);
    return ReviewWorkspaceSchema.parse({
      reports: reviews.listProjectReports(projectId),
      proposals: reviews.listRevisionProposals(projectId),
    });
  });

  app.route(
    "POST",
    "/api/projects/:projectId/review-issues/:issueId/decisions",
    async (request) => {
      const { projectId, issueId } = IssueParamsSchema.parse(request.params);
      const input = DecideReviewIssueRequestSchema.parse(request.body);
      try {
        if (!projects.get(projectId)) {
          throw new ReviewRouteError("project.not_found", "作品不存在", 404);
        }
        const scope = `review-issue:${projectId}:${issueId}:decision`;
        const requestHash = hashRequest(input);
        const decision = database.transaction(() => {
          const replay = requestReplays.get(scope, input.requestId);
          if (replay) {
            if (replay.requestHash !== requestHash) {
              throw new ReviewRouteError(
                "review.issue.idempotency_conflict",
                "同一个 requestId 已用于不同的审稿裁定",
                409,
              );
            }
            return ReviewIssueDecisionSchema.parse(replay.result);
          }

          const existing = reviews.getLatestIssueDecision(projectId, issueId);
          if (existing && existing.action !== input.action) {
            throw new ReviewRouteError(
              "review.issue.already_decided",
              `审稿问题已裁定为 ${existing.action}，不能改为 ${input.action}`,
              409,
            );
          }
          const now = new Date().toISOString();
          const result = ReviewIssueDecisionSchema.parse(
            existing ??
              reviews.decideIssue({
                id: randomUuid(),
                projectId,
                issueId,
                action: input.action,
                note: input.note?.trim() || null,
                expectedStatus: input.expectedStatus,
                now,
              }),
          );
          requestReplays.insert({
            scope,
            requestId: input.requestId,
            requestHash,
            result,
            createdAt: now,
          });
          return result;
        });
        return { status: 201, body: decision };
      } catch (error) {
        if (error instanceof ReviewRouteError) throw error;
        if (error instanceof ReviewIssueNotFoundError)
          throw new ReviewRouteError(
            "review.issue.not_found",
            error.message,
            404,
          );
        if (error instanceof ReviewIssueDecisionConflictError)
          throw new ReviewRouteError(
            "review.issue.version.conflict",
            error.message,
            409,
          );
        throw error;
      }
    },
  );

  app.route(
    "GET",
    "/api/projects/:projectId/canon-change-sets",
    async (request) => {
      const { projectId } = ProjectParamsSchema.parse(request.params);
      if (!projects.get(projectId))
        throw new ReviewRouteError("project.not_found", "作品不存在", 404);
      return { changeSets: reviews.listCanonChangeSets(projectId) };
    },
  );

  app.route(
    "POST",
    "/api/projects/:projectId/canon-change-sets/:changeSetId/decisions",
    async (request) => {
      const { projectId, changeSetId } = ChangeSetParamsSchema.parse(
        request.params,
      );
      const decision = DecideCanonChangeSetRequestSchema.parse(request.body);
      try {
        if (!projects.get(projectId)) {
          throw new ReviewRouteError("project.not_found", "作品不存在", 404);
        }
        const scope = `canon-change-set:${projectId}:${changeSetId}:decision`;
        const requestHash = hashRequest(decision);
        const outcome = database.transaction(() => {
          const replay = requestReplays.get(scope, decision.requestId);
          if (replay) {
            if (replay.requestHash !== requestHash) {
              throw new ReviewRouteError(
                "canon_change_set.idempotency_conflict",
                "同一个 requestId 已用于不同的故事变化裁定",
                409,
              );
            }
            return {
              result: replay.result,
              resumed: resolveSettlementDecision(
                projectId,
                changeSetId,
                reviews,
                runs,
                story,
                automation,
              ),
            };
          }

          const current = reviews.getCanonChangeSet(projectId, changeSetId);
          if (current && current.status !== "candidate") {
            const sameDecision =
              (current.status === "applied" && decision.action === "apply") ||
              (current.status === "rejected" && decision.action === "reject");
            if (!sameDecision) {
              throw new ReviewRouteError(
                "canon_change_set.already_decided",
                `故事变化已处于 ${current.status}，不能执行 ${decision.action}`,
                409,
              );
            }
            const result = { changeSet: current };
            requestReplays.insert({
              scope,
              requestId: decision.requestId,
              requestHash,
              result,
              createdAt: new Date().toISOString(),
            });
            return {
              result,
              resumed: resolveSettlementDecision(
                projectId,
                changeSetId,
                reviews,
                runs,
                story,
                automation,
              ),
            };
          }

          let result;
          if (decision.action === "reject") {
            result = {
              changeSet: settlementApplication.reject({
                projectId,
                changeSetId,
                expectedStatus: "candidate",
              }),
            };
          } else {
            result = settlementApplication.apply({
              projectId,
              changeSetId,
              conflictPolicy: decision.conflictPolicy,
            });
          }
          requestReplays.insert({
            scope,
            requestId: decision.requestId,
            requestHash,
            result,
            createdAt: new Date().toISOString(),
          });
          return {
            result,
            resumed: resolveSettlementDecision(
              projectId,
              changeSetId,
              reviews,
              runs,
              story,
              automation,
            ),
          };
        });
        if (outcome.resumed) options.onSettlementDecisionResolved?.();
        return outcome.result;
      } catch (error) {
        if (error instanceof ReviewRouteError) throw error;
        if (error instanceof CanonChangeSetNotFoundError)
          throw new ReviewRouteError(
            "canon_change_set.not_found",
            error.message,
            404,
          );
        if (error instanceof CanonChangeSetDecisionConflictError)
          throw new ReviewRouteError(
            "canon_change_set.version_conflict",
            error.message,
            409,
          );
        if (error instanceof SettlementConflictError)
          throw new ReviewRouteError(
            error.code,
            "这些故事变化与当前正典存在冲突",
            409,
            {
              conflicts: error.conflicts,
              forceAllowed: error.conflicts.every((conflict) =>
                ["target_locked", "status_changed"].includes(conflict.reason),
              ),
            },
          );
        if (error instanceof SettlementApplicationError)
          throw new ReviewRouteError(error.code, error.message, 422);
        throw error;
      }
    },
  );

  app.route(
    "POST",
    "/api/projects/:projectId/revision-proposals/:proposalId/decisions",
    async (request) => {
      const { projectId, proposalId } = ProposalParamsSchema.parse(
        request.params,
      );
      const decision = DecideRevisionProposalRequestSchema.parse(request.body);
      try {
        if (!projects.get(projectId)) {
          throw new ReviewRouteError("project.not_found", "作品不存在", 404);
        }
        const scope = `revision-proposal:${projectId}:${proposalId}:decision`;
        const requestHash = hashRequest(decision);
        return database.transaction(() => {
          const replay = requestReplays.get(scope, decision.requestId);
          if (replay) {
            if (replay.requestHash !== requestHash) {
              throw new ReviewRouteError(
                "revision_proposal.idempotency_conflict",
                "同一个 requestId 已用于不同的修订提案裁定",
                409,
              );
            }
            return replay.result;
          }

          const current = reviews.getRevisionProposal(projectId, proposalId);
          if (current && current.status !== "proposed") {
            const sameDecision =
              (current.status === "accepted" && decision.action === "apply") ||
              (current.status === "rejected" && decision.action === "reject");
            if (!sameDecision) {
              throw new ReviewRouteError(
                "revision_proposal.already_decided",
                `修订提案已处于 ${current.status}，不能执行 ${decision.action}`,
                409,
              );
            }
            const result = { proposal: current };
            requestReplays.insert({
              scope,
              requestId: decision.requestId,
              requestHash,
              result,
              createdAt: new Date().toISOString(),
            });
            return result;
          }

          const result =
            decision.action === "apply"
              ? revisionApplication.apply({ projectId, proposalId })
              : {
                  proposal: revisionApplication.reject({
                    projectId,
                    proposalId,
                  }),
                };
          requestReplays.insert({
            scope,
            requestId: decision.requestId,
            requestHash,
            result,
            createdAt: new Date().toISOString(),
          });
          return result;
        });
      } catch (error) {
        if (error instanceof ReviewRouteError) throw error;
        if (error instanceof RevisionProposalNotFoundError)
          throw new ReviewRouteError(
            "revision_proposal.not_found",
            error.message,
            404,
          );
        if (error instanceof RevisionProposalDecisionConflictError)
          throw new ReviewRouteError(
            "revision_proposal.version_conflict",
            error.message,
            409,
          );
        if (error instanceof RevisionApplicationError)
          throw new ReviewRouteError(
            error.code,
            error.message,
            error.code.endsWith("not_found") ? 404 : 409,
          );
        throw error;
      }
    },
  );
}

export class ReviewRouteError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ReviewRouteError";
  }
}

function resolveSettlementDecision(
  projectId: string,
  changeSetId: string,
  reviews: SqliteReviewRepository,
  runs: SqliteRunRepository,
  story: SqliteStoryRepository,
  automation: SqliteAutomationRepository,
): boolean {
  const changeSet = reviews.getCanonChangeSet(projectId, changeSetId);
  if (!changeSet || !["applied", "rejected"].includes(changeSet.status)) {
    return false;
  }
  const snapshot = runs.getSnapshot(changeSet.runId);
  if (
    snapshot.run.status !== "awaiting_user" ||
    latestRunReason(snapshot) !== "settlement_conflict_requires_resolution"
  ) {
    return false;
  }
  const now = new Date().toISOString();
  runs.mergePolicy(changeSet.runId, { settlementConflictResolved: true }, now);
  if (snapshot.run.targetOutlineNodeId) {
    story.updateOutlineStatus(
      projectId,
      snapshot.run.targetOutlineNodeId,
      "committed",
      now,
    );
  }
  runs.resume(changeSet.runId, now);
  const link = automation.findRunLink(changeSet.runId);
  if (link) {
    const session = automation.requireSession(link.sessionId);
    if (session.status === "awaiting_user") {
      automation.resumeSession(session.id, now);
    }
  }
  return true;
}

function latestRunReason(
  snapshot: ReturnType<SqliteRunRepository["getSnapshot"]>,
): string | null {
  const event = [...snapshot.events]
    .reverse()
    .find((candidate) => candidate.type === `run.${snapshot.run.status}`);
  return typeof event?.payload.reason === "string"
    ? event.payload.reason
    : null;
}
