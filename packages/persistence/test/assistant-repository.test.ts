import { createProject } from "@narralume/domain";
import { NodeNarrativeDatabase } from "../src/node.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AssistantPersistenceError,
  SqliteAssistantRepository,
  SqliteProjectRepository,
} from "../src/index.js";

const now = "2026-08-13T00:00:00.000Z";
let database: NodeNarrativeDatabase;
let assistant: SqliteAssistantRepository;

beforeEach(() => {
  database = new NodeNarrativeDatabase();
  database.migrate();
  new SqliteProjectRepository(database).insert(
    createProject({ id: "p-1", title: "潮汐灯塔", now }),
  );
  assistant = new SqliteAssistantRepository(database);
});

afterEach(() => database.close());

describe("SqliteAssistantRepository", () => {
  it("persists one project conversation and restores message context", () => {
    const conversation = assistant.insertConversation({
      id: "conversation-1",
      projectId: "p-1",
      title: "项目协作",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const message = assistant.insertMessage({
      id: "message-1",
      conversationId: conversation.id,
      role: "user",
      content: "请写当前章节",
      context: {
        surface: "writing",
        documentId: "document-1",
        outlineNodeId: "chapter-1",
        canonSpread: null,
        selection: { start: 2, end: 5, text: "潮声" },
      },
      sourceRunId: null,
      replyToMessageId: null,
      createdAt: "2026-08-13T00:01:00.000Z",
    });

    expect(message.context).toMatchObject({
      surface: "writing",
      outlineNodeId: "chapter-1",
      selection: { start: 2, end: 5, text: "潮声" },
    });
    expect(assistant.listConversations("p-1")).toHaveLength(1);
    expect(
      assistant.listMessages(conversation.id).map((item) => item.id),
    ).toEqual(["message-1"]);
    expect(assistant.requireConversation(conversation.id).updatedAt).toBe(
      "2026-08-13T00:01:00.000Z",
    );
  });

  it("stages and resolves a tool proposal exactly once", () => {
    assistant.insertConversation({
      id: "conversation-1",
      projectId: "p-1",
      title: "项目协作",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const activity = assistant.insertActivity({
      id: "activity-1",
      conversationId: "conversation-1",
      messageId: null,
      kind: "tool_proposal",
      toolName: "chapter.start",
      status: "proposed",
      goal: "开始写《雾港》",
      input: { targetOutlineNodeId: "chapter-1" },
      result: null,
      error: null,
      sourceType: null,
      sourceId: null,
      origin: {
        surface: "writing",
        documentId: null,
        outlineNodeId: "chapter-1",
        canonSpread: null,
        selection: null,
      },
      executionMode: null,
      skillId: null,
      phaseKey: null,
      artifacts: null,
      createdAt: now,
      updatedAt: now,
    });
    const completed = assistant.transitionActivity(activity.id, "proposed", {
      status: "completed",
      result: { runId: "run-1" },
      sourceType: "run",
      sourceId: "run-1",
      now: "2026-08-13T00:02:00.000Z",
    });
    expect(completed).toMatchObject({
      status: "completed",
      sourceType: "run",
      sourceId: "run-1",
      result: { runId: "run-1" },
    });
    expect(() =>
      assistant.transitionActivity(activity.id, "proposed", {
        status: "rejected",
        now: "2026-08-13T00:03:00.000Z",
      }),
    ).toThrowError(AssistantPersistenceError);
  });

  it("cascades assistant records when a project is removed", () => {
    assistant.insertConversation({
      id: "conversation-1",
      projectId: "p-1",
      title: "项目协作",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    database.raw.prepare("DELETE FROM projects WHERE id = ?").run("p-1");
    expect(assistant.getConversation("conversation-1")).toBeNull();
  });
});
