import { sha256Hex } from "@narralume/domain";

import { canonContextSources, type ContextSource } from "@narralume/context";
import {
  canAccessFact,
  type CanonAccess,
  type CanonEntity,
  type CanonFact,
  type Foreshadow,
  type KnowledgeRecord,
  type OutlineNode,
  type RelationshipEvent,
  type TimelineEvent,
} from "@narralume/domain";
import type {
  SqliteCanonRepository,
  SqliteNarrativeStateRepository,
  SqliteStoryRepository,
} from "@narralume/persistence";

export type StoryStateAudience = "author" | "reader" | "character";

export interface StoryStatePacketRequest {
  projectId: string;
  audience: StoryStateAudience;
  characterId?: string | null;
  targetOutlineNodeId?: string | null;
  focalEntityIds?: readonly string[];
  recentChapterWindow?: number;
  maxTimelineEvents?: number;
  maxRelationships?: number;
}

export interface StoryStatePacket {
  sources: readonly ContextSource[];
  fingerprint: string;
  counts: {
    facts: number;
    relationships: number;
    timelineEvents: number;
    foreshadows: number;
    knowledgeRecords: number;
  };
}

/**
 * Builds the single, access-controlled story-state input consumed by narrative
 * workers. Keeping this boundary in one place prevents a character worker from
 * accidentally receiving author-only facts through an ad-hoc query.
 */
export class StoryStatePacketBuilder {
  constructor(
    private readonly canon: SqliteCanonRepository,
    private readonly state: SqliteNarrativeStateRepository,
    private readonly story: SqliteStoryRepository,
  ) {}

