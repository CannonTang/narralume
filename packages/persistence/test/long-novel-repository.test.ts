import {
  createCanonEntity,
  createCanonFact,
  createOutlineNode,
  createProject,
} from "@narralume/domain";
import { NodeNarrativeDatabase } from "../src/node.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LongNovelPersistenceError,
  SqliteCanonRepository,
  SqliteLongNovelRepository,
  SqliteNarrativeStateRepository,
  SqliteProjectRepository,
  SqliteRetrievalRepository,
  SqliteStoryRepository,
} from "../src/index.js";

const now = "2026-08-10T00:00:00.000Z";
let database: NodeNarrativeDatabase;
let longNovel: SqliteLongNovelRepository;
let story: SqliteStoryRepository;
let canon: SqliteCanonRepository;
let state: SqliteNarrativeStateRepository;

beforeEach(() => {
  database = new NodeNarrativeDatabase();
  database.migrate();
  new SqliteProjectRepository(database).insert(
    createProject({ id: "p1", title: "潮汐灯塔", now }),
  );
  story = new SqliteStoryRepository(database);
  canon = new SqliteCanonRepository(database);
  state = new SqliteNarrativeStateRepository(database, canon, story);
  longNovel = new SqliteLongNovelRepository(database);
});

afterEach(() => database.close());

