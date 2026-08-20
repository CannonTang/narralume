import { sha256Hex } from "@narrative-lantern/domain";

import type {
  CanonCandidateItemDto,
  CanonSpread,
} from "@narrative-lantern/contracts";
import {
  SqliteCanonRepository,
  SqliteNarrativeStateRepository,
  SqliteStoryRepository,
  type NarrativeDatabase,
} from "@narrative-lantern/persistence";
import { z } from "zod";

import type { CanonCandidateModelResult } from "./canon-candidate-schemas.js";

const NullableText = z.string().trim().max(30_000).nullable();
const Id = z.string().trim().min(1).max(300);
const JsonObject = z.record(z.string(), z.unknown());

const AFTER_SCHEMAS: Record<CanonSpread, z.ZodType<Record<string, unknown>>> = {
  intent: z
    .object({
      promise: NullableText.optional(),
      themes: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
      audience: NullableText.optional(),
      tone: NullableText.optional(),
      boundaries: z
        .array(z.string().trim().min(1).max(2_000))
        .max(100)
        .optional(),
      endingDirection: NullableText.optional(),
      currentFocus: NullableText.optional(),
    })
    .strict(),
  outline: z
    .object({
      parentId: Id.nullable().optional(),
      kind: z
        .enum(["book", "volume", "arc", "chapter", "scene", "beat"])
        .optional(),
      ordinal: z.number().int().nonnegative().optional(),
      title: z.string().trim().min(1).max(300).optional(),
      summary: NullableText.optional(),
      goal: NullableText.optional(),
      conflict: NullableText.optional(),
      outcome: NullableText.optional(),
      povEntityId: Id.nullable().optional(),
      storyTime: z.string().trim().max(200).nullable().optional(),
      status: z
        .enum(["planned", "drafting", "review", "committed", "abandoned"])
        .optional(),
      metadata: JsonObject.optional(),
    })
    .strict(),
  entities: z
    .object({
      type: z
        .enum([
          "character",
          "location",
          "organization",
          "item",
          "rule",
          "concept",
        ])
        .optional(),
      name: z.string().trim().min(1).max(300).optional(),
      aliases: z.array(z.string().trim().min(1).max(300)).max(100).optional(),
      description: NullableText.optional(),
      attributes: JsonObject.optional(),
      status: z.enum(["active", "retired"]).optional(),
    })
    .strict(),
  facts: z
    .object({
      subjectId: Id.optional(),
      predicate: z.string().trim().min(1).max(300).optional(),
      objectEntityId: Id.nullable().optional(),
      value: z.unknown().optional(),
      validFromNodeId: Id.nullable().optional(),
      validToNodeId: Id.nullable().optional(),
      knowledgeScope: z
        .enum(["omniscient", "reader", "character", "author_secret"])
        .optional(),
      knowledgeSubjectId: Id.nullable().optional(),
      confidence: z.number().min(0).max(1).optional(),
    })
    .strict(),
  relations: z
    .object({
      fromEntityId: Id.optional(),
      toEntityId: Id.optional(),
      relation: z.string().trim().min(1).max(300).optional(),
      intensity: z.number().nullable().optional(),
      state: JsonObject.optional(),
      outlineNodeId: Id.nullable().optional(),
      storyTime: z.string().trim().max(200).nullable().optional(),
    })
    .strict(),
  timeline: z
    .object({
      title: z.string().trim().min(1).max(500).optional(),
      description: NullableText.optional(),
      outlineNodeId: Id.nullable().optional(),
      storyTimeStart: z.string().trim().max(200).nullable().optional(),
      storyTimeEnd: z.string().trim().max(200).nullable().optional(),
      sequence: z.number().int().optional(),
      participants: z.array(Id).max(200).optional(),
      causes: z.array(Id).max(200).optional(),
      visibility: z.enum(["omniscient", "reader", "author_secret"]).optional(),
    })
    .strict(),
  foreshadows: z
    .object({
      title: z.string().trim().min(1).max(500).optional(),
      description: z.string().trim().min(1).max(30_000).optional(),
      status: z
        .enum(["planned", "planted", "developing", "resolved", "abandoned"])
        .optional(),
      importance: z
        .union([
          z.literal(1),
          z.literal(2),
          z.literal(3),
          z.literal(4),
          z.literal(5),
        ])
        .optional(),
      targetFromNodeId: Id.nullable().optional(),
      targetToNodeId: Id.nullable().optional(),
      dependencies: z.array(Id).max(200).optional(),
      evidenceNodeIds: z.array(Id).max(200).optional(),
      resolutionNodeId: Id.nullable().optional(),
    })
    .strict(),
};

