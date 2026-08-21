import type { NarrativeModelClient } from "@narralume/narrative";
import { buildFoundationRecipe } from "@narralume/harness";
import {
  SqliteAssistantRepository,
  SqliteAutomationRepository,
  SqliteRunRepository,
} from "@narralume/persistence";
import { NodeNarrativeDatabase } from "@narralume/persistence/node";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

const config: ServerConfig = {
  dataDirectory: ".",
  databasePath: ":memory:",
  host: "127.0.0.1",
  port: 4317,
  environment: "test",
};

const resources: {
  app: Awaited<ReturnType<typeof buildApp>>;
  database: NodeNarrativeDatabase;
}[] = [];

afterEach(async () => {
  while (resources.length) {
    const resource = resources.pop();
    await resource?.app.close();
    resource?.database.close();
  }
});

describe("project assistant API", () => {
  it("rejects conversation idempotency keys reused with a different title", async () => {
    const { app } = await setup();
    const projectId = await createProject(app, "会话幂等");
    const first = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/assistant/conversations`,
      payload: { requestId: "same-conversation", title: "项目协作" },
    });
    const replay = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/assistant/conversations`,
      payload: { requestId: "same-conversation", title: "项目协作" },
    });
    const conflict = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/assistant/conversations`,
      payload: { requestId: "same-conversation", title: "另一条会话" },
    });

    expect(first.statusCode, first.body).toBe(201);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(conflict.statusCode, conflict.body).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: { code: "assistant.conversation.idempotency_conflict" },
    });
  });

  it("lists, switches through and archives conversations without deleting history (CR-11)", async () => {
    const { app } = await setup();
    const projectId = await createProject(app, "协作会话归档");
    const first = await createConversation(app, projectId, "conversation-one");
    const second = await createConversation(app, projectId, "conversation-two");

    const archived = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${first.id}/actions`,
      payload: { action: "archive" },
    });
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json()).toMatchObject({ id: first.id, status: "archived" });

    const listed = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/assistant/conversations`,
    });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, status: "archived" }),
        expect.objectContaining({ id: second.id, status: "active" }),
      ]),
    );
    const detail = await app.inject({
      method: "GET",
      url: `/api/assistant/conversations/${first.id}`,
    });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json()).toMatchObject({
      conversation: { id: first.id, status: "archived" },
    });
    const send = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${first.id}/messages`,
      payload: {
        requestId: "archived-message",
        content: "继续讨论",
        context: {
          surface: "project",
          documentId: null,
          outlineNodeId: null,
          canonSpread: null,
          selection: null,
        },
      },
    });
    expect(send.statusCode, send.body).toBe(409);
    expect(send.json()).toMatchObject({
      error: { code: "assistant.conversation.archived" },
    });
  });

  it("renames a conversation through the actions endpoint and rejects blank titles", async () => {
    const { app } = await setup();
    const projectId = await createProject(app, "协作会话重命名");
    const conversation = await createConversation(
      app,
      projectId,
      "conversation-rename",
    );

    const renamed = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/actions`,
      payload: { action: "rename", title: "伏笔整理" },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json()).toMatchObject({
      id: conversation.id,
      title: "伏笔整理",
      status: "active",
    });

    const listed = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/assistant/conversations`,
    });
    expect(listed.json()).toEqual([
      expect.objectContaining({
        id: conversation.id,
        title: "伏笔整理",
      }),
    ]);

    const blank = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/actions`,
      payload: { action: "rename", title: "   " },
    });
    expect(blank.statusCode).toBe(400);
  });

  it("configures per-conversation model and reasoning effort; cross-protocol is rejected", async () => {
    const { app } = await setup();
    const projectId = await createProject(app, "协作会话模型");
    const conversation = await createConversation(
      app,
      projectId,
      "conversation-configure",
    );
    /* 环境种子给出 environment-chat（openai-chat）作为全局 writing 分配；
       手动再造一个同协议模型和一个跨协议模型。 */
    const chatProvider = (
      await app.inject({ method: "GET", url: "/api/providers" })
    ).json() as { id: string; wireApi: string }[];
    const chat = chatProvider.find((p) => p.wireApi === "openai-chat")!;
    expect(chat).toBeTruthy();
    const sameWire = await app.inject({
      method: "POST",
      url: "/api/models",
      payload: {
        providerId: chat.id,
        modelId: "same-wire-model",
        taskType: "writing",
        contextWindow: 128_000,
        maxOutputTokens: 32_000,
      },
    });
    expect(sameWire.statusCode, sameWire.body).toBe(201);
    const crossWire = await app.inject({
      method: "POST",
      url: "/api/providers",
      payload: {
        name: "跨协议 Provider",
        wireApi: "anthropic-messages",
        baseUrl: "https://api.anthropic.example.com",
        credentialRef: "test-key",
      },
    });
    expect(crossWire.statusCode, crossWire.body).toBe(201);
    const crossModel = await app.inject({
      method: "POST",
      url: "/api/models",
      payload: {
        providerId: (crossWire.json() as { id: string }).id,
        modelId: "anthropic-model",
        taskType: "writing",
        contextWindow: 128_000,
        maxOutputTokens: 32_000,
      },
    });
    expect(crossModel.statusCode, crossModel.body).toBe(201);

    const configured = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/actions`,
      payload: { action: "configure", modelId: sameWire.json().id },
    });
    expect(configured.statusCode, configured.body).toBe(200);
    expect(configured.json()).toMatchObject({
      id: conversation.id,
      settings: { modelId: sameWire.json().id, reasoningEffort: null },
    });

    const effortSet = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/actions`,
      payload: { action: "configure", reasoningEffort: "high" },
    });
    expect(effortSet.statusCode, effortSet.body).toBe(200);
    expect(effortSet.json()).toMatchObject({
      settings: { modelId: sameWire.json().id, reasoningEffort: "high" },
    });

    const cross = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/actions`,
      payload: { action: "configure", modelId: crossModel.json().id },
    });
    expect(cross.statusCode, cross.body).toBe(422);
    expect(cross.json()).toMatchObject({
      error: { code: "assistant.model.protocol_mismatch" },
    });

    const unknown = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/actions`,
      payload: { action: "configure", modelId: "no-such-model" },
    });
    expect(unknown.statusCode).toBe(422);

    const cleared = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/actions`,
      payload: { action: "configure", modelId: null },
    });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json()).toMatchObject({
      settings: { modelId: null, reasoningEffort: "high" },
    });
  });

  it("sends messages with the configured model override and rejects a dead override", async () => {
    const { app, database } = await setup(() => ({
      reply: "按对话指定的模型作答。",
      toolCall: null,
    }));
    const projectId = await createProject(app, "协作会话模型覆盖");
    const conversation = await createConversation(
      app,
      projectId,
      "conversation-override",
    );
    const chatProvider = (
      await app.inject({ method: "GET", url: "/api/providers" })
    ).json() as { id: string; wireApi: string }[];
    const chat = chatProvider.find((p) => p.wireApi === "openai-chat")!;
    const overrideModel = await app.inject({
      method: "POST",
      url: "/api/models",
      payload: {
        providerId: chat.id,
        modelId: "conversation-model",
        taskType: "writing",
        contextWindow: 128_000,
        maxOutputTokens: 32_000,
      },
    });
    const modelId = (overrideModel.json() as { id: string }).id;
    const configured = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/actions`,
      payload: { action: "configure", modelId, reasoningEffort: "medium" },
    });
    expect(configured.statusCode, configured.body).toBe(200);

    const sent = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/messages`,
      payload: {
        requestId: "configure-send",
        content: "用当前模型回答。",
        context: { surface: "project" },
      },
    });
    expect(sent.statusCode, sent.body).toBe(202);
    const runId = (sent.json() as { runId: string }).runId;
    await finishRun(app, projectId, runId);

    const runs = new SqliteRunRepository(database);
    const run = runs.getRun(runId)!;
    expect(run.policy).toMatchObject({
      assistantModelId: modelId,
      assistantReasoningEffort: "medium",
    });

    /* 覆盖模型被停用后，发消息明确失败并提示重选。 */
    const disabled = await app.inject({
      method: "PUT",
      url: `/api/models/${modelId}`,
      payload: {
        providerId: chat.id,
        modelId: "conversation-model",
        taskType: "writing",
        contextWindow: 128_000,
        maxOutputTokens: 32_000,
        enabled: false,
        expectedUpdatedAt: (overrideModel.json() as { updatedAt: string })
          .updatedAt,
      },
    });
    expect(disabled.statusCode, disabled.body).toBe(200);
    const rejected = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/messages`,
      payload: {
        requestId: "configure-send-dead",
        content: "再发一条。",
        context: { surface: "project" },
      },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json()).toMatchObject({
      error: { code: "assistant.model.not_available" },
    });
  });

  it("keeps one response in flight and freezes context at its triggering message", async () => {
    const { app, database } = await setup(() => ({
      reply: "我只根据触发这次回答时已经存在的消息作答。",
      toolCall: null,
    }));
    const projectId = await createProject(app, "协作消息顺序");
    const conversation = await createConversation(
      app,
      projectId,
      "assistant-conv-order",
    );
    const context = {
      surface: "overview",
      documentId: null,
      outlineNodeId: null,
      canonSpread: null,
      selection: null,
    };
    const first = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/messages`,
      payload: {
        requestId: "assistant-order-first",
        content: "先概括当前故事。",
        context,
      },
    });
    expect(first.statusCode, first.body).toBe(202);
    const accepted = first.json() as {
      runId: string;
      message: { id: string; createdAt: string };
    };

    const replay = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/messages`,
      payload: {
        requestId: "assistant-order-first",
        content: "先概括当前故事。",
        context,
      },
    });
    expect(replay.statusCode, replay.body).toBe(202);
    expect(replay.json()).toMatchObject({
      runId: accepted.runId,
      idempotentReplay: true,
    });

    const overlapping = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/messages`,
      payload: {
        requestId: "assistant-order-second",
        content: "再开始写下一章。",
        context,
      },
    });
    expect(overlapping.statusCode, overlapping.body).toBe(409);
    expect(overlapping.json()).toMatchObject({
      error: { code: "assistant.message.response_in_progress" },
    });

    new SqliteAssistantRepository(database).insertMessage({
      id: "legacy-later-message",
      conversationId: conversation.id,
      role: "user",
      content: "这条模拟旧版本并发写入，不得进入前一个回答的上下文。",
      context,
      sourceRunId: null,
      replyToMessageId: null,
      createdAt: new Date(
        Date.parse(accepted.message.createdAt) + 1_000,
      ).toISOString(),
    });

    const advanced = await app.inject({
      method: "POST",
      url: `/api/runs/${accepted.runId}/advance`,
      payload: { projectId },
    });
    expect(advanced.statusCode, advanced.body).toBe(200);
    const snapshot = new SqliteRunRepository(database).getSnapshot(
      accepted.runId,
    );
    const artifact = snapshot.steps.find(
      (step) => step.kind === "assistant.context",
    )?.outputArtifact as {
      context?: string;
      controllableSources?: string[];
    } | null;
    expect(artifact).toBeTruthy();
    const packet = JSON.parse(artifact!.context!) as {
      conversation: { content: string }[];
      activeTasks: { runs: { recipe: string }[] };
    };
    expect(packet.conversation.map((message) => message.content)).toEqual([
      "先概括当前故事。",
    ]);
    expect(packet.activeTasks.runs).toEqual([]);
    expect(artifact!.controllableSources).toEqual([]);
  });

  it("exposes one-based chapter labels and hides zero-based outline paths", async () => {
    const { app, database } = await setup(() => ({
      reply: "第一章已经有细纲。",
      toolCall: null,
    }));
    const projectId = await createProject(app, "章节序号");
    const chapterId = await createChapter(app, projectId, "雾港失灯");
    const conversation = await createConversation(
      app,
      projectId,
      "assistant-conv-chapter-number",
    );
    const sent = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/messages`,
      payload: {
        requestId: "assistant-chapter-number-1",
        content: "现在写到第几章？",
        context: { surface: "overview" },
      },
    });
    expect(sent.statusCode, sent.body).toBe(202);
    const runId = (sent.json() as { runId: string }).runId;

    const advanced = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/advance`,
      payload: { projectId },
    });
    expect(advanced.statusCode, advanced.body).toBe(200);
    const artifact = new SqliteRunRepository(database)
      .getSnapshot(runId)
      .steps.find((step) => step.kind === "assistant.context")
      ?.outputArtifact as { context?: string } | null;
    const packet = JSON.parse(artifact!.context!) as {
      outline: Array<Record<string, unknown>>;
    };
    const chapter = packet.outline.find((node) => node.id === chapterId);

    expect(chapter).toMatchObject({
      id: chapterId,
      kind: "chapter",
      chapterNumber: 1,
      displayLabel: "第1章",
    });
    expect(chapter).not.toHaveProperty("path");
  });

  it("only exposes executable controls for recoverable runs (CR-34)", async () => {
    const { app, database } = await setup(() => ({
      reply: "这项任务正在等待自动重试，目前只适合取消。",
      toolCall: null,
    }));
    const projectId = await createProject(app, "残稿恢复控制");
    const conversation = await createConversation(
      app,
      projectId,
      "assistant-conv-recoverable",
    );
    const sourceRunId = "recoverable-source-run";
    const recipe = buildFoundationRecipe(sourceRunId);
    const runs = new SqliteRunRepository(database);
    runs.create({
      id: sourceRunId,
      projectId,
      recipe: recipe.name,
      recipeVersion: recipe.version,
      mode: "manual",
      targetOutlineNodeId: null,
      policy: {},
      budgetLimit: {
        maxInputTokens: 10_000,
        maxOutputTokens: 2_000,
        maxCalls: 2,
        maxCostUsd: null,
        maxWallTimeMs: 60_000,
      },
      steps: recipe.steps,
      now: new Date().toISOString(),
    });
    runs.setRunStatus(
      sourceRunId,
      "failed_recoverable",
      new Date().toISOString(),
      "request_start_timeout",
    );

    const sent = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/messages`,
      payload: {
        requestId: "inspect-recoverable-run",
        content: "这个任务现在能做什么？",
        context: {
          surface: "runs",
          documentId: null,
          outlineNodeId: null,
          canonSpread: null,
          selection: null,
        },
      },
    });
    expect(sent.statusCode, sent.body).toBe(202);
    const assistantRunId = (sent.json() as { runId: string }).runId;
    const advanced = await app.inject({
      method: "POST",
      url: `/api/runs/${assistantRunId}/advance`,
      payload: { projectId },
    });
    expect(advanced.statusCode, advanced.body).toBe(200);
    const artifact = runs
      .getSnapshot(assistantRunId)
      .steps.find((step) => step.kind === "assistant.context")
      ?.outputArtifact as {
      context?: string;
      controllableSources?: string[];
    } | null;
    const packet = JSON.parse(artifact!.context!) as {
      activeTasks: {
        runs: { id: string; availableActions: string[] }[];
      };
    };
    expect(
      packet.activeTasks.runs.find((run) => run.id === sourceRunId),
    ).toMatchObject({ availableActions: ["cancel"] });
    expect(artifact!.controllableSources).toContain(
      `run:${sourceRunId}:cancel`,
    );
    expect(artifact!.controllableSources).not.toContain(
      `run:${sourceRunId}:resume`,
    );
  });

  it("persists a grounded turn, restores its timeline and confirms an existing chapter task exactly once", async () => {
    let chapterId = "";
    const { app, database } = await setup(() => ({
      reply: "我可以按《雾港失灯》的既有细纲生成候选正文，确认后才会开工。",
      toolCall: {
        name: "chapter.start",
        arguments: { targetOutlineNodeId: chapterId },
      },
    }));
    const projectId = await createProject(app, "潮汐灯塔");
    chapterId = await createChapter(app, projectId, "雾港失灯");
    const conversation = await createConversation(
      app,
      projectId,
      "assistant-conv-1",
    );

    const payload = {
      requestId: "assistant-message-1",
      content: "请按当前细纲写这一章。",
      context: {
        surface: "studio",
        documentId: null,
        outlineNodeId: chapterId,
        canonSpread: null,
        selection: null,
      },
    };
    const created = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/messages`,
      payload,
    });
    const replay = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/messages`,
      payload,
    });
    expect(created.statusCode, created.body).toBe(202);
    expect(replay.statusCode, replay.body).toBe(202);
    expect(replay.json()).toMatchObject({
      runId: created.json().runId,
      idempotentReplay: true,
    });

    await finishRun(app, projectId, created.json().runId as string);
    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/assistant/conversations/${conversation.id}`,
    });
    expect(detailResponse.statusCode, detailResponse.body).toBe(200);
    const detail = detailResponse.json() as {
      messages: { role: string; content: string; context: unknown }[];
      activities: {
        kind: string;
        status: string;
        sourceId: string;
        toolCall: { name: string; arguments: Record<string, unknown> } | null;
      }[];
      tools: { name: string; access: string }[];
    };
    expect(detail.messages).toHaveLength(2);
    expect(detail.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(detail.messages[1]!.content).toContain("确认后才会开工");
    expect(detail.tools.map((tool) => tool.name)).toEqual([
      "story.inspect",
      "review.inspect",
      "foundation.start",
      "chapter.start",
      "autopilot.start",
      "outline.plan.start",
      "canon.candidate.start",
      "selection.edit.start",
      "long_goal.start",
      "task.control",
    ]);
    const proposal = detail.activities.find(
      (activity) => activity.kind === "tool",
    );
    expect(proposal).toMatchObject({
      status: "proposed",
      toolCall: {
        name: "chapter.start",
        arguments: { targetOutlineNodeId: chapterId },
      },
    });

    const confirmed = await app.inject({
      method: "POST",
      url: `/api/assistant/activities/${proposal!.sourceId}/actions`,
      payload: { action: "confirm" },
    });
    const confirmReplay = await app.inject({
      method: "POST",
      url: `/api/assistant/activities/${proposal!.sourceId}/actions`,
      payload: { action: "confirm" },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmReplay.statusCode, confirmReplay.body).toBe(200);
    expect(confirmed.json()).toMatchObject({
      activity: { status: "completed" },
      source: { type: "run" },
    });
    expect(confirmReplay.json().source).toEqual(confirmed.json().source);
    const sourceRunId = confirmed.json().source.id as string;
    const source = new SqliteRunRepository(database).getSnapshot(sourceRunId);
    expect(source.run).toMatchObject({
      projectId,
      recipe: "chapter-production",
      targetOutlineNodeId: chapterId,
    });
    expect(source.run.policy).toMatchObject({
      assistantConversationId: conversation.id,
      assistantActivityId: proposal!.sourceId,
    });

    const restored = (
      await app.inject({
        method: "GET",
        url: `/api/assistant/conversations/${conversation.id}`,
      })
    ).json() as {
      activities: { kind: string; status: string; sourceId: string }[];
    };
    expect(restored.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool",
          status: "completed",
          sourceId: sourceRunId,
        }),
        expect.objectContaining({
          kind: "task",
          sourceId: sourceRunId,
        }),
      ]),
    );
  });

  it("rejects foreign context and conflicting message replays", async () => {
    const { app } = await setup(() => ({
      reply: "当前没有需要执行的操作。",
      toolCall: null,
    }));
    const firstProjectId = await createProject(app, "第一本书");
    const secondProjectId = await createProject(app, "第二本书");
    const foreignDocument = (
      await app.inject({
        method: "POST",
        url: `/api/projects/${secondProjectId}/documents`,
        payload: {
          requestId: "assistant-foreign-document",
          kind: "note",
          title: "外来笔记",
          outlineNodeId: null,
        },
      })
    ).json() as { id: string };
    const conversation = await createConversation(
      app,
      firstProjectId,
      "assistant-conv-context",
    );
    const context = {
      surface: "studio",
      documentId: foreignDocument.id,
      outlineNodeId: null,
      canonSpread: null,
      selection: null,
    };
    const foreign = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/messages`,
      payload: { requestId: "foreign-context", content: "看看正文", context },
    });
    expect(foreign.statusCode, foreign.body).toBe(422);
    expect(foreign.json()).toMatchObject({
      error: { code: "assistant.context.document_not_found" },
    });

    const validContext = { ...context, documentId: null };
    const first = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/messages`,
      payload: {
        requestId: "conflicting-message",
        content: "先分析故事",
        context: validContext,
      },
    });
    const conflict = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/messages`,
      payload: {
        requestId: "conflicting-message",
        content: "改成直接写正文",
        context: validContext,
      },
    });
    expect(first.statusCode, first.body).toBe(202);
    expect(conflict.statusCode, conflict.body).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: { code: "assistant.message.idempotency_conflict" },
    });
  });

  it("keeps a rejected proposal rejected without creating a task", async () => {
    const { app, database } = await setup(() => ({
      reply: "我可以先整理故事方向，确认后生成候选。",
      toolCall: {
        name: "foundation.start",
        arguments: { braindump: "一座会忘记寄件人的潮汐邮局" },
      },
    }));
    const projectId = await createProject(app, "回声邮局");
    const conversation = await createConversation(
      app,
      projectId,
      "reject-conv",
    );
    const sent = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/messages`,
      payload: {
        requestId: "reject-message",
        content: "帮我整理故事方向",
        context: {
          surface: "story-bible",
          documentId: null,
          outlineNodeId: null,
          canonSpread: "intent",
          selection: null,
        },
      },
    });
    await finishRun(app, projectId, sent.json().runId as string);
    const before = (
      await app.inject({
        method: "GET",
        url: `/api/assistant/conversations/${conversation.id}`,
      })
    ).json() as { activities: { kind: string; sourceId: string }[] };
    const proposal = before.activities.find(
      (activity) => activity.kind === "tool",
    )!;
    const rejected = await app.inject({
      method: "POST",
      url: `/api/assistant/activities/${proposal.sourceId}/actions`,
      payload: { action: "reject" },
    });
    const replay = await app.inject({
      method: "POST",
      url: `/api/assistant/activities/${proposal.sourceId}/actions`,
      payload: { action: "reject" },
    });
    expect(rejected.statusCode, rejected.body).toBe(200);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toMatchObject({
      activity: { status: "rejected" },
      source: null,
    });
    expect(
      new SqliteRunRepository(database)
        .listRuns(projectId)
        .filter((run) => run.recipe === "book-foundation"),
    ).toHaveLength(0);
  });

  it("starts and controls continuous creation through confirmed proposals", async () => {
    let reply: {
      reply: string;
      toolCall: null | { name: string; arguments: Record<string, unknown> };
    } = {
      reply: "确认后连续创作两章。",
      toolCall: {
        name: "autopilot.start",
        arguments: { targetChapters: 2, approvalMode: "continuous" },
      },
    };
    const { app, database } = await setup(() => reply);
    const projectId = await createProject(app, "潮声档案");
    const conversation = await createConversation(
      app,
      projectId,
      "autopilot-conversation",
    );
    const context = {
      surface: "project-overview",
      documentId: null,
      outlineNodeId: null,
      canonSpread: null,
      selection: null,
    };
    const started = await sendAndFinish(
      app,
      projectId,
      conversation.id,
      "start-autopilot",
      "连续创作两章",
      context,
    );
    const startProposal = await onlyProposal(app, conversation.id, started);
    const confirmed = await app.inject({
      method: "POST",
      url: `/api/assistant/activities/${startProposal}/actions`,
      payload: { action: "confirm" },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json()).toMatchObject({
      source: { type: "autopilot" },
    });
    const sessionId = confirmed.json().source.id as string;
    expect(
      new SqliteAutomationRepository(database).requireSession(sessionId),
    ).toMatchObject({
      projectId,
      status: "pending",
      targetChapters: 2,
      mode: "autopilot",
    });

    reply = {
      reply: "确认后暂停当前连续创作。",
      toolCall: {
        name: "task.control",
        arguments: {
          sourceType: "autopilot",
          sourceId: sessionId,
          action: "pause",
        },
      },
    };
    const paused = await sendAndFinish(
      app,
      projectId,
      conversation.id,
      "pause-autopilot",
      "先暂停",
      context,
    );
    // R6：task.control 是直接执行的任务控制，不再进入待确认卡片。
    expect(
      new SqliteAutomationRepository(database).requireSession(sessionId)
        .pauseRequested,
    ).toBe(true);
    const pauseDetail = (
      await app.inject({
        method: "GET",
        url: `/api/assistant/conversations/${conversation.id}`,
      })
    ).json() as {
      activities: { kind: string; status: string; id: string }[];
    };
    const pauseActivity = pauseDetail.activities.find(
      (activity) => activity.kind === "tool" && activity.id.includes(paused),
    );
    expect(pauseActivity).toMatchObject({ status: "completed" });
  });

  it("keeps conversation activities explicitly bound and classifies their layer (CR-06, CR-13)", async () => {
    const { app, database } = await setup();
    const projectId = await createProject(app, "会话任务隔离");
    const first = await createConversation(
      app,
      projectId,
      "first-conversation",
    );
    const second = await createConversation(
      app,
      projectId,
      "second-conversation",
    );
    const runs = new SqliteRunRepository(database);

    for (const [suffix, assistantConversationId] of [
      ["bound", first.id],
      ["unbound", null],
    ] as const) {
      const runId = `foundation-${suffix}`;
      const recipe = buildFoundationRecipe(runId);
      runs.create({
        id: runId,
        projectId,
        recipe: recipe.name,
        recipeVersion: recipe.version,
        mode: "manual",
        targetOutlineNodeId: null,
        policy: assistantConversationId ? { assistantConversationId } : {},
        budgetLimit: {
          maxInputTokens: 10_000,
          maxOutputTokens: 2_000,
          maxCalls: 2,
          maxCostUsd: null,
          maxWallTimeMs: 60_000,
        },
        steps: recipe.steps,
        now: new Date().toISOString(),
      });
    }

    const firstDetail = (
      await app.inject({
        method: "GET",
        url: `/api/assistant/conversations/${first.id}`,
      })
    ).json() as {
      activities: { sourceId: string; layer: string }[];
    };
    const secondDetail = (
      await app.inject({
        method: "GET",
        url: `/api/assistant/conversations/${second.id}`,
      })
    ).json() as {
      activities: { sourceId: string; layer: string }[];
    };

    expect(firstDetail.activities).toEqual([
      expect.objectContaining({
        sourceId: "foundation-bound",
        layer: "primary",
      }),
    ]);
    expect(secondDetail.activities).toEqual([]);
  });

  it("会话卡吸收快速创作子运行：同一等待只出一张卡", async () => {
    const { app, database } = await setup();
    const projectId = await createProject(app, "去重验证");
    const conversation = await createConversation(
      app,
      projectId,
      "dedup-conversation",
    );
    const runs = new SqliteRunRepository(database);
    const automation = new SqliteAutomationRepository(database);
    const now = new Date().toISOString();

    // 直接用 repository 建会话并挂子运行：assistantConversationId 是
    // executor 内部注入的字段，HTTP 入口的策略校验不认它。
    const sessionId = "dedup-session";
    automation.createSession({
      id: sessionId,
      projectId,
      mode: "chapter-gate",
      targetChapters: 2,
      windowSize: 2,
      maxRevisionCycles: 2,
      chapterPolicy: {
        assistantConversationId: conversation.id,
      },
      now,
    });

    const runId = "dedup-child-run";
    runs.create({
      id: runId,
      projectId,
      recipe: "chapter-production",
      recipeVersion: 1,
      mode: "chapter-gate",
      targetOutlineNodeId: null,
      policy: { assistantConversationId: conversation.id },
      steps: [
        { kind: "scene.plan", maxAttempts: 5 },
        { kind: "draft.generate", maxAttempts: 5 },
        { kind: "chapter.commit", maxAttempts: 1 },
      ].map((step, ordinal) => ({
        id: `${runId}:${step.kind}`,
        ordinal,
        kind: step.kind,
        cycle: 0,
        maxAttempts: step.maxAttempts,
        idempotencyKey: `${runId}/${step.kind}`,
      })),
      now,
    });
    automation.attachRun(sessionId, {
      runId,
      role: "chapter",
      outlineNodeId: null,
      now,
    });

    const detail = (
      await app.inject({
        method: "GET",
        url: `/api/assistant/conversations/${conversation.id}`,
      })
    ).json() as { activities: { id: string; sourceType: string }[] };

    const ids = detail.activities.map((activity) => activity.id);
    expect(ids).toContain(`autopilot:${sessionId}`);
    // 子运行已被会话卡吸收，不再单独成卡。
    expect(ids).not.toContain(`run:${runId}`);
  });

  it("lets the assistant recover its bound failed quick-creation task (CR-01)", async () => {
    let sessionId = "";
    const { app, database } = await setup(() => ({
      reply: "我可以重试当前章节。",
      toolCall: {
        name: "task.control",
        arguments: {
          sourceType: "autopilot",
          sourceId: sessionId,
          action: "retry-current",
        },
      },
    }));
    const projectId = await createProject(app, "失败航次恢复");
    const conversation = await createConversation(
      app,
      projectId,
      "failed-autopilot-conversation",
    );
    const otherConversation = await createConversation(
      app,
      projectId,
      "other-autopilot-conversation",
    );
    sessionId = "failed-autopilot-session";
    const automation = new SqliteAutomationRepository(database);
    const now = new Date().toISOString();
    automation.createSession({
      id: sessionId,
      projectId,
      mode: "autopilot",
      targetChapters: 2,
      windowSize: 2,
      maxRevisionCycles: 2,
      chapterPolicy: { assistantConversationId: conversation.id },
      childBudget: {
        maxInputTokens: 100_000,
        maxOutputTokens: 8_000,
        maxCalls: 10,
        maxCostUsd: null,
        maxWallTimeMs: 600_000,
      },
      now,
    });
    automation.setSessionStatus(sessionId, "failed", now, {
      code: "child.failed",
    });

    const detail = (
      await app.inject({
        method: "GET",
        url: `/api/assistant/conversations/${conversation.id}`,
      })
    ).json() as {
      activities: {
        sourceId: string;
        status: string;
        layer: string;
        availableActions: string[];
      }[];
    };
    expect(detail.activities).toContainEqual(
      expect.objectContaining({
        sourceId: sessionId,
        status: "failed",
        layer: "primary",
        availableActions: ["retry-current", "skip-chapter", "replan", "stop"],
      }),
    );
    const otherDetail = (
      await app.inject({
        method: "GET",
        url: `/api/assistant/conversations/${otherConversation.id}`,
      })
    ).json() as { activities: { sourceId: string }[] };
    expect(otherDetail.activities).toEqual([]);

    const assistantRunId = await sendAndFinish(
      app,
      projectId,
      conversation.id,
      "recover-failed-autopilot",
      "重试刚才失败的章节",
      {
        surface: "autopilot",
        documentId: null,
        outlineNodeId: null,
        canonSpread: null,
        selection: null,
      },
    );
    // R6：失败会话的重试属于任务控制，直接执行，不再进入确认卡片。
    expect(automation.requireSession(sessionId).status).toBe("running");
    const recovered = (
      await app.inject({
        method: "GET",
        url: `/api/assistant/conversations/${conversation.id}`,
      })
    ).json() as {
      activities: { kind: string; status: string; id: string }[];
    };
    const recovery = recovered.activities.find(
      (activity) =>
        activity.kind === "tool" && activity.id.includes(assistantRunId),
    );
    expect(recovery).toMatchObject({ status: "completed" });
  });

  it("creates a foundation candidate run only after confirmation", async () => {
    const { app, database } = await setup(() => ({
      reply: "我会先生成可采纳的故事方向候选。",
      toolCall: {
        name: "foundation.start",
        arguments: { braindump: "每封信寄出后，寄件人会失去一段记忆。" },
      },
    }));
    const projectId = await createProject(app, "失忆邮局");
    const conversation = await createConversation(
      app,
      projectId,
      "foundation-conversation",
    );
    const assistantRunId = await sendAndFinish(
      app,
      projectId,
      conversation.id,
      "foundation-message",
      "帮我整理故事方向",
      {
        surface: "story-bible",
        documentId: null,
        outlineNodeId: null,
        canonSpread: "intent",
        selection: null,
      },
    );
    expect(
      new SqliteRunRepository(database)
        .listRuns(projectId)
        .filter((run) => run.recipe === "book-foundation"),
    ).toHaveLength(0);
    const proposal = await onlyProposal(app, conversation.id, assistantRunId);
    const confirmed = await app.inject({
      method: "POST",
      url: `/api/assistant/activities/${proposal}/actions`,
      payload: { action: "confirm" },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const foundation = new SqliteRunRepository(database).getRun(
      confirmed.json().source.id as string,
    );
    expect(foundation).toMatchObject({
      projectId,
      recipe: "book-foundation",
      status: "pending",
    });
    expect(foundation!.policy).toMatchObject({
      assistantConversationId: conversation.id,
      assistantActivityId: proposal,
      braindump: "每封信寄出后，寄件人会失去一段记忆。",
    });
  });

  it("retries the original tool proposal after a recoverable execution failure (CR-104)", async () => {
    let chapterId = "";
    const { app, database } = await setup(() => ({
      reply: "确认后生成当前章节的候选正文。",
      toolCall: {
        name: "chapter.start",
        arguments: { targetOutlineNodeId: chapterId },
      },
    }));
    const projectId = await createProject(app, "提案重试");
    chapterId = await createChapter(app, projectId, "第一章");
    const conversation = await createConversation(
      app,
      projectId,
      "retry-proposal-conversation",
    );
    const assistantRunId = await sendAndFinish(
      app,
      projectId,
      conversation.id,
      "retry-proposal-message",
      "写第一章",
      {
        surface: "studio",
        documentId: null,
        outlineNodeId: chapterId,
        canonSpread: null,
        selection: null,
      },
    );
    const proposal = await onlyProposal(app, conversation.id, assistantRunId);

    const blockerId = "blocking-chapter-run";
    const blockerRecipe = buildFoundationRecipe(blockerId);
    const runs = new SqliteRunRepository(database);
    runs.create({
      id: blockerId,
      projectId,
      recipe: blockerRecipe.name,
      recipeVersion: blockerRecipe.version,
      mode: "manual",
      targetOutlineNodeId: chapterId,
      policy: {},
      budgetLimit: {
        maxInputTokens: 10_000,
        maxOutputTokens: 2_000,
        maxCalls: 2,
        maxCostUsd: null,
        maxWallTimeMs: 60_000,
      },
      steps: blockerRecipe.steps,
      now: new Date().toISOString(),
    });

    const failed = await app.inject({
      method: "POST",
      url: `/api/assistant/activities/${proposal}/actions`,
      payload: { action: "confirm" },
    });
    expect(failed.statusCode, failed.body).toBe(409);
    expect(failed.json()).toMatchObject({
      error: { code: "project.writing_task.active" },
    });

    const failedDetail = (
      await app.inject({
        method: "GET",
        url: `/api/assistant/conversations/${conversation.id}`,
      })
    ).json() as {
      activities: { id: string; status: string; availableActions: string[] }[];
    };
    expect(failedDetail.activities).toContainEqual(
      expect.objectContaining({
        id: `assistant_tool:${proposal}`,
        status: "failed",
        availableActions: ["retry"],
      }),
    );

    runs.setRunStatus(
      blockerId,
      "cancelled",
      new Date().toISOString(),
      "test_released",
    );
    const retried = await app.inject({
      method: "POST",
      url: `/api/assistant/activities/${proposal}/actions`,
      payload: { action: "retry" },
    });
    expect(retried.statusCode, retried.body).toBe(200);
    expect(retried.json()).toMatchObject({
      activity: { status: "completed", availableActions: [] },
      source: { type: "run" },
    });
  });

  it("dispatches an explicit Canon candidate request directly without a confirmation card (R6)", async () => {
    const { app, database } = await setup(() => ({
      reply: "我直接为正典事实板块生成候选修改，完成后你逐项裁定。",
      toolCall: {
        name: "canon.candidate.start",
        arguments: { spread: "facts", instruction: "收紧第二章后的受伤设定" },
      },
    }));
    const projectId = await createProject(app, "直接候选");
    const conversation = await createConversation(
      app,
      projectId,
      "assistant-conv-canon-auto",
    );
    const sent = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/messages`,
      payload: {
        requestId: "assistant-canon-auto-1",
        content: "为当前 Canon 生成修改候选。",
        context: {
          surface: "bible",
          documentId: null,
          outlineNodeId: null,
          canonSpread: "facts",
          selection: null,
        },
      },
    });
    expect(sent.statusCode, sent.body).toBe(202);
    const runId = sent.json().runId as string;

    // R6 幂等：同一 requestId 重放不得重复开工。
    const replay = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/messages`,
      payload: {
        requestId: "assistant-canon-auto-1",
        content: "为当前 Canon 生成修改候选。",
        context: {
          surface: "bible",
          documentId: null,
          outlineNodeId: null,
          canonSpread: "facts",
          selection: null,
        },
      },
    });
    expect(replay.statusCode, replay.body).toBe(202);
    expect(replay.json()).toMatchObject({ runId, idempotentReplay: true });

    await finishRun(app, projectId, runId);

    const detail = (
      await app.inject({
        method: "GET",
        url: `/api/assistant/conversations/${conversation.id}`,
      })
    ).json() as {
      activities: {
        id: string;
        kind: string;
        status: string;
        sourceId: string;
        availableActions: string[];
        toolCall: { name: string } | null;
      }[];
    };
    const tool = detail.activities.find((activity) => activity.kind === "tool");
    // auto 工具直接交办：不出现 confirm 卡片，活动已完成并关联下游 Run。
    expect(tool).toMatchObject({
      status: "completed",
      toolCall: { name: "canon.candidate.start" },
    });
    expect(tool!.availableActions).not.toContain("confirm");
    const canonRunId = tool!.sourceId;
    const canonRun = new SqliteRunRepository(database).getSnapshot(canonRunId);
    expect(canonRun.run).toMatchObject({
      recipe: "canon-spread-candidate",
      projectId,
    });
    expect(canonRun.run.policy).toMatchObject({
      canonSpread: "facts",
      assistantConversationId: conversation.id,
    });

    // 同一活动重复交办不会新建第二个下游 Run（确定性 ID 幂等）。
    const duplicate = await app.inject({
      method: "POST",
      url: `/api/assistant/activities/${tool!.id.replace("assistant_tool:", "")}/actions`,
      payload: { action: "confirm" },
    });
    expect([200, 409]).toContain(duplicate.statusCode);
    const canonRuns = new SqliteRunRepository(database)
      .listRuns(projectId)
      .filter((run) => run.recipe === "canon-spread-candidate");
    expect(canonRuns).toHaveLength(1);
  });

  it("starts outline planning directly and keeps one active writing chain (R6)", async () => {
    const { app, database } = await setup(() => ({
      reply: "我先为后续章节补齐大纲，规划完成后再决定写作。",
      toolCall: {
        name: "outline.plan.start",
        arguments: { targetChapters: 3 },
      },
    }));
    const projectId = await createProject(app, "规划直执");
    const conversation = await createConversation(
      app,
      projectId,
      "assistant-conv-outline-auto",
    );
    const sent = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/messages`,
      payload: {
        requestId: "assistant-outline-auto-1",
        content: "先把后续三章的大纲补好。",
        context: {
          surface: "overview",
          documentId: null,
          outlineNodeId: null,
          canonSpread: null,
          selection: null,
        },
      },
    });
    expect(sent.statusCode, sent.body).toBe(202);
    await finishRun(app, projectId, sent.json().runId as string);

    const detail = (
      await app.inject({
        method: "GET",
        url: `/api/assistant/conversations/${conversation.id}`,
      })
    ).json() as {
      activities: {
        kind: string;
        status: string;
        sourceType: string;
        sourceId: string;
        result: Record<string, unknown> | null;
      }[];
    };
    const tool = detail.activities.find((activity) => activity.kind === "tool");
    expect(tool).toMatchObject({ status: "completed" });
    const session = new SqliteAutomationRepository(database).requireSession(
      tool!.sourceId,
    );
    expect(session).toMatchObject({ projectId, targetChapters: 3 });
    expect(session.chapterPolicy).toMatchObject({
      planningOnly: true,
      assistantConversationId: conversation.id,
    });
  });

  it("rejects a second active writing task while an assistant task is running (R6)", async () => {
    let chapterId = "";
    let isFirstReplyFlag = true;
    const { app } = await setup(() =>
      isFirstReplyFlag
        ? {
            reply: "确认后写当前章。",
            toolCall: {
              name: "chapter.start",
              arguments: { targetOutlineNodeId: chapterId },
            },
          }
        : {
            reply: "我再规划三章。",
            toolCall: {
              name: "outline.plan.start",
              arguments: { targetChapters: 3 },
            },
          },
    );
    const projectId = await createProject(app, "互斥写作");
    chapterId = await createChapter(app, projectId, "雾港失灯");
    const conversation = await createConversation(
      app,
      projectId,
      "assistant-conv-mutex",
    );
    // 先确认一个 chapter.start，形成活动中的写作链。
    const isFirstReply = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/messages`,
      payload: {
        requestId: "assistant-mutex-1",
        content: "写当前章。",
        context: {
          surface: "studio",
          documentId: null,
          outlineNodeId: chapterId,
          canonSpread: null,
          selection: null,
        },
      },
    });
    await finishRun(app, projectId, isFirstReply.json().runId as string);
    const firstDetail = (
      await app.inject({
        method: "GET",
        url: `/api/assistant/conversations/${conversation.id}`,
      })
    ).json() as { activities: { kind: string; sourceId: string }[] };
    const proposal = firstDetail.activities.find(
      (activity) => activity.kind === "tool",
    )!;
    const confirmed = await app.inject({
      method: "POST",
      url: `/api/assistant/activities/${proposal.sourceId}/actions`,
      payload: { action: "confirm" },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);

    // 第二个 auto 规划请求在活动写作链存在时必须失败接续，而不是排队。
    isFirstReplyFlag = false;
    const second = await app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/messages`,
      payload: {
        requestId: "assistant-mutex-2",
        content: "再规划三章。",
        context: {
          surface: "overview",
          documentId: null,
          outlineNodeId: null,
          canonSpread: null,
          selection: null,
        },
      },
    });
    expect(second.statusCode, second.body).toBe(202);
    await finishRun(app, projectId, second.json().runId as string);
    const secondDetail = (
      await app.inject({
        method: "GET",
        url: `/api/assistant/conversations/${conversation.id}`,
      })
    ).json() as {
      activities: {
        kind: string;
        status: string;
        lastError: { code: string } | null;
        availableActions: string[];
      }[];
    };
    const failedTool = secondDetail.activities
      .filter((activity) => activity.kind === "tool")
      .at(-1)!;
    expect(failedTool.status).toBe("failed");
    expect(failedTool.lastError?.code).toBe("project.writing_task.active");
    expect(failedTool.availableActions).toContain("retry");
  });
});

async function setup(
  assistantReply: () => {
    reply: string;
    toolCall: null | { name: string; arguments: Record<string, unknown> };
  },
) {
  const database = new NodeNarrativeDatabase();
  const environment = {
    NARRATIVE_LLM_API_KEY: "server-only-test-key",
    NARRATIVE_LLM_BASE_URL: "https://api.example.com/v1",
    NARRATIVE_LLM_MODEL: "test-model",
    NARRATIVE_LLM_CONTEXT_WINDOW: "128000",
    NARRATIVE_LLM_MAX_OUTPUT_TOKENS: "32000",
  };
  const app = await buildApp({
    config,
    database,
    environment,
    narrativeModelClient: assistantModel(assistantReply),
    enableRunWorker: false,
    logger: false,
  });
  resources.push({ app, database });
  return { app, database };
}

function assistantModel(
  reply: () => {
    reply: string;
    toolCall: null | { name: string; arguments: Record<string, unknown> };
  },
): NarrativeModelClient {
  return {
    async text() {
      throw new Error("assistant turn must not request unstructured text");
    },
    async structured(_run, _step, purpose, _request, _contract, validate) {
      if (purpose !== "project-assistant") {
        throw new Error(`unexpected model purpose: ${purpose}`);
      }
      const checked = validate(reply());
      if (!checked.success) throw new Error(checked.issues.join("; "));
      return {
        value: checked.data,
        usage: {
          inputTokens: 120,
          outputTokens: 80,
          calls: 1,
          costUsd: 0,
          wallTimeMs: 10,
        },
        mode: "native",
        attempts: 1,
      };
    },
  } as NarrativeModelClient;
}

async function createProject(
  app: Awaited<ReturnType<typeof buildApp>>,
  title: string,
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: {
      requestId: globalThis.crypto.randomUUID(),
      title,
      premise: `${title}的故事命题`,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return (response.json() as { id: string }).id;
}

async function createChapter(
  app: Awaited<ReturnType<typeof buildApp>>,
  projectId: string,
  title: string,
): Promise<string> {
  const bible = (
    await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/story-bible`,
    })
  ).json() as { outline: { id: string; kind: string }[] };
  const root = bible.outline.find((node) => node.kind === "book")!;
  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/outline`,
    payload: {
      parentId: root.id,
      kind: "chapter",
      ordinal: 0,
      title,
      summary: "灯塔熄灭，港口遗忘一个人。",
      goal: "发现遗忘规则",
      conflict: "守塔人拒绝开门",
      metadata: {},
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return (response.json() as { id: string }).id;
}

async function createConversation(
  app: Awaited<ReturnType<typeof buildApp>>,
  projectId: string,
  requestId: string,
): Promise<{ id: string }> {
  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/assistant/conversations`,
    payload: { requestId, title: "项目协作" },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as { id: string };
}