  build(request: StoryStatePacketRequest): StoryStatePacket {
    validateAudience(request);
    const outline = this.story.listOutline(request.projectId);
    const scope = buildOutlineScope(outline, request.targetOutlineNodeId);
    if (request.targetOutlineNodeId && !scope.targetNode) {
      throw new Error(
        `story-state target outline node ${request.targetOutlineNodeId} does not exist`,
      );
    }
    const focalEntityIds = resolveFocalEntityIds(request, scope);
    const entities = this.canon.listEntities(request.projectId);
    const entityById = new Map(entities.map((entity) => [entity.id, entity]));
    const allFacts = effectiveFactsAtTarget(
      this.canon.listFactHistory(request.projectId),
      scope,
    );
    const access = canonAccess(request);
    const facts = allFacts.filter((fact) => canAccessFact(fact, access));
    const knowledge = visibleKnowledge(
      this.state.listKnowledge(request.projectId),
      request,
    ).filter((record) => nodeIsNotAfterTarget(record.learnedAtNodeId, scope));
    const knowledgeFactIds = new Set(
      knowledge
        .map((record) => record.factId)
        .filter((id): id is string => Boolean(id)),
    );
    const knowledgeTimelineIds = new Set(
      knowledge
        .map((record) => record.timelineEventId)
        .filter((id): id is string => Boolean(id)),
    );
    const visibleFacts = rankFacts(
      uniqueById([
        ...facts,
        ...allFacts.filter((fact) => knowledgeFactIds.has(fact.id)),
      ]),
      focalEntityIds,
    );
    const allRelationships = visibleRelationships(
      currentRelationshipsAtTarget(
        this.state.listRelationshipHistory(request.projectId),
        scope,
      ),
      request,
    );
    const relatedEntityIds = expandRelatedEntityIds(
      focalEntityIds,
      visibleFacts,
      allRelationships,
    );
    const relationships = rankRelationships(
      allRelationships,
      focalEntityIds,
      relatedEntityIds,
      scope,
    ).slice(0, bounded(request.maxRelationships, 80));
    const timeline = recallTimeline(
      visibleTimeline(
        this.state.listTimeline(request.projectId),
        request,
        knowledgeTimelineIds,
      ),
      focalEntityIds,
      relatedEntityIds,
      knowledgeTimelineIds,
      scope,
      bounded(request.recentChapterWindow, 8),
      bounded(request.maxTimelineEvents, 80),
    );
    const foreshadows = visibleForeshadows(
      this.state.listForeshadows(request.projectId),
      request,
    );

    const sources: ContextSource[] = canonContextSources(
      entities,
      visibleFacts,
      access,
    ).map((source) => ({
      ...source,
      priority: focalEntityIds.has(source.sourceId ?? "")
        ? 94
        : relatedEntityIds.has(source.sourceId ?? "")
          ? 88
          : source.priority,
      metadata: {
        ...source.metadata,
        recallTier: focalEntityIds.has(source.sourceId ?? "")
          ? "focal"
          : relatedEntityIds.has(source.sourceId ?? "")
            ? "related"
            : "background",
      },
    }));
    if (relationships.length > 0) {
      sources.push({
        id: "story-state:relationships",
        kind: "canon",
        label: "当前人物关系",
        content: relationships
          .map((event) => relationshipLine(event, entityById))
          .join("\n"),
        summary: relationships
          .slice(0, 20)
          .map((event) => relationshipLine(event, entityById))
          .join("\n"),
        authority: "confirmed",
        priority: 86,
        sourceType: "relationship_state",
        sourceId: request.projectId,
      });
    }
    if (timeline.length > 0) {
      sources.push({
        id: "story-state:timeline",
        kind: "canon",
        label: "已发生时间线",
        content: timeline
          .map((event) => timelineLine(event, entityById))
          .join("\n"),
        summary: timeline
          .slice(-20)
          .map((event) => timelineLine(event, entityById))
          .join("\n"),
        authority: "confirmed",
        priority: 87,
        sourceType: "timeline_state",
        sourceId: request.projectId,
      });
    }
    if (knowledge.length > 0) {
      sources.push({
        id: "story-state:knowledge",
        kind: "canon",
        label:
          request.audience === "character"
            ? "当前角色明确知道或相信的内容"
            : "人物与读者认知状态",
        content: knowledge
          .map((record) =>
            knowledgeLine(record, visibleFacts, timeline, entityById),
          )
          .filter(Boolean)
          .join("\n"),
        authority: "confirmed",
        priority: 91,
        required: request.audience === "character",
        compressible: request.audience !== "character",
        sourceType: "knowledge_state",
        sourceId: request.characterId ?? request.projectId,
      });
    }
    const foreshadowTiers = tierForeshadows(foreshadows, request, scope);
    for (const tier of foreshadowTiers) {
      if (tier.items.length === 0) continue;
      sources.push({
        id: `story-state:foreshadows:${tier.id}`,
        kind: "canon",
        label: `${tier.label}（作者侧，不得直接泄露）`,
        content: tier.items.map(foreshadowLine).join("\n"),
        summary: tier.items.slice(0, 12).map(foreshadowLine).join("\n"),
        authority: "locked",
        priority: tier.priority,
        required: tier.required,
        compressible: !tier.required,
        sourceType: "foreshadow_state",
        sourceId: request.projectId,
        metadata: { continuityTier: tier.id },
      });
    }

    const fingerprint = sha256Hex(
      stableJson({
        audience: request.audience,
        characterId: request.characterId ?? null,
        targetOutlineNodeId: request.targetOutlineNodeId ?? null,
        focalEntityIds: [...focalEntityIds].sort(),
        recentChapterWindow: bounded(request.recentChapterWindow, 8),
        factIds: visibleFacts.map((fact) => fact.id),
        relationshipIds: relationships.map((event) => event.id),
        timelineIds: timeline.map((event) => event.id),
        foreshadowIds: foreshadows.map((item) => item.id),
        knowledgeIds: knowledge.map((record) => record.id),
      }),
    );
    return {
      sources,
      fingerprint,
      counts: {
        facts: visibleFacts.length,
        relationships: relationships.length,
        timelineEvents: timeline.length,
        foreshadows: foreshadows.length,
        knowledgeRecords: knowledge.length,
      },
    };
  }
}

function canonAccess(request: StoryStatePacketRequest): CanonAccess {
  if (request.audience === "character") {
    return {
      audience: "character",
      ...(request.characterId ? { characterId: request.characterId } : {}),
      includeCandidates: false,
    };
  }
  return { audience: request.audience, includeCandidates: false };
}

