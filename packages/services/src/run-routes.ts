import {
  AdvanceRunRequestSchema,
  AdoptRunStreamRequestSchema,
  AdoptRunStreamResponseSchema,
  ChapterRunCreatedSchema,
  ContinueRunStreamRequestSchema,
  CreateChapterRunRequestSchema,
  CreateDocumentReviewRequestSchema,
  DiscardRunStreamRequestSchema,
  DocumentReviewRunCreatedSchema,
  EffectivePolicySchema,
  NarrativeRunSchema,
  RegenerateRunStreamRequestSchema,
  RegenerateRunStreamResponseSchema,
  RequestedRevisionRunCreatedSchema,
  RunActionRequestSchema,
  RunDetailSchema,
  RunSnapshotSchema,
} from "@narrative-lantern/contracts";
import {
  createDocument,
  type NarrativeRunStep,
} from "@narrative-lantern/domain";
import {
  buildDocumentReviewRecipe,
  compileChapterRecipeTemplate,
} from "@narrative-lantern/harness";
import {
  SqliteAssignmentRepository,
  SqliteAutomationRepository,
  SqliteContextReceiptRepository,
  SqliteDocumentRepository,
  SqliteLlmCallRepository,
  SqliteModelAssignmentSnapshotRepository,
  SqliteProjectRepository,
  SqliteReviewRepository,
  SqliteRunRepository,
  SqliteRunStreamRepository,
  SqliteStoryRepository,
  SqliteTemplateRepository,
  type NarrativeDatabase,
  type RunStepSeedInput,
} from "@narrative-lantern/persistence";
import {
  computeSetupHint,
  deterministicRequestId,
  deterministicUuid,
  hashRequest,
  isRecord,
  isTerminalSessionStatus,
  requireAwaitReason,
  requireRunInProject,
  requireViablePartial,
  requireWritingAssignment,
  requestManuscriptRevision,
  runProductProjection,
  withRuntimeModelPolicy,
  extractEffectivePolicy,
} from "@narrative-lantern/services";
import { z } from "zod";

import type { RunCoordinator, RouteApp } from "@narrative-lantern/services";
import { RunRouteError } from "./route-error.js";

const ProjectParamsSchema = z.object({ projectId: z.string().trim().min(1) });
const DocumentParamsSchema = z.object({
  projectId: z.string().trim().min(1),
  documentId: z.string().trim().min(1),
});
const RunParamsSchema = z.object({ runId: z.string().trim().min(1) });
const RunProjectQuerySchema = z.object({
  projectId: z.string().trim().min(1),
});

export interface RegisterRunRouteOptions {
  coordinator: RunCoordinator;
  enableBackgroundWorker: boolean;
  environment: Readonly<Record<string, string | undefined>>;
}

