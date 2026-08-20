import {
  createDocument,
  createOutlineNode,
  createProject,
} from "@narrative-lantern/domain";
import { NodeNarrativeDatabase } from "../src/node.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SqliteDocumentRepository,
  SqliteProjectRepository,
  SqliteProjectStatisticsRepository,
  SqliteStoryRepository,
} from "../src/index.js";

const now = "2026-08-15T09:00:00.000Z";
let database: NodeNarrativeDatabase;

beforeEach(() => {
  database = new NodeNarrativeDatabase();
  database.migrate();
});

afterEach(() => database.close());

describe("SqliteProjectStatisticsRepository", () => {
  it("aggregates chapter progress and current-version text for multiple projects", () => {
    const projects = new SqliteProjectRepository(database);
    const story = new SqliteStoryRepository(database);
    const documents = new SqliteDocumentRepository(database);
    const statistics = new SqliteProjectStatisticsRepository(database);
    projects.insert(createProject({ id: "p1", title: "潮汐灯塔", now }));
    projects.insert(createProject({ id: "p2", title: "空白作品", now }));

    const book = story.insertOutlineNode(
      createOutlineNode({
        id: "book-1",
        projectId: "p1",
        parent: null,
        kind: "book",
        ordinal: 0,
        title: "潮汐灯塔",
        now,
      }),
    );
    const chapter1 = story.insertOutlineNode(
      createOutlineNode({
        id: "chapter-1",
        projectId: "p1",
        parent: book,
        kind: "chapter",
        ordinal: 0,
        title: "潮声",
        now,
      }),
    );
    const chapter2 = story.insertOutlineNode(
      createOutlineNode({
        id: "chapter-2",
        projectId: "p1",
        parent: book,
        kind: "chapter",
        ordinal: 1,
        title: "雾港",
        now,
      }),
    );
    story.updateOutlineStatus(
      "p1",
      chapter1.id,
      "committed",
      "2026-08-15T09:30:00.000Z",
    );

    documents.insert(
      createDocument({
        id: "document-1",
        projectId: "p1",
        kind: "chapter",
        title: chapter1.title,
        outlineNodeId: chapter1.id,
        now,
      }),
    );
    documents.insert(
      createDocument({
        id: "document-2",
        projectId: "p1",
        kind: "chapter",
        title: chapter2.title,
        outlineNodeId: chapter2.id,
        now,
      }),
    );
    documents.appendVersion("p1", "document-1", {
      id: "version-1",
      content: "潮 声\n三　岸",
      source: "manual",
      expectedCurrentVersionId: null,
      now: "2026-08-15T10:00:00.000Z",
    });
    documents.appendVersion("p1", "document-2", {
      id: "version-2",
      content: "雾\t港",
      source: "manual",
      expectedCurrentVersionId: null,
      now: "2026-08-15T11:00:00.000Z",
    });

    expect(statistics.list(["p1", "p2"])).toEqual(
      new Map([
        [
          "p1",
          {
            projectId: "p1",
            lastWritingAt: "2026-08-15T11:00:00.000Z",
            wordCount: 6,
            committedChapters: 1,
            totalChapters: 2,
          },
        ],
        [
          "p2",
          {
            projectId: "p2",
            lastWritingAt: null,
            wordCount: 0,
            committedChapters: 0,
            totalChapters: 0,
          },
        ],
      ]),
    );
    expect(statistics.get("missing")).toBeNull();
  });
});