describe("SqliteLongNovelRepository", () => {
  it("rebuilds traceable memory layers and indexes them for hybrid recall", () => {
    state.upsertSummary({
      id: "summary-1",
      projectId: "p1",
      scopeType: "chapter",
      scopeId: "chapter-1",
      summary: "林昭在雾港发现铜钥匙。",
      stateDelta: { clue: "key" },
      sourceHash: "hash-v1",
      createdAt: now,
    });
    const rebuilt = longNovel.rebuildMemories("p1", now);
    expect(rebuilt).toEqual([
      expect.objectContaining({
        layer: "episodic",
        sourceHash: "hash-v1",
        status: "active",
      }),
    ]);
    const firstMemory = rebuilt[0]!;
    const retrieval = new SqliteRetrievalRepository(database);
    retrieval.upsertEmbedding({
      segmentId: `segment:${firstMemory.id}`,
      model: "test-embedding",
      embedding: [1, 0],
      updatedAt: now,
    });
    expect(retrieval.search("p1", "铜钥匙", { rerank: true })[0]).toMatchObject(
      {
        sourceType: "narrative_memory",
        reasons: expect.arrayContaining(["fts", "rerank"]),
      },
    );

    state.upsertSummary({
      id: "summary-2",
      projectId: "p1",
      scopeType: "chapter",
      scopeId: "chapter-1",
      summary: "林昭确认铜钥匙属于旧港仓库。",
      stateDelta: { clue: "warehouse-key" },
      sourceHash: "hash-v2",
      createdAt: "2026-08-10T01:00:00.000Z",
    });
    longNovel.rebuildMemories("p1", "2026-08-10T01:00:00.000Z");
    expect(longNovel.listMemories("p1", { includeStale: true })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceHash: "hash-v1", status: "stale" }),
        expect.objectContaining({ sourceHash: "hash-v2", status: "active" }),
      ]),
    );
    expect(
      database.raw
        .prepare(
          "SELECT COUNT(*) AS count FROM text_segments WHERE source_type = 'narrative_memory' AND source_id = ?",
        )
        .get(firstMemory.id),
    ).toEqual({ count: 0 });

    // Even if an old database still contains a stale segment, every retrieval
    // path must exclude it based on the authoritative memory status.
    const memoryEntity = canon.insertEntity(
      createCanonEntity({
        id: "memory-entity",
        projectId: "p1",
        type: "location",
        name: "雾港",
        now: "2026-08-10T01:00:00.000Z",
      }),
    );
    retrieval.upsertSegment({
      id: `segment:${firstMemory.id}`,
      projectId: "p1",
      sourceType: "narrative_memory",
      sourceId: firstMemory.id,
      title: firstMemory.title,
      content: firstMemory.content,
      authority: "confirmed",
      metadata: {},
      entityIds: [memoryEntity.id],
      createdAt: firstMemory.createdAt,
      updatedAt: "2026-08-10T01:00:00.000Z",
    });
    retrieval.upsertEmbedding({
      segmentId: `segment:${firstMemory.id}`,
      model: "test-embedding",
      embedding: [1, 0],
      updatedAt: "2026-08-10T01:00:00.000Z",
    });
    expect(retrieval.search("p1", "雾港")).toEqual([]);
    expect(
      retrieval.search("p1", "", {
        queryEmbedding: [1, 0],
        embeddingModel: "test-embedding",
      }),
    ).toEqual([]);
    expect(
      retrieval.search("p1", "", { entityIds: [memoryEntity.id] }),
    ).toEqual([]);
    expect(
      longNovel.consolidateSleep("p1", "2026-08-10T02:00:00.000Z"),
    ).toMatchObject({
      layer: "semantic",
      scopeType: "sleep",
      stateDelta: {
        clue: "warehouse-key",
        consolidatedFrom: expect.arrayContaining([expect.any(String)]),
      },
    });
  });

  it("keeps predictions non-canon and reports dry-run consequences", () => {
    const book = story.insertOutlineNode(
      createOutlineNode({
        id: "book",
        projectId: "p1",
        parent: null,
        kind: "book",
        ordinal: 0,
        title: "潮汐灯塔",
        now,
      }),
    );
    story.insertOutlineNode(
      createOutlineNode({
        id: "chapter-1",
        projectId: "p1",
        parent: book,
        kind: "chapter",
        ordinal: 0,
        title: "失灯之夜",
        conflict: "林昭必须决定是否下潜",
        now,
      }),
    );
    const hero = canon.insertEntity(
      createCanonEntity({
        id: "hero",
        projectId: "p1",
        type: "character",
        name: "林昭",
        now,
      }),
    );
    const keeper = canon.insertEntity(
      createCanonEntity({
        id: "keeper",
        projectId: "p1",
        type: "character",
        name: "守灯人",
        now,
      }),
    );
    canon.insertFact(
      createCanonFact({
        id: "fact-1",
        projectId: "p1",
        subjectId: hero.id,
        predicate: "恐惧",
        value: "深水",
        authority: "locked",
        sourceType: "manual",
        now,
      }),
    );
    state.insertRelationship({
      id: "relationship-1",
      projectId: "p1",
      fromEntityId: hero.id,
      toEntityId: keeper.id,
      relation: "互不信任的同盟",
      intensity: 0.6,
      state: {},
      outlineNodeId: "chapter-1",
      storyTime: null,
      sourceId: "chapter-1",
      supersedesEventId: null,
      createdAt: now,
    });
    state.insertTimelineEvent({
      id: "event-direct",
      projectId: "p1",
      title: "林昭决定下潜",
      description: null,
      outlineNodeId: "chapter-1",
      storyTimeStart: null,
      storyTimeEnd: null,
      sequence: 1,
      participants: [hero.id],
      causes: [],
      visibility: "reader",
      sourceId: "chapter-1",
      createdAt: now,
      updatedAt: now,
    });
    state.insertTimelineEvent({
      id: "event-downstream",
      projectId: "p1",
      title: "港口失去退路",
      description: null,
      outlineNodeId: "chapter-1",
      storyTimeStart: null,
      storyTimeEnd: null,
      sequence: 2,
      participants: [],
      causes: ["event-direct"],
      visibility: "reader",
      sourceId: "chapter-1",
      createdAt: now,
      updatedAt: now,
    });
    state.insertForeshadow({
      id: "clue-key",
      projectId: "p1",
      title: "铜钥匙",
      description: "旧港仓库钥匙",
      status: "planted",
      importance: 4,
      targetFromNodeId: "chapter-1",
      targetToNodeId: null,
      dependencies: [],
      evidenceNodeIds: ["chapter-1"],
      resolutionNodeId: null,
      createdAt: now,
      updatedAt: now,
    });
    state.insertForeshadow({
      id: "clue-door",
      projectId: "p1",
      title: "仓库暗门",
      description: "依赖铜钥匙开启",
      status: "planned",
      importance: 3,
      targetFromNodeId: "chapter-1",
      targetToNodeId: null,
      dependencies: ["clue-key"],
      evidenceNodeIds: [],
      resolutionNodeId: null,
      createdAt: now,
      updatedAt: now,
    });
    const beforeFacts = canon.listEffectiveFacts("p1");
    const predictions = longNovel.generatePredictions(
      "p1",
      { direction: "让她主动下潜", horizon: 3, count: 2 },
      now,
    );
    expect(predictions).toHaveLength(2);
    expect(predictions[0]).toMatchObject({
      status: "candidate",
      stale: false,
      contextFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(canon.listEffectiveFacts("p1")).toEqual(beforeFacts);

    expect(
      longNovel.dryRun("p1", "让林昭克服恐惧，改写失灯之夜并丢弃铜钥匙"),
    ).toMatchObject({
      safeToProceed: false,
      findings: expect.arrayContaining([
        expect.objectContaining({ kind: "entity", sourceId: "hero" }),
        expect.objectContaining({ kind: "fact", sourceId: "fact-1" }),
        expect.objectContaining({ kind: "timeline", sourceId: "event-direct" }),
        expect.objectContaining({
          kind: "timeline",
          sourceId: "event-downstream",
        }),
        expect.objectContaining({ kind: "foreshadow", sourceId: "clue-door" }),
        expect.objectContaining({ kind: "outline", sourceId: "chapter-1" }),
      ]),
    });
    database.raw
      .prepare("UPDATE outline_nodes SET summary = ? WHERE id = ?")
      .run("林昭决定先烧毁潜水图。", "chapter-1");
    expect(
      longNovel
        .listPredictions("p1")
        .find((prediction) => prediction.id === predictions[0]!.id),
    ).toMatchObject({ status: "candidate", stale: true });
    expect(() =>
      longNovel.decidePrediction("p1", predictions[0]!.id, "adopted", now),
    ).toThrowError(LongNovelPersistenceError);
    try {
      longNovel.decidePrediction("p1", predictions[0]!.id, "adopted", now);
    } catch (error) {
      expect(error).toMatchObject({ code: "prediction.context.stale" });
    }

    const refreshed = longNovel.generatePredictions(
      "p1",
      { direction: "让她主动下潜", horizon: 3, count: 2 },
      "2026-08-10T01:00:00.000Z",
    );
    expect(refreshed[0]).toMatchObject({ status: "candidate", stale: false });
    expect(refreshed[0]!.id).not.toBe(predictions[0]!.id);
    expect(
      longNovel.decidePrediction("p1", refreshed[0]!.id, "adopted", now),
    ).toMatchObject({ status: "adopted", stale: false });
    expect(canon.listEffectiveFacts("p1")).toEqual(beforeFacts);
  });
});