export function registerRunRoutes(
  app: RouteApp,
  database: NarrativeDatabase,
  options: RegisterRunRouteOptions,
): void {
  const projects = new SqliteProjectRepository(database);
  const story = new SqliteStoryRepository(database);
  const runs = new SqliteRunRepository(database);
  const calls = new SqliteLlmCallRepository(database);
  const contextReceipts = new SqliteContextReceiptRepository(database);
  const modelSnapshots = new SqliteModelAssignmentSnapshotRepository(database);
  const reviews = new SqliteReviewRepository(database);
  const streams = new SqliteRunStreamRepository(database);
  const templates = new SqliteTemplateRepository(database);
  const automation = new SqliteAutomationRepository(database);

  app.route(
    "POST",
    "/api/projects/:projectId/runs/chapter",
    async (request) => {
      const { projectId } = ProjectParamsSchema.parse(request.params);
      if (!projects.get(projectId)) {
        throw new RunRouteError("project.not_found", "作品不存在", 404);
      }
      const input = CreateChapterRunRequestSchema.parse(request.body);
      const requestHash = hashRequest(input);
      const runId = deterministicRequestId(
        "chapter-run",
        projectId,
        input.requestId,
      );
      const replay = runs.getRun(runId) ? runs.getSnapshot(runId) : null;
      if (replay) {
        if (replay.run.policy.creationRequestHash !== requestHash) {
          throw new RunRouteError(
            "chapter.run.idempotency_conflict",
            "同一个 requestId 已用于不同的章节任务请求",
            409,
          );
        }
        const setupHint = computeSetupHint(
          new SqliteAssignmentRepository(database),
        );
        return {
          status: 202,
          body: ChapterRunCreatedSchema.parse({
            ...replay,
            ...runProductProjection(replay),
            effectivePolicy: EffectivePolicySchema.parse(replay.run.policy),
            idempotentReplay: true,
            ...(setupHint ? { setupHint } : {}),
          }),
        };
      }
      const target = story.requireOutlineNode(
        projectId,
        input.targetOutlineNodeId,
      );
      if (target.kind !== "chapter") {
        throw new RunRouteError(
          "run.target.not_chapter",
          "章节生产只能选择 chapter 类型的大纲节点",
          422,
        );
      }
      const activeSession = automation
        .listSessions(projectId)
        .find((session) => !isTerminalSessionStatus(session.status));
      if (activeSession) {
        throw new RunRouteError(
          "project.writing_task.active",
          `作品已有进行中的快速创作任务：${activeSession.id}`,
          409,
        );
      }
      const activeRun = runs
        .listActiveRuns(projectId)
        .find((candidate) => candidate.targetOutlineNodeId !== null);
      if (activeRun) {
        throw new RunRouteError(
          "project.writing_task.active",
          `作品已有进行中的章节任务：${activeRun.id}`,
          409,
        );
      }
      requireWritingAssignment(database, options.environment);
      const template = templates.getByKey("recipe.chapter-production");
      if (!template)
        throw new RunRouteError(
          "recipe.template.missing",
          "章节生产配方模板不存在",
          500,
        );
      const recipe = compileChapterRecipeTemplate(
        runId,
        template.effectiveContent,
        input.maxRevisionCycles,
        template.version,
      );
      const policy = withRuntimeModelPolicy(
        {
          ...input.policy,
          planningMode: input.planningMode,
          origin: input.origin,
          creationRequestId: input.requestId,
          creationRequestHash: requestHash,
        },
        options.environment,
      );
      const snapshot = runs.create({
        id: runId,
        projectId,
        recipe: recipe.name,
        recipeVersion: recipe.version,
        mode: "chapter-gate",
        targetOutlineNodeId: target.id,
        policy,
        steps: recipe.steps,
        now: new Date().toISOString(),
      });
      if (options.enableBackgroundWorker) options.coordinator.wake();
      const setupHint = computeSetupHint(
        new SqliteAssignmentRepository(database),
      );
      return {
        status: 202,
        body: ChapterRunCreatedSchema.parse({
          ...snapshot,
          ...runProductProjection(snapshot),
          effectivePolicy: EffectivePolicySchema.parse(policy),
          idempotentReplay: false,
          ...(setupHint ? { setupHint } : {}),
        }),
      };
    },
  );

  app.route(
    "POST",
    "/api/projects/:projectId/documents/:documentId/reviews",
    async (request) => {
      const { projectId, documentId } = DocumentParamsSchema.parse(
        request.params,
      );
      if (!projects.get(projectId)) {
        throw new RunRouteError("project.not_found", "作品不存在", 404);
      }
      const input = CreateDocumentReviewRequestSchema.parse(request.body);
      const requestHash = hashRequest(input);
      const runId = deterministicRequestId(
        "document-review-run",
        projectId,
        input.requestId,
      );
      const replay = runs.getRun(runId) ? runs.getSnapshot(runId) : null;
      if (replay) {
        if (replay.run.policy.creationRequestHash !== requestHash) {
          throw new RunRouteError(
            "document.review.idempotency_conflict",
            "同一个 requestId 已用于不同的审稿请求",
            409,
          );
        }
        const setupHint = computeSetupHint(
          new SqliteAssignmentRepository(database),
        );
        return {
          status: 202,
          body: DocumentReviewRunCreatedSchema.parse({
            ...replay,
            ...runProductProjection(replay),
            effectivePolicy: EffectivePolicySchema.parse(replay.run.policy),
            idempotentReplay: true,
            ...(setupHint ? { setupHint } : {}),
          }),
        };
      }
      const document = new SqliteDocumentRepository(database).get(
        projectId,
        documentId,
      );
      if (!document) {
        throw new RunRouteError("document.not_found", "稿件不存在", 404);
      }
      if (document.kind !== "chapter" || !document.outlineNodeId) {
        throw new RunRouteError(
          "document.review.not_chapter",
          "只有绑定章节大纲的正文可以审稿",
          422,
        );
      }
      if (document.currentVersionId !== input.documentVersionId) {
        throw new RunRouteError(
          "document.version.conflict",
          "正文已有更新，请刷新后审阅最新版本",
          409,
        );
      }
      const version = new SqliteDocumentRepository(database).getVersion(
        projectId,
        documentId,
        input.documentVersionId,
      );
      if (!version) {
        throw new RunRouteError(
          "document.version.not_found",
          "正文版本不存在",
          404,
        );
      }
      requireWritingAssignment(database, options.environment);
      const recipe = buildDocumentReviewRecipe(runId);
      const policy = withRuntimeModelPolicy(
        {
          ...input.policy,
          documentId,
          documentVersionId: version.id,
          origin: input.origin ?? ({ surface: "writing", documentId } as const),
          creationRequestId: input.requestId,
          creationRequestHash: requestHash,
        },
        options.environment,
      );
      const snapshot = runs.create({
        id: runId,
        projectId,
        recipe: recipe.name,
        recipeVersion: recipe.version,
        mode: "manual",
        targetOutlineNodeId: document.outlineNodeId,
        policy,
        steps: recipe.steps,
        now: new Date().toISOString(),
      });
      if (options.enableBackgroundWorker) options.coordinator.wake();
      const setupHint = computeSetupHint(
        new SqliteAssignmentRepository(database),
      );
      return {
        status: 202,
        body: DocumentReviewRunCreatedSchema.parse({
          ...snapshot,
          ...runProductProjection(snapshot),
          effectivePolicy: EffectivePolicySchema.parse(policy),
          idempotentReplay: false,
          ...(setupHint ? { setupHint } : {}),
        }),
      };
    },
  );

  app.route("GET", "/api/projects/:projectId/runs", async (request) => {
    const { projectId } = ProjectParamsSchema.parse(request.params);
    if (!projects.get(projectId)) {
      throw new RunRouteError("project.not_found", "作品不存在", 404);
    }
    return runs.listRuns(projectId).map((run) => NarrativeRunSchema.parse(run));
  });

  app.route("GET", "/api/runs/:runId", async (request) => {
    const { runId } = RunParamsSchema.parse(request.params);
    const { projectId } = RunProjectQuerySchema.parse(request.query);
    const snapshot = requireRunInProject(runs, runId, projectId);
    const runStreams = streams.listForRun(runId);
    const link = automation.findRunLink(runId);
    const parentTask = link
      ? { kind: "autopilot" as const, id: link.sessionId }
      : null;
    return RunDetailSchema.parse({
      ...snapshot,
      ...runProductProjection(snapshot, runStreams, { parentTask }),
      parentTask,
      llmCalls: calls.listForRun(runId),
      contextReceipts: contextReceipts.listForRun(runId),
      modelSnapshots: modelSnapshots.listForRun(runId),
      reviews: reviews.listReports(runId),
      streams: runStreams,
      effectivePolicy: extractEffectivePolicy(snapshot.run.policy),
    });
  });

  app.route("POST", "/api/runs/:runId/actions", async (request) => {
    const { runId } = RunParamsSchema.parse(request.params);
    const input = RunActionRequestSchema.parse(request.body);
    requireRunInProject(runs, runId, input.projectId, projects);
    if (input.action === "request_revision") {
      const result = requestManuscriptRevision(database, {
        sourceRunId: runId,
        requestId: input.requestId,
        instruction: input.instruction,
        now: new Date().toISOString(),
      });
      if (options.enableBackgroundWorker) options.coordinator.wake();
      const setupHint = computeSetupHint(
        new SqliteAssignmentRepository(database),
      );
      return {
        status: 202,
        body: RequestedRevisionRunCreatedSchema.parse({
          ...result.snapshot,
          ...runProductProjection(result.snapshot),
          effectivePolicy: EffectivePolicySchema.parse(
            result.snapshot.run.policy,
          ),
          idempotentReplay: result.idempotentReplay,
          ...(setupHint ? { setupHint } : {}),
        }),
      };
    }
    if (input.action === "retry_chapter") {
      const owner = automation.findRunLink(runId);
      if (owner) {
        throw new RunRouteError(
          "run.retry.owned_by_autopilot",
          `本章由快速创作任务 ${owner.sessionId} 管理，请在该任务中重试或调整流程`,
          409,
        );
      }
      const source = requireRunInProject(
        runs,
        runId,
        input.projectId,
        projects,
      ).run;
      if (
        source.status !== "failed" ||
        source.recipe !== "chapter-production"
      ) {
        throw new RunRouteError(
          "run.retry.not_failed_chapter",
          "只有失败的章节任务可以重试本章",
          409,
        );
      }
      const targetId = source.targetOutlineNodeId;
      if (!targetId) {
        throw new RunRouteError(
          "run.retry.no_target",
          "失败任务缺少章节目标，无法重试",
          409,
        );
      }
      const target = story.requireOutlineNode(input.projectId, targetId);
      if (target.kind !== "chapter") {
        throw new RunRouteError(
          "run.target.not_chapter",
          "章节生产只能选择 chapter 类型的大纲节点",
          422,
        );
      }
      // 确定性 ID：同一 (源 run, requestId) 的重试永远回到同一个新 run。
      // 幂等回放先于活跃检查——重复点击命中已建的重试 run 时直接返回。
      const retryRunId = deterministicRequestId(
        "chapter-run",
        input.projectId,
        `${input.requestId}:retry:${runId}`,
      );
      const existing = runs.getRun(retryRunId);
      if (existing && existing.projectId !== input.projectId) {
        throw new RunRouteError(
          "run.retry.collision",
          "重试任务 ID 与其它作品冲突",
          409,
        );
      }
      if (existing) {
        if (options.enableBackgroundWorker) options.coordinator.wake();
        const replaySnapshot = runs.getSnapshot(retryRunId);
        return {
          status: 202,
          body: ChapterRunCreatedSchema.parse({
            ...replaySnapshot,
            ...runProductProjection(replaySnapshot),
            effectivePolicy: EffectivePolicySchema.parse(
              replaySnapshot.run.policy,
            ),
            idempotentReplay: true,
          }),
        };
      }
      const activeSession = automation
        .listSessions(input.projectId)
        .find((session) => !isTerminalSessionStatus(session.status));
      if (activeSession) {
        throw new RunRouteError(
          "project.writing_task.active",
          `作品已有进行中的快速创作任务：${activeSession.id}`,
          409,
        );
      }
      const activeRun = runs
        .listActiveRuns(input.projectId)
        .find((candidate) => candidate.targetOutlineNodeId !== null);
      if (activeRun) {
        throw new RunRouteError(
          "project.writing_task.active",
          `作品已有进行中的章节任务：${activeRun.id}`,
          409,
        );
      }
      requireWritingAssignment(database, options.environment);
      const template = templates.getByKey("recipe.chapter-production");
      if (!template)
        throw new RunRouteError(
          "recipe.template.missing",
          "章节生产配方模板不存在",
          500,
        );
      const recipe = compileChapterRecipeTemplate(
        retryRunId,
        template.effectiveContent,
        source.policy["maxRevisionCycles"] === 0 ? 0 : 2,
        template.version,
      );
      const sourceOrigin = isRecord(source.policy.origin)
        ? source.policy.origin
        : { surface: "runs", documentId: null, selection: null };
      const policy = withRuntimeModelPolicy(
        {
          planningMode: "auto",
          origin: sourceOrigin,
          creationRequestId: `${input.requestId}:retry:${runId}`,
          creationRequestHash: hashRequest({
            action: "retry_chapter",
            sourceRunId: runId,
            requestId: input.requestId,
          }),
        },
        options.environment,
      );
      runs.create({
        id: retryRunId,
        projectId: input.projectId,
        recipe: recipe.name,
        recipeVersion: recipe.version,
        mode: "chapter-gate",
        targetOutlineNodeId: targetId,
        policy,
        steps: recipe.steps,
        now: new Date().toISOString(),
      });
      if (options.enableBackgroundWorker) options.coordinator.wake();
      const setupHint = computeSetupHint(
        new SqliteAssignmentRepository(database),
      );
      const retrySnapshot = runs.getSnapshot(retryRunId);
      return {
        status: 202,
        body: ChapterRunCreatedSchema.parse({
          ...retrySnapshot,
          ...runProductProjection(retrySnapshot),
          effectivePolicy: EffectivePolicySchema.parse(
            retrySnapshot.run.policy,
          ),
          idempotentReplay: false,
          ...(setupHint ? { setupHint } : {}),
        }),
      };
    }
    const current = runs.getSnapshot(runId).run;
    if (["completed", "failed", "cancelled"].includes(current.status)) {
      throw new RunRouteError(
        "run.terminal",
        `运行已处于终态 ${current.status}`,
        409,
      );
    }
    const now = new Date().toISOString();
    if (input.action === "pause") runs.requestPause(runId, now);
    if (input.action === "cancel") {
      database.transaction(() => {
        runs.requestCancel(runId, now);
        reviews.supersedeRunRevisionProposals(runId, now);
      });
      options.coordinator.interrupt(runId);
    }
    if (input.action === "resume") runs.resume(runId, now);
    if (input.action === "accept_plan") {
      requireAwaitReason(
        runs.getSnapshot(runId),
        "scene_plan_approval_required",
      );
      runs.mergePolicy(runId, { planApproved: true }, now);
      runs.resume(runId, now);
    }
    if (input.action === "accept_manuscript") {
      requireAwaitReason(
        runs.getSnapshot(runId),
        "chapter_commit_approval_required",
      );
      runs.mergePolicy(
        runId,
        { chapterApproved: true, autoApplySettlement: true },
        now,
      );
      runs.resume(runId, now);
    }
    if (input.action === "discard_manuscript") {
      requireAwaitReason(
        runs.getSnapshot(runId),
        "chapter_commit_approval_required",
      );
      database.transaction(() => {
        runs.setRunStatus(runId, "cancelled", now, "manuscript_discarded");
        reviews.supersedeRunRevisionProposals(runId, now);
      });
    }
    if (input.action === "switch_to_manual") {
      requireAwaitReason(
        runs.getSnapshot(runId),
        "scene_plan_approval_required",
      );
      runs.setRunStatus(runId, "cancelled", now, "switched_to_manual");
    }
    if (options.enableBackgroundWorker) options.coordinator.wake();
    return RunSnapshotSchema.parse(runs.getSnapshot(runId));
  });

  app.route("POST", "/api/runs/:runId/advance", async (request) => {
    const { runId } = RunParamsSchema.parse(request.params);
    const input = AdvanceRunRequestSchema.parse(request.body);
    // Advancing a leased run remains available after deletion so the
    // supervisor can persist its terminal failure and release the lease.
    requireRunInProject(runs, runId, input.projectId);
    const processed = await options.coordinator.advanceRun(runId);
    return {
      processed,
      snapshot: RunSnapshotSchema.parse(runs.getSnapshot(runId)),
    };
  });

  app.route("POST", "/api/runs/:runId/streams/discard", async (request) => {
    const { runId } = RunParamsSchema.parse(request.params);
    const input = DiscardRunStreamRequestSchema.parse(request.body);
    requireRunInProject(runs, runId, input.projectId, projects);
    return {
      discarded: streams.discard(runId, input.stepId, input.attempt),
    };
  });

  // Creates a new run that continues writing from the partial content. The
  // continuation run id is deterministic, so repeating the call returns the
  // run created by the first call instead of starting duplicates.
  app.route("POST", "/api/runs/:runId/streams/continue", async (request) => {
    const { runId } = RunParamsSchema.parse(request.params);
    const input = ContinueRunStreamRequestSchema.parse(request.body);
    const source = requireRunInProject(runs, runId, input.projectId, projects);
    const continuedRunId = continuationRunId(
      runId,
      input.stepId,
      input.attempt,
    );
    const replay = runs.getRun(continuedRunId);
    if (replay) {
      return {
        status: 202,
        body: ChapterRunCreatedSchema.parse({
          ...runs.getSnapshot(continuedRunId),
          ...runProductProjection(runs.getSnapshot(continuedRunId)),
          effectivePolicy: EffectivePolicySchema.parse(replay.policy),
        }),
      };
    }
    const stream = streams.get(runId, input.stepId, input.attempt);
    if (!stream) {
      throw new RunRouteError(
        "run.stream.not_found",
        "对应的 partial 流不存在",
        404,
      );
    }
    requireViablePartial(stream.content);
    // chapterApproved is a one-time approval of the source run's commit, not
    // a policy: the continuation run must pass its own commit gate.
    const inherited: Record<string, unknown> = {
      ...withRuntimeModelPolicy(source.run.policy, options.environment),
    };
    delete inherited["chapterApproved"];
    const policy = {
      ...inherited,
      continuationPrefix: stream.content,
      continuedFrom: { runId, stepId: input.stepId, attempt: input.attempt },
    };
    const now = new Date().toISOString();
    const snapshot = database.transaction(() => {
      const current = requireRunInProject(
        runs,
        runId,
        input.projectId,
        projects,
      );
      runs.consumeRecoverableRun(runId, now, "partial_continued");
      reviews.supersedeRunRevisionProposals(runId, now);
      return runs.create({
        id: continuedRunId,
        projectId: current.run.projectId,
        recipe: current.run.recipe,
        recipeVersion: current.run.recipeVersion,
        mode: current.run.mode,
        targetOutlineNodeId: current.run.targetOutlineNodeId,
        policy,
        steps: continuationSteps(current.steps, current.run.id, continuedRunId),
        now,
      });
    });
    options.coordinator.interrupt(runId, "partial_continued");
    if (options.enableBackgroundWorker) options.coordinator.wake();
    return {
      status: 202,
      body: ChapterRunCreatedSchema.parse({
        ...snapshot,
        ...runProductProjection(snapshot),
        effectivePolicy: EffectivePolicySchema.parse(policy),
      }),
    };
  });

  // Appends the partial content to the chapter document's immutable version
  // chain. The version id is deterministic, so a repeated adopt replays
  // idempotently instead of creating a duplicate version.
  app.route("POST", "/api/runs/:runId/streams/adopt", async (request) => {
    const { runId } = RunParamsSchema.parse(request.params);
    const input = AdoptRunStreamRequestSchema.parse(request.body);
    const { run } = requireRunInProject(runs, runId, input.projectId, projects);
    if (!run.targetOutlineNodeId) {
      throw new RunRouteError(
        "run.target.missing",
        "章节运行没有目标大纲节点",
        422,
      );
    }
    const target = story.requireOutlineNode(
      run.projectId,
      run.targetOutlineNodeId,
    );
    if (target.kind !== "chapter") {
      throw new RunRouteError(
        "run.target.not_chapter",
        "partial 只能采纳到 chapter 类型的大纲节点",
        422,
      );
    }
    const documents = new SqliteDocumentRepository(database);
    const versionId = `adopt:${runId}:${input.stepId}:${input.attempt}`;
    const replayDocument = documents.getByOutlineNodeId(
      run.projectId,
      target.id,
    );
    const existing = replayDocument
      ? documents.getVersion(run.projectId, replayDocument.id, versionId)
      : null;
    if (replayDocument && existing) {
      return AdoptRunStreamResponseSchema.parse({
        documentId: replayDocument.id,
        versionId: existing.id,
        contentHash: existing.contentHash,
        idempotentReplay: true,
      });
    }
    const stream = streams.get(runId, input.stepId, input.attempt);
    if (!stream) {
      throw new RunRouteError(
        "run.stream.not_found",
        "对应的 partial 流不存在",
        404,
      );
    }
    requireViablePartial(stream.content);
    const now = new Date().toISOString();
    const result = database.transaction(() => {
      const current = requireRunInProject(
        runs,
        runId,
        input.projectId,
        projects,
      );
      let document = documents.getByOutlineNodeId(
        current.run.projectId,
        target.id,
      );
      const replayedVersion = document
        ? documents.getVersion(current.run.projectId, document.id, versionId)
        : null;
      if (document && replayedVersion) {
        return AdoptRunStreamResponseSchema.parse({
          documentId: document.id,
          versionId: replayedVersion.id,
          contentHash: replayedVersion.contentHash,
          idempotentReplay: true,
        });
      }
      runs.consumeRecoverableRun(runId, now, "partial_adopted");
      reviews.supersedeRunRevisionProposals(runId, now);
      if (!document) {
        const documentId = `${runId}:chapter-document`;
        document =
          documents.get(current.run.projectId, documentId) ??
          documents.insert(
            createDocument({
              id: documentId,
              projectId: current.run.projectId,
              kind: "chapter",
              title: target.title,
              outlineNodeId: target.id,
              now,
            }),
          );
      }
      const version = documents.appendVersion(
        current.run.projectId,
        document.id,
        {
          id: versionId,
          content: stream.content,
          source: `adopt:run:${runId}`,
          runId,
          expectedCurrentVersionId: document.currentVersionId,
          now,
        },
      );
      return AdoptRunStreamResponseSchema.parse({
        documentId: document.id,
        versionId: version.id,
        contentHash: version.contentHash,
        idempotentReplay: false,
      });
    });
    options.coordinator.interrupt(runId, "partial_adopted");
    return result;
  });

  // Regenerate = discard the partial and let the harness re-execute the
  // source step through the normal retry/advance path. Terminal runs cannot
  // be regenerated; start a fresh run instead.
  app.route("POST", "/api/runs/:runId/streams/regenerate", async (request) => {
    const { runId } = RunParamsSchema.parse(request.params);
    const input = RegenerateRunStreamRequestSchema.parse(request.body);
    const { run } = requireRunInProject(runs, runId, input.projectId, projects);
    if (["completed", "failed", "cancelled"].includes(run.status)) {
      throw new RunRouteError(
        "run.terminal",
        `运行已处于终态 ${run.status}，请创建新运行重新生成`,
        409,
      );
    }
    const discarded = streams.discard(runId, input.stepId, input.attempt);
    if (options.enableBackgroundWorker) options.coordinator.wake();
    return RegenerateRunStreamResponseSchema.parse({
      discarded,
      snapshot: runs.getSnapshot(runId),
    });
  });
}

/**
 * Deterministic id for the continuation run of one partial stream attempt,
 * which makes POST /api/runs/:runId/streams/continue idempotent.
 */
function continuationRunId(
  runId: string,
  stepId: string,
  attempt: number,
): string {
  return deterministicUuid(`continue:${runId}:${stepId}:${attempt}`);
}

/**
 * Re-seeds the source run's step structure for the continuation run: same
 * recipe flow, ordinals, cycles and attempt budgets, re-keyed to the new id.
 */
function continuationSteps(
  steps: readonly NarrativeRunStep[],
  sourceRunId: string,
  continuedRunId: string,
): RunStepSeedInput[] {
  return steps.map((step) => {
    const suffix = step.id.startsWith(`${sourceRunId}:`)
      ? step.id.slice(sourceRunId.length + 1)
      : `${step.ordinal}-${step.kind}`;
    return {
      id: `${continuedRunId}:${suffix}`,
      ordinal: step.ordinal,
      kind: step.kind,
      cycle: step.cycle,
      idempotencyKey: `${continuedRunId}/${suffix}`,
      maxAttempts: step.maxAttempts,
    };
  });
}