const CREATE_REQUIRED: Record<CanonSpread, readonly string[]> = {
  intent: [],
  outline: ["parentId", "kind", "ordinal", "title"],
  entities: ["type", "name"],
  facts: ["subjectId", "predicate"],
  relations: ["fromEntityId", "toEntityId", "relation"],
  timeline: ["title", "sequence"],
  foreshadows: ["title", "description", "status", "importance"],
};

export interface CanonSpreadState {
  spread: CanonSpread;
  value: unknown;
  fingerprint: string;
}

export function readCanonSpread(
  database: NarrativeDatabase,
  projectId: string,
  spread: CanonSpread,
): CanonSpreadState {
  const story = new SqliteStoryRepository(database);
  const canon = new SqliteCanonRepository(database);
  const state = new SqliteNarrativeStateRepository(database, canon, story);
  let value: CanonSpreadState["value"];
  if (spread === "intent") value = story.getAuthorIntent(projectId);
  else if (spread === "outline") value = story.listOutline(projectId);
  else if (spread === "entities")
    value = canon.listEntities(projectId, { includeRetired: true });
  else if (spread === "facts")
    value = canon.listEffectiveFacts(projectId, { includeCandidates: true });
  else if (spread === "relations")
    value = state.listCurrentRelationships(projectId);
  else if (spread === "timeline") value = state.listTimeline(projectId);
  else value = state.listForeshadows(projectId);
  return { spread, value, fingerprint: fingerprint(value) };
}

export function candidateSemanticIssues(
  spread: CanonSpread,
  current: CanonSpreadState["value"],
  result: CanonCandidateModelResult,
): string[] {
  const issues: string[] = [];
  const touched = new Set<string>();
  result.items.forEach((item, index) => {
    const path = `items.${index}`;
    if (spread === "intent") {
      if (item.operation !== "update" || item.targetId !== "intent")
        issues.push(`${path}: 作者意图只能 update，targetId 必须为 intent`);
    } else if (item.operation === "create" && item.targetId !== null) {
      issues.push(`${path}: create 的 targetId 必须为 null`);
    } else if (item.operation !== "create" && !item.targetId) {
      issues.push(`${path}: update/withdraw 必须指定 targetId`);
    }
    if (item.operation === "withdraw" && spread !== "facts")
      issues.push(`${path}: 只有正典事实支持 withdraw`);
    if (item.operation === "withdraw" && item.afterJson !== null)
      issues.push(`${path}: withdraw 的 afterJson 必须为 null`);
    if (item.operation !== "withdraw" && item.afterJson === null)
      issues.push(`${path}: create/update 必须提供 afterJson`);
    if (item.targetId && item.operation !== "create") {
      if (!targetRecord(current, spread, item.targetId))
        issues.push(`${path}: targetId 不在当前 ${spread} 中`);
      if (touched.has(item.targetId))
        issues.push(`${path}: 同一候选集不能重复修改 ${item.targetId}`);
      touched.add(item.targetId);
    }
    if (item.afterJson !== null) {
      const after = parseAfterJson(spread, item.afterJson);
      if (!after.success) {
        issues.push(`${path}.afterJson: ${after.error}`);
      } else if (Object.keys(after.value).length === 0) {
        issues.push(`${path}.afterJson: 修改内容不能为空`);
      } else if (item.operation === "create") {
        for (const field of CREATE_REQUIRED[spread]) {
          if (!(field in after.value))
            issues.push(`${path}.afterJson: create 缺少 ${field}`);
        }
        if (spread === "facts") {
          const hasEntity = typeof after.value.objectEntityId === "string";
          const hasValue = after.value.value !== undefined;
          if (hasEntity === hasValue)
            issues.push(
              `${path}.afterJson: facts create 必须且只能提供 objectEntityId 或 value`,
            );
        }
      }
    }
  });
  return issues;
}

