import { createProject } from "@narrative-lantern/domain";
import { NodeNarrativeDatabase } from "../src/node.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  DeliveryVersionConflictError,
  SqliteDeliveryRepository,
  SqliteProjectRepository,
} from "../src/index.js";

const databases: NodeNarrativeDatabase[] = [];

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

describe("SqliteDeliveryRepository", () => {
  it("keeps one active style and protects style/skill edits with versions", () => {
    const database = setupDatabase();
    const delivery = new SqliteDeliveryRepository(database);
    const now = "2026-08-10T00:00:00.000Z";

    delivery.insertStyleProfile({
      id: "style-1",
      projectId: "project-1",
      name: "冷光现实主义",
      description: null,
      rules: ["动作先于解释"],
      examples: [],
      negativeRules: ["避免替人物总结情绪"],
      source: "manual",
      active: true,
      status: "active",
      createdAt: now,
      updatedAt: now,
      version: 0,
    });
    delivery.insertStyleProfile({
      id: "style-2",
      projectId: "project-1",
      name: "潮汐抒情",
      description: "只在转场时使用意象",
      rules: ["句子长短交错"],
      examples: [],
      negativeRules: [],
      source: "manual",
      active: true,
      status: "active",
      createdAt: now,
      updatedAt: now,
      version: 0,
    });

    expect(delivery.getActiveStyleProfile("project-1")?.id).toBe("style-2");
    expect(delivery.getStyleProfile("style-1")).toMatchObject({
      active: false,
      version: 1,
    });
    expect(() =>
      delivery.updateStyleProfile("style-1", { active: true }, 0, now),
    ).toThrow(DeliveryVersionConflictError);

    delivery.insertWritingSkill({
      id: "skill-1",
      projectId: "project-1",
      name: "场景落点",
      description: null,
      instructions: "每个场景以不可逆选择收束。",
      scopes: ["chapter", "cocreate"],
      priority: 80,
      enabled: true,
      source: "manual",
      createdAt: now,
      updatedAt: now,
      version: 0,
    });
    expect(delivery.listApplicableSkills("project-1", "chapter")).toHaveLength(
      1,
    );
    expect(delivery.listApplicableSkills("project-1", "review")).toHaveLength(
      0,
    );
    expect(
      delivery.updateWritingSkill(
        "skill-1",
        { enabled: false },
        0,
        "2026-08-10T00:01:00.000Z",
      ),
    ).toMatchObject({ enabled: false, version: 1 });
  });

  it("round-trips preview candidates and integrity-bearing backups", () => {
    const database = setupDatabase();
    const delivery = new SqliteDeliveryRepository(database);
    const now = "2026-08-10T00:00:00.000Z";
    delivery.insertImportBatch({
      id: "batch-1",
      targetProjectId: "project-1",
      filename: "sample.md",
      format: "markdown",
      sourceHash: "abc",
      sourceCharacters: 12,
      status: "previewed",
      metadata: { title: "样稿" },
      analysisRunId: null,
      appliedProjectId: null,
      createdAt: now,
      updatedAt: now,
    });
    delivery.upsertImportCandidate({
      id: "candidate-1",
      batchId: "batch-1",
      kind: "document",
      ordinal: 0,
      title: "第一章",
      payload: { content: "潮水退去。" },
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    delivery.setCandidateStatus("candidate-1", "selected", now);
    expect(delivery.getImportBatchDetail("batch-1")).toMatchObject({
      batch: { filename: "sample.md" },
      candidates: [{ status: "selected" }],
    });

    delivery.insertBackup(
      {
        id: "backup-1",
        projectId: "project-1",
        label: "交付前",
        bundleHash: "hash",
        sizeBytes: 2,
        createdAt: now,
        restoredProjectId: null,
      },
      "{}",
    );
    expect(delivery.getBackup("backup-1")).toMatchObject({
      backup: { label: "交付前" },
      bundleJson: "{}",
    });
  });
});

function setupDatabase() {
  const database = new NodeNarrativeDatabase();
  databases.push(database);
  database.migrate();
  new SqliteProjectRepository(database).insert(
    createProject({
      id: "project-1",
      title: "潮汐档案",
      now: "2026-08-10T00:00:00.000Z",
    }),
  );
  return database;
}