async function finishRun(
  app: Awaited<ReturnType<typeof buildApp>>,
  projectId: string,
  runId: string,
): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    const response = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/advance`,
      payload: { projectId },
    });
    expect(response.statusCode, response.body).toBe(200);
    const status = (
      response.json() as { snapshot: { run: { status: string } } }
    ).snapshot.run.status;
    if (status === "completed") return;
    if (["failed", "cancelled"].includes(status)) {
      throw new Error(`assistant run ended as ${status}`);
    }
  }
  throw new Error("assistant run did not complete");
}

async function sendAndFinish(
  app: Awaited<ReturnType<typeof buildApp>>,
  projectId: string,
  conversationId: string,
  requestId: string,
  content: string,
  context: Readonly<Record<string, unknown>>,
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: `/api/assistant/conversations/${conversationId}/messages`,
    payload: { requestId, content, context },
  });
  expect(response.statusCode, response.body).toBe(202);
  const runId = response.json().runId as string;
  await finishRun(app, projectId, runId);
  return runId;
}

async function onlyProposal(
  app: Awaited<ReturnType<typeof buildApp>>,
  conversationId: string,
  assistantRunId: string,
): Promise<string> {
  const detail = (
    await app.inject({
      method: "GET",
      url: `/api/assistant/conversations/${conversationId}`,
    })
  ).json() as {
    activities: {
      kind: string;
      status: string;
      sourceId: string;
      id: string;
    }[];
  };
  const proposal = detail.activities.find(
    (activity) =>
      activity.kind === "tool" &&
      activity.status === "proposed" &&
      activity.id.includes(assistantRunId),
  );
  expect(proposal).toBeDefined();
  return proposal!.sourceId;
}
