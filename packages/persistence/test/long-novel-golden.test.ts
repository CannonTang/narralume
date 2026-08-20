import {
  createCanonEntity,
  createCanonFact,
  createProject,
} from "@narrative-lantern/domain";
import { NodeNarrativeDatabase } from "../src/node.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SqliteCanonRepository,
  SqliteLongNovelRepository,
  SqliteProjectRepository,
  SqliteRetrievalRepository,
} from "../src/index.js";

const GOLDEN_RECALL_CASES = [
  { query: "限知视角", expectedSourceId: "rule-pov" },
  { query: "铜钥匙旧港仓库", expectedSourceId: "episode-key" },
] as const;

describe("long novel golden eval", () => {
  let database: NodeNarrativeDatabase;

  beforeEach(() => {
    database = new NodeNarrativeDatabase();
    database.migrate();
    new SqliteProjectRepository(database).insert(
      createProject({
        id: "golden-project",
        title: "雾港金样",
        now: "2026-08-10T00:00:00.000Z",
      }),
    );
  });

  afterEach(() => database.close());

  it.each(GOLDEN_RECALL_CASES)(
    "keeps $expectedSourceId at the top for $query",
    ({ query, expectedSourceId }) => {
      const retrieval = new SqliteRetrievalRepository(database);
      const now = "2026-08-10T00:00:00.000Z";
      retrieval.upsertSegment({
        id: "rule-segment",
        projectId: "golden-project",
        sourceType: "writing_skill",
        sourceId: "rule-pov",
        title: "用户硬规则：限知视角",
        content: "正文必须保持林昭限知视角，禁止全知旁白和越权心理描写。",
        authority: "locked",
        metadata: { scope: "all", priority: 100 },
        entityIds: [],
        createdAt: now,
        updatedAt: now,
      });
      database.raw
        .prepare(
          `INSERT INTO narrative_memories(
             id, project_id, layer, scope_type, scope_id, title, content,
             state_delta_json, source_hash, status, refreshed_at, created_at,
             updated_at
           ) VALUES (?, ?, 'episodic', 'chapter', ?, ?, ?, '{}', ?, 'active', ?, ?, ?)`,
        )
        .run(
          "episode-key",
          "golden-project",
          "chapter-1",
          "第一章情节记忆",
          "林昭确认铜钥匙属于旧港仓库，钥匙仍在她的外套内袋。",
          "episode-key-hash",
          now,
          now,
          now,
        );
      retrieval.upsertSegment({
        id: "episode-segment",
        projectId: "golden-project",
        sourceType: "narrative_memory",
        sourceId: "episode-key",
        title: "第一章情节记忆",
        content: "林昭确认铜钥匙属于旧港仓库，钥匙仍在她的外套内袋。",
        authority: "confirmed",
        metadata: { layer: "episodic" },
        entityIds: [],
        createdAt: now,
        updatedAt: now,
      });
      expect(
        retrieval.search("golden-project", query, { limit: 2, rerank: true })[0]
          ?.sourceId,
      ).toBe(expectedSourceId);
    },
  );

  it("flags a proposal that breaks locked continuity without mutating canon", () => {
    const canon = new SqliteCanonRepository(database);
    const hero = canon.insertEntity(
      createCanonEntity({
        id: "hero",
        projectId: "golden-project",
        type: "character",
        name: "林昭",
        now: "2026-08-10T00:00:00.000Z",
      }),
    );
    canon.insertFact(
      createCanonFact({
        id: "pov-fact",
        projectId: "golden-project",
        subjectId: hero.id,
        predicate: "叙事视角",
        value: "限知",
        authority: "locked",
        sourceType: "manual",
        now: "2026-08-10T00:00:00.000Z",
      }),
    );
    const before = canon.listEffectiveFacts("golden-project");
    const result = new SqliteLongNovelRepository(database).dryRun(
      "golden-project",
      "把林昭改为全知视角，并让林昭永久离开雾港",
    );
    expect(result.safeToProceed).toBe(false);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: "hero" }),
        expect.objectContaining({ sourceId: "pov-fact" }),
      ]),
    );
    expect(canon.listEffectiveFacts("golden-project")).toEqual(before);
  });
});
