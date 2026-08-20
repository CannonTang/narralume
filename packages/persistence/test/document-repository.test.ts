import {
  createDocument,
  createOutlineNode,
  createProject,
} from "@narrative-lantern/domain";
import { NodeNarrativeDatabase } from "../src/node.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DocumentVersionConflictError,
  PersistenceNotFoundError,
  SqliteDocumentRepository,
  SqliteProjectRepository,
  SqliteStoryRepository,
} from "../src/index.js";

const now = "2026-08-10T00:00:00.000Z";
let database: NodeNarrativeDatabase;
let documents: SqliteDocumentRepository;

beforeEach(() => {
  database = new NodeNarrativeDatabase();
  database.migrate();
  const projects = new SqliteProjectRepository(database);
  projects.insert(createProject({ id: "p1", title: "潮汐灯塔", now }));
  projects.insert(createProject({ id: "p2", title: "另一部书", now }));
  documents = new SqliteDocumentRepository(database);
  documents.insert(
    createDocument({
      id: "doc-1",
      projectId: "p1",
      kind: "chapter",
      title: "第一章",
      now,
    }),
  );
});

afterEach(() => database.close());

describe("SqliteDocumentRepository", () => {
  it("appends an immutable hash-linked version chain", () => {
    const first = documents.appendVersion("p1", "doc-1", {
      id: "v1",
      content: "雾从海面涌来。",
      source: "manual",
      expectedCurrentVersionId: null,
      now,
    });
    const second = documents.appendVersion("p1", "doc-1", {
      id: "v2",
      content: "雾从海面涌来，灯塔熄灭了。",
      source: "co-create",
      expectedCurrentVersionId: first.id,
      now: "2026-08-10T00:01:00.000Z",
    });

    expect(second.parentVersionId).toBe(first.id);
    expect(second.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(documents.get("p1", "doc-1")?.currentVersionId).toBe("v2");
    expect(documents.listVersions("p1", "doc-1")).toHaveLength(2);
  });

  it("detects stale writes and restores by creating a new version", () => {
    documents.appendVersion("p1", "doc-1", {
      id: "v1",
      content: "original",
      source: "manual",
      expectedCurrentVersionId: null,
      now,
    });
    documents.appendVersion("p1", "doc-1", {
      id: "v2",
      content: "edited",
      source: "manual",
      expectedCurrentVersionId: "v1",
      now: "2026-08-10T00:01:00.000Z",
    });

    expect(() =>
      documents.appendVersion("p1", "doc-1", {
        id: "stale",
        content: "lost update",
        source: "manual",
        expectedCurrentVersionId: "v1",
        now: "2026-08-10T00:02:00.000Z",
      }),
    ).toThrow(DocumentVersionConflictError);

    const restored = documents.restoreVersion("p1", "doc-1", "v1", {
      id: "v3",
      source: "restore:v1",
      expectedCurrentVersionId: "v2",
      now: "2026-08-10T00:03:00.000Z",
    });
    expect(restored).toMatchObject({
      parentVersionId: "v2",
      content: "original",
      source: "restore:v1",
    });
  });

  it("autosaves one mutable draft without polluting the immutable version chain", () => {
    const first = documents.appendVersion("p1", "doc-1", {
      id: "v1",
      content: "正式版本",
      source: "manual",
      expectedCurrentVersionId: null,
      now,
    });
    const initialDraft = documents.upsertDraft("p1", "doc-1", {
      baseVersionId: first.id,
      content: "尚未完成的第一段",
      now: "2026-08-10T00:01:00.000Z",
    });
    const latestDraft = documents.upsertDraft("p1", "doc-1", {
      baseVersionId: first.id,
      content: "尚未完成的第二段",
      now: "2026-08-10T00:02:00.000Z",
    });

    expect(initialDraft.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(documents.getDraft("p1", "doc-1")).toEqual(latestDraft);
    expect(documents.listVersions("p1", "doc-1")).toHaveLength(1);
    expect(documents.deleteDraft("p1", "doc-1", "错误内容")).toBe(false);
    expect(documents.getDraft("p1", "doc-1")).not.toBeNull();
    expect(documents.deleteDraft("p1", "doc-1", "尚未完成的第二段")).toBe(true);
    expect(documents.getDraft("p1", "doc-1")).toBeNull();
  });

  it("enforces project scope for documents and versions", () => {
    expect(documents.get("p2", "doc-1")).toBeNull();
    expect(() => documents.listVersions("p2", "doc-1")).toThrow(
      PersistenceNotFoundError,
    );
  });

  it("binds chapter documents to outline identity instead of title", () => {
    const story = new SqliteStoryRepository(database);
    const root = story.insertOutlineNode(
      createOutlineNode({
        id: "book",
        projectId: "p1",
        parent: null,
        kind: "book",
        ordinal: 0,
        title: "同名章节测试",
        now,
      }),
    );
    const firstChapter = story.insertOutlineNode(
      createOutlineNode({
        id: "chapter-a",
        projectId: "p1",
        parent: root,
        kind: "chapter",
        ordinal: 0,
        title: "回声",
        now,
      }),
    );
    const secondChapter = story.insertOutlineNode(
      createOutlineNode({
        id: "chapter-b",
        projectId: "p1",
        parent: root,
        kind: "chapter",
        ordinal: 1,
        title: "回声",
        now,
      }),
    );

    const firstDocument = documents.insert(
      createDocument({
        id: "doc-a",
        projectId: "p1",
        kind: "chapter",
        title: "回声",
        outlineNodeId: firstChapter.id,
        now,
      }),
    );
    const secondDocument = documents.insert(
      createDocument({
        id: "doc-b",
        projectId: "p1",
        kind: "chapter",
        title: "回声",
        outlineNodeId: secondChapter.id,
        now,
      }),
    );

    expect(documents.getByOutlineNodeId("p1", firstChapter.id)?.id).toBe(
      firstDocument.id,
    );
    expect(documents.getByOutlineNodeId("p1", secondChapter.id)?.id).toBe(
      secondDocument.id,
    );
    expect(() =>
      documents.insert(
        createDocument({
          id: "doc-duplicate-binding",
          projectId: "p1",
          kind: "chapter",
          title: "另一个标题",
          outlineNodeId: firstChapter.id,
          now,
        }),
      ),
    ).toThrow();
  });
});