function validateAudience(request: StoryStatePacketRequest): void {
  if (request.audience === "character" && !request.characterId) {
    throw new Error("character story-state packets require characterId");
  }
}

function visibleKnowledge(
  records: readonly KnowledgeRecord[],
  request: StoryStatePacketRequest,
): KnowledgeRecord[] {
  if (request.audience === "author") return [...records];
  if (request.audience === "reader")
    return records.filter((record) => record.knowerType === "reader");
  return records.filter(
    (record) =>
      record.knowerType === "character" &&
      record.knowerEntityId === request.characterId,
  );
}

function visibleRelationships(
  events: readonly RelationshipEvent[],
  request: StoryStatePacketRequest,
): RelationshipEvent[] {
  if (request.audience !== "character") return [...events];
  return events.filter(
    (event) =>
      event.fromEntityId === request.characterId ||
      event.toEntityId === request.characterId,
  );
}

function visibleTimeline(
  events: readonly TimelineEvent[],
  request: StoryStatePacketRequest,
  knownIds: ReadonlySet<string>,
): TimelineEvent[] {
  if (request.audience === "author") return [...events];
  if (request.audience === "reader")
    return events.filter((event) => event.visibility !== "author_secret");
  return events.filter(
    (event) => event.visibility === "omniscient" || knownIds.has(event.id),
  );
}

function visibleForeshadows(
  foreshadows: readonly Foreshadow[],
  request: StoryStatePacketRequest,
): Foreshadow[] {
  if (request.audience !== "author") return [];
  return foreshadows.filter(
    (item) => item.status !== "abandoned" && item.status !== "resolved",
  );
}

function rankRelationships(
  events: readonly RelationshipEvent[],
  focalEntityIds: ReadonlySet<string>,
  relatedEntityIds: ReadonlySet<string>,
  scope: OutlineScope,
): RelationshipEvent[] {
  return [...events].sort((left, right) => {
    const leftTarget = relationshipRank(left, focalEntityIds, relatedEntityIds);
    const rightTarget = relationshipRank(
      right,
      focalEntityIds,
      relatedEntityIds,
    );
    return (
      rightTarget - leftTarget ||
      nodeOrder(right.outlineNodeId, scope) -
        nodeOrder(left.outlineNodeId, scope) ||
      right.createdAt.localeCompare(left.createdAt) ||
      left.id.localeCompare(right.id)
    );
  });
}

function relationshipRank(
  event: RelationshipEvent,
  focalEntityIds: ReadonlySet<string>,
  relatedEntityIds: ReadonlySet<string>,
): number {
  if (
    focalEntityIds.has(event.fromEntityId) ||
    focalEntityIds.has(event.toEntityId)
  )
    return 2;
  if (
    relatedEntityIds.has(event.fromEntityId) ||
    relatedEntityIds.has(event.toEntityId)
  )
    return 1;
  return 0;
}

function tierForeshadows(
  foreshadows: readonly Foreshadow[],
  request: StoryStatePacketRequest,
  scope: OutlineScope,
) {
  const byId = new Map(foreshadows.map((item) => [item.id, item]));
  const commitmentIds = new Set(
    request.targetOutlineNodeId
      ? foreshadows
          .filter((item) => targetWithinForeshadowWindow(item, scope))
          .map((item) => item.id)
      : [],
  );
  const pending = [...commitmentIds];
  while (pending.length > 0) {
    const current = byId.get(pending.pop()!);
    for (const dependencyId of current?.dependencies ?? []) {
      if (!byId.has(dependencyId) || commitmentIds.has(dependencyId)) continue;
      commitmentIds.add(dependencyId);
      pending.push(dependencyId);
    }
  }
  const commitments: Foreshadow[] = [];
  const active: Foreshadow[] = [];
  const latent: Foreshadow[] = [];
  for (const item of foreshadows) {
    if (commitmentIds.has(item.id)) {
      commitments.push(item);
    } else if (["planted", "developing"].includes(item.status)) {
      active.push(item);
    } else {
      latent.push(item);
    }
  }
  const order = (items: Foreshadow[]) =>
    items.sort(
      (left, right) =>
        right.importance - left.importance ||
        right.updatedAt.localeCompare(left.updatedAt),
    );
  return [
    {
      id: "commitment",
      label: "下一章承诺",
      items: order(commitments),
      priority: 96,
      required: true,
    },
    {
      id: "active",
      label: "当前阶段活跃线索",
      items: order(active),
      priority: 89,
      required: false,
    },
    {
      id: "latent",
      label: "长期潜在线索",
      items: order(latent),
      priority: 70,
      required: false,
    },
  ] as const;
}

