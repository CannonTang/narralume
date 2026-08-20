import { ContextCompiler } from "@narrative-lantern/context";
import { NodeNarrativeDatabase } from "../src/node.js";
import { createProject } from "@narrative-lantern/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SqliteContextReceiptRepository,
  SqliteProjectRepository,
} from "../src/index.js";

let database: NodeNarrativeDatabase;

beforeEach(() => {
  database = new NodeNarrativeDatabase();
  database.migrate();
  new SqliteProjectRepository(database).insert(
    createProject({
      id: "p1",
      title: "Receipt Test",
      now: "2026-08-10T00:00:00.000Z",
    }),
  );
});

afterEach(() => database.close());

describe("SqliteContextReceiptRepository", () => {
  it("round-trips auditable compilation receipts within a project", () => {
    const compiled = new ContextCompiler(
      () => new Date("2026-08-10T00:00:00.000Z"),
    ).compile({
      projectId: "p1",
      purpose: "chapter-draft",
      budget: {
        contextWindow: 1000,
        outputReserve: 200,
        fixedInstructionReserve: 50,
        toolReserve: 50,
        schemaReserve: 50,
        safetyReserve: 50,
      },
      sources: [
        {
          id: "task",
          kind: "task",
          label: "本轮任务",
          content: "写出灯塔熄灭后的第一场戏。",
          authority: "locked",
          priority: 100,
          required: true,
          sourceType: "request",
        },
      ],
    });
    const repository = new SqliteContextReceiptRepository(database);
    repository.insert(compiled.receipt);

    expect(repository.get("p1", compiled.receipt.id)).toEqual(compiled.receipt);
    expect(repository.get("missing", compiled.receipt.id)).toBeNull();
    expect(repository.list("p1")).toHaveLength(1);
  });
});