export function materializeCandidateItems(
  projectId: string,
  spread: CanonSpread,
  current: CanonSpreadState["value"],
  result: CanonCandidateModelResult,
): Omit<CanonCandidateItemDto, "decision">[] {
  return result.items.map((item, index) => {
    const before = item.targetId
      ? targetRecord(current, spread, item.targetId)
      : null;
    const after =
      item.afterJson === null ? null : requireAfterJson(spread, item.afterJson);
    return {
      id: `item-${index + 1}`,
      operation: item.operation,
      targetId: item.targetId,
      title: item.title,
      rationale: item.rationale,
      impact: item.impact,
      before,
      after,
      diff: fieldDiff(before, after, item.operation),
      requiresLockedConfirmation: touchesLockedContent(
        projectId,
        spread,
        before,
        after,
      ),
    };
  });
}

export function candidateAfterInstructions(spread: CanonSpread): string {
  const fields: Record<CanonSpread, string> = {
    intent:
      "promise, themes, audience, tone, boundaries, endingDirection, currentFocus（只写要修改的字段）",
    outline:
      "parentId, kind, ordinal, title, summary, goal, conflict, outcome, povEntityId, storyTime, status, metadata",
    entities: "type, name, aliases, description, attributes, status",
    facts:
      "subjectId, predicate, objectEntityId 或 value（二选一）, validFromNodeId, validToNodeId, knowledgeScope, knowledgeSubjectId, confidence",
    relations:
      "fromEntityId, toEntityId, relation, intensity, state, outlineNodeId, storyTime",
    timeline:
      "title, description, outlineNodeId, storyTimeStart, storyTimeEnd, sequence, participants, causes, visibility",
    foreshadows:
      "title, description, status, importance, targetFromNodeId, targetToNodeId, dependencies, evidenceNodeIds, resolutionNodeId",
  };
  return fields[spread];
}

export function fingerprint(value: unknown): string {
  return sha256Hex(stableJson(value));
}

function parseAfterJson(
  spread: CanonSpread,
  source: string,
):
  | { success: true; value: Record<string, unknown> }
  | { success: false; error: string } {
  try {
    const raw = JSON.parse(source) as unknown;
    const parsed = AFTER_SCHEMAS[spread].safeParse(raw);
    return parsed.success
      ? { success: true, value: parsed.data }
      : {
          success: false,
          error: parsed.error.issues
            .map(
              (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`,
            )
            .join("; "),
        };
  } catch {
    return { success: false, error: "不是有效的 JSON 对象" };
  }
}

function requireAfterJson(
  spread: CanonSpread,
  source: string,
): Record<string, unknown> {
  const parsed = parseAfterJson(spread, source);
  if (!parsed.success) throw new Error(parsed.error);
  return parsed.value;
}

function targetRecord(
  current: unknown,
  spread: CanonSpread,
  targetId: string,
): Record<string, unknown> | null {
  if (spread === "intent")
    return targetId === "intent" && current && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : null;
  if (!Array.isArray(current)) return null;
  return (current.find(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      typeof (candidate as Record<string, unknown>).id === "string" &&
      (candidate as Record<string, unknown>).id === targetId,
  ) ?? null) as Record<string, unknown> | null;
}

function fieldDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  operation: "create" | "update" | "withdraw",
) {
  if (operation === "withdraw")
    return [{ field: "$item", before, after: null }];
  const keys = Object.keys(after ?? {}).sort();
  return keys
    .filter(
      (key) =>
        stableJson(before?.[key] ?? null) !== stableJson(after?.[key] ?? null),
    )
    .map((field) => ({
      field,
      before: before?.[field] ?? null,
      after: after?.[field] ?? null,
    }));
}

function touchesLockedContent(
  projectId: string,
  spread: CanonSpread,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): boolean {
  if (!before || !after) return false;
  if (spread === "facts") return before.authority === "locked";
  if (spread !== "intent" || before.projectId !== projectId) return false;
  const locked = new Set(
    Array.isArray(before.lockedFields)
      ? before.lockedFields.filter(
          (field): field is string => typeof field === "string",
        )
      : [],
  );
  return Object.keys(after).some((field) => locked.has(field));
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortValue(item)]),
  );
}