interface OutlineScope {
  nodeOrder: ReadonlyMap<string, number>;
  chapterOrder: ReadonlyMap<string, number>;
  chapterByNode: ReadonlyMap<string, string>;
  nodeById: ReadonlyMap<string, OutlineNode>;
  targetNode: OutlineNode | null;
  targetNodeOrder: number | null;
  targetChapterOrder: number | null;
}

function buildOutlineScope(
  outline: readonly OutlineNode[],
  targetOutlineNodeId: string | null | undefined,
): OutlineScope {
  const nodeById = new Map(outline.map((node) => [node.id, node]));
  const nodeOrder = new Map(outline.map((node, index) => [node.id, index]));
  const chapterOrder = new Map(
    outline
      .filter((node) => node.kind === "chapter")
      .map((node, index) => [node.id, index]),
  );
  const chapterByNode = new Map<string, string>();
  for (const node of outline) {
    let cursor: OutlineNode | undefined = node;
    while (cursor && cursor.kind !== "chapter") {
      cursor = cursor.parentId ? nodeById.get(cursor.parentId) : undefined;
    }
    if (cursor?.kind === "chapter") chapterByNode.set(node.id, cursor.id);
  }
  const targetChapterId = targetOutlineNodeId
    ? chapterByNode.get(targetOutlineNodeId)
    : undefined;
  return {
    nodeOrder,
    chapterOrder,
    chapterByNode,
    nodeById,
    targetNode: targetOutlineNodeId
      ? (nodeById.get(targetOutlineNodeId) ?? null)
      : null,
    targetNodeOrder: targetOutlineNodeId
      ? (nodeOrder.get(targetOutlineNodeId) ?? null)
      : null,
    targetChapterOrder: targetChapterId
      ? (chapterOrder.get(targetChapterId) ?? null)
      : null,
  };
}

function resolveFocalEntityIds(
  request: StoryStatePacketRequest,
  scope: OutlineScope,
): Set<string> {
  const ids = new Set(
    (request.focalEntityIds ?? []).filter((id) => id.trim().length > 0),
  );
  if (request.characterId) ids.add(request.characterId);
  if (request.targetOutlineNodeId) {
    const povEntityId = scope.nodeById.get(
      request.targetOutlineNodeId,
    )?.povEntityId;
    if (povEntityId) ids.add(povEntityId);
  }
  return ids;
}

function factActiveAtTarget(fact: CanonFact, scope: OutlineScope): boolean {
  if (scope.targetNodeOrder === null) return true;
  const validFrom = fact.validFromNodeId
    ? scope.nodeOrder.get(fact.validFromNodeId)
    : undefined;
  const validTo = fact.validToNodeId
    ? scope.nodeOrder.get(fact.validToNodeId)
    : undefined;
  const validToNode = fact.validToNodeId
    ? scope.nodeById.get(fact.validToNodeId)
    : undefined;
  return Boolean(
    (validFrom === undefined || validFrom <= scope.targetNodeOrder) &&
    (validTo === undefined ||
      validTo >= scope.targetNodeOrder ||
      (validToNode && nodeContains(validToNode, scope.targetNode))),
  );
}

function effectiveFactsAtTarget(
  facts: readonly CanonFact[],
  scope: OutlineScope,
): CanonFact[] {
  const active = facts.filter((fact) => factActiveAtTarget(fact, scope));
  const supersededIds = new Set(
    active
      .map((fact) => fact.supersedesFactId)
      .filter((id): id is string => Boolean(id)),
  );
  return active.filter((fact) => !supersededIds.has(fact.id));
}

function currentRelationshipsAtTarget(
  events: readonly RelationshipEvent[],
  scope: OutlineScope,
): RelationshipEvent[] {
  const eligible = events.filter((event) =>
    nodeIsNotAfterTarget(event.outlineNodeId, scope),
  );
  const supersededIds = new Set(
    eligible
      .map((event) => event.supersedesEventId)
      .filter((id): id is string => Boolean(id)),
  );
  return eligible.filter((event) => !supersededIds.has(event.id));
}

function rankFacts(
  facts: readonly CanonFact[],
  focalEntityIds: ReadonlySet<string>,
): CanonFact[] {
  return [...facts].sort(
    (left, right) =>
      factEntityRank(right, focalEntityIds) -
        factEntityRank(left, focalEntityIds) ||
      left.subjectId.localeCompare(right.subjectId) ||
      left.predicate.localeCompare(right.predicate) ||
      left.id.localeCompare(right.id),
  );
}

function factEntityRank(
  fact: CanonFact,
  entityIds: ReadonlySet<string>,
): number {
  return entityIds.has(fact.subjectId) ||
    (fact.objectEntityId ? entityIds.has(fact.objectEntityId) : false)
    ? 1
    : 0;
}

function expandRelatedEntityIds(
  focalEntityIds: ReadonlySet<string>,
  facts: readonly CanonFact[],
  relationships: readonly RelationshipEvent[],
): Set<string> {
  const related = new Set(focalEntityIds);
  for (const fact of facts) {
    if (focalEntityIds.has(fact.subjectId) && fact.objectEntityId)
      related.add(fact.objectEntityId);
    if (fact.objectEntityId && focalEntityIds.has(fact.objectEntityId))
      related.add(fact.subjectId);
  }
  for (const event of relationships) {
    if (focalEntityIds.has(event.fromEntityId)) related.add(event.toEntityId);
    if (focalEntityIds.has(event.toEntityId)) related.add(event.fromEntityId);
  }
  return related;
}

function recallTimeline(
  events: readonly TimelineEvent[],
  focalEntityIds: ReadonlySet<string>,
  relatedEntityIds: ReadonlySet<string>,
  knownIds: ReadonlySet<string>,
  scope: OutlineScope,
  recentChapterWindow: number,
  limit: number,
): TimelineEvent[] {
  const eligible = events.filter((event) =>
    nodeIsNotAfterTarget(event.outlineNodeId, scope),
  );
  if (scope.targetChapterOrder === null) {
    return [...eligible]
      .sort((left, right) => left.sequence - right.sequence)
      .slice(-limit);
  }
  const recentFrom = Math.max(
    0,
    scope.targetChapterOrder - recentChapterWindow + 1,
  );
  const score = new Map<string, number>();
  for (const event of eligible) {
    const eventChapter = chapterOrderForNode(event.outlineNodeId, scope);
    const focal = event.participants.some((id) => focalEntityIds.has(id));
    const related = event.participants.some((id) => relatedEntityIds.has(id));
    const recent = eventChapter !== null && eventChapter >= recentFrom;
    const value =
      (knownIds.has(event.id) ? 8 : 0) +
      (focal ? 6 : related ? 3 : 0) +
      (recent ? 2 : 0);
    if (value > 0) score.set(event.id, value);
  }
  const byId = new Map(eligible.map((event) => [event.id, event]));
  const pending = [...score.keys()];
  while (pending.length > 0) {
    const event = byId.get(pending.pop()!);
    for (const causeId of event?.causes ?? []) {
      if (!byId.has(causeId) || (score.get(causeId) ?? 0) >= 7) continue;
      score.set(causeId, 7);
      pending.push(causeId);
    }
  }
  return eligible
    .filter((event) => score.has(event.id))
    .sort(
      (left, right) =>
        (score.get(right.id) ?? 0) - (score.get(left.id) ?? 0) ||
        right.sequence - left.sequence ||
        left.id.localeCompare(right.id),
    )
    .slice(0, limit)
    .sort((left, right) => left.sequence - right.sequence);
}

function targetWithinForeshadowWindow(
  item: Foreshadow,
  scope: OutlineScope,
): boolean {
  if (scope.targetNodeOrder === null) return false;
  const from = item.targetFromNodeId
    ? scope.nodeOrder.get(item.targetFromNodeId)
    : undefined;
  const to = item.targetToNodeId
    ? scope.nodeOrder.get(item.targetToNodeId)
    : undefined;
  const toNode = item.targetToNodeId
    ? scope.nodeById.get(item.targetToNodeId)
    : undefined;
  if (from === undefined && to === undefined) return false;
  return Boolean(
    (from === undefined || from <= scope.targetNodeOrder) &&
    (to === undefined ||
      to >= scope.targetNodeOrder ||
      (toNode && nodeContains(toNode, scope.targetNode))),
  );
}

function nodeContains(
  ancestor: OutlineNode,
  candidate: OutlineNode | null,
): boolean {
  return Boolean(
    candidate &&
    (candidate.id === ancestor.id ||
      candidate.path.startsWith(`${ancestor.path}/`)),
  );
}

function nodeIsNotAfterTarget(
  outlineNodeId: string | null,
  scope: OutlineScope,
): boolean {
  if (scope.targetNodeOrder === null || !outlineNodeId) return true;
  const order = scope.nodeOrder.get(outlineNodeId);
  return order === undefined || order <= scope.targetNodeOrder;
}

function chapterOrderForNode(
  outlineNodeId: string | null,
  scope: OutlineScope,
): number | null {
  if (!outlineNodeId) return null;
  const chapterId = scope.chapterByNode.get(outlineNodeId);
  return chapterId ? (scope.chapterOrder.get(chapterId) ?? null) : null;
}

function nodeOrder(outlineNodeId: string | null, scope: OutlineScope): number {
  return outlineNodeId ? (scope.nodeOrder.get(outlineNodeId) ?? -1) : -1;
}

function relationshipLine(
  event: RelationshipEvent,
  entities: ReadonlyMap<string, CanonEntity>,
): string {
  return `- [relationship:${event.id}] ${entityName(event.fromEntityId, entities)} → ${entityName(event.toEntityId, entities)}：${event.relation}${event.intensity === null ? "" : `（强度 ${event.intensity}）`}${Object.keys(event.state).length === 0 ? "" : `；状态 ${JSON.stringify(event.state)}`}`;
}

function timelineLine(
  event: TimelineEvent,
  entities: ReadonlyMap<string, CanonEntity>,
): string {
  const participants = event.participants
    .map((id) => entityName(id, entities))
    .join("、");
  return `- [timeline:${event.id}] #${event.sequence} ${event.title}${event.storyTimeStart ? `｜${event.storyTimeStart}` : ""}${participants ? `｜参与者：${participants}` : ""}${event.description ? `｜${event.description}` : ""}`;
}

function knowledgeLine(
  record: KnowledgeRecord,
  facts: readonly CanonFact[],
  timeline: readonly TimelineEvent[],
  entities: ReadonlyMap<string, CanonEntity>,
): string {
  const fact = record.factId
    ? facts.find((candidate) => candidate.id === record.factId)
    : null;
  if (fact) {
    const object = fact.objectEntityId
      ? entityName(fact.objectEntityId, entities)
      : JSON.stringify(fact.value);
    return `- [${record.belief}] ${entityName(fact.subjectId, entities)} ${fact.predicate} ${object}`;
  }
  const event = record.timelineEventId
    ? timeline.find((candidate) => candidate.id === record.timelineEventId)
    : null;
  return event ? `- [${record.belief}] 事件：${event.title}` : "";
}

function foreshadowLine(item: Foreshadow): string {
  return `- [foreshadow:${item.id}｜${item.status}｜重要度 ${item.importance}] ${item.title}：${item.description}`;
}

function entityName(
  id: string,
  entities: ReadonlyMap<string, CanonEntity>,
): string {
  return entities.get(id)?.name ?? `[entity:${id}]`;
}

function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function bounded(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.trunc(value!), 500));
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(",")}}`;
}
