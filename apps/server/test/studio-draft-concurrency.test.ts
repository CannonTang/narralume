import { NodeNarrativeDatabase } from "@narrative-lantern/persistence/node";
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

describe("studio draft concurrency", () => {
  it("rejects a second tab overwriting a draft saved elsewhere (CR-15)", async () => {
    const { app, projectId, documentId } = await setupDocument();

    const first = await saveDraft(app, projectId, documentId, {
      baseVersionId: null,
      expectedDraftUpdatedAt: null,
      content: "标签页 A 的草稿。",
    });
    expect(first.updatedAt).toBeTruthy();

    // 第二个标签页拿着“没有草稿”的旧快照保存，必须显式冲突而不是静默覆盖。
    const conflict = await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/studio/documents/${documentId}/draft`,
      payload: {
        baseVersionId: null,
        expectedDraftUpdatedAt: null,
        content: "标签页 B 的草稿。",
      },
    });
    expect(conflict.statusCode, conflict.body).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: { code: "draft.updated_at.conflict" },
    });

    // 刷新快照后使用最新 updatedAt 保存可以成功。
    const second = await saveDraft(app, projectId, documentId, {
      baseVersionId: null,
      expectedDraftUpdatedAt: first.updatedAt,
      content: "标签页 B 的草稿。",
    });
    expect(second.content).toBe("标签页 B 的草稿。");

    // 标签页 A 的旧令牌继续失效。
    const stale = await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/studio/documents/${documentId}/draft`,
      payload: {
        baseVersionId: null,
        expectedDraftUpdatedAt: first.updatedAt,
        content: "标签页 A 的再次自动保存。",
      },
    });
    expect(stale.statusCode, stale.body).toBe(409);
  });

  it("clears stale drafts whenever a new official version lands (CR-25)", async () => {
    const { app, projectId, documentId } = await setupDocument();
    const v1 = await appendVersion(
      app,
      projectId,
      documentId,
      "第一章正式内容。",
      null,
    );

    await saveDraft(app, projectId, documentId, {
      baseVersionId: v1.id,
      expectedDraftUpdatedAt: null,
      content: "基于 v1 的旧草稿。",
    });

    // 手动保存新版本（其他入口，例如 AI 候选采纳，走同一 appendVersion 路径）。
    const v2 = await appendVersion(
      app,
      projectId,
      documentId,
      "AI 推进后的新正式内容。",
      v1.id,
    );
    let detail = await getDetail(app, projectId, documentId);
    expect(detail.document.currentVersionId).toBe(v2.id);
    expect(detail.draft).toBeNull();

    // 历史恢复同样必须清除旧草稿。
    await saveDraft(app, projectId, documentId, {
      baseVersionId: v2.id,
      expectedDraftUpdatedAt: null,
      content: "基于 v2 的草稿。",
    });
    const restored = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/documents/${documentId}/restore`,
      payload: { targetVersionId: v1.id, expectedCurrentVersionId: v2.id },
    });
    expect(restored.statusCode, restored.body).toBe(201);
    detail = await getDetail(app, projectId, documentId);
    expect(detail.draft).toBeNull();
    expect(detail.currentVersion?.content).toBe("第一章正式内容。");
  });

  it("leaves versions and draft untouched when a selection AI edit fails validation (CR-57)", async () => {
    // 不配置默认生成模型：选区修改必须以 422 失败且无副作用。
    const { app, projectId, documentId } = await setupDocument();
    const v1 = await appendVersion(
      app,
      projectId,
      documentId,
      "盐粒在灯下析出。",
      null,
    );
    const draft = await saveDraft(app, projectId, documentId, {
      baseVersionId: v1.id,
      expectedDraftUpdatedAt: null,
      content: "盐粒在灯下析出。尚未发布的续写。",
    });

    const rejected = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/studio/documents/${documentId}/selection-edits`,
      payload: {
        baseVersionId: v1.id,
        draftContentHash: draft.contentHash,
        selectionStart: 0,
        selectionEnd: 2,
        instruction: "增强触觉。",
      },
    });
    expect(rejected.statusCode, rejected.body).toBe(422);
    expect(rejected.json()).toMatchObject({
      error: { code: "model.assignment.unavailable" },
    });

    const detail = await getDetail(app, projectId, documentId);
    expect(detail.versions).toHaveLength(1);
    expect(detail.document.currentVersionId).toBe(v1.id);
    expect(detail.draft?.content).toBe(draft.content);
  });
});

type App = Awaited<ReturnType<typeof buildApp>>;

async function setupDocument(): Promise<{
  app: App;
  projectId: string;
  documentId: string;
}> {
  const database = new NodeNarrativeDatabase();
  const app = await buildApp({
    config,
    database,
    environment: {},
    enableRunWorker: false,
    logger: false,
  });
  resources.push({ app, database });
  const project = await requestJson<{ id: string }>(
    app,
    "POST",
    "/api/projects",
    {
      requestId: globalThis.crypto.randomUUID(),
      title: "草稿并发验证",
      premise: "验证草稿与版本的一致性。",
    },
    201,
  );
  const document = await requestJson<{ id: string }>(
    app,
    "POST",
    `/api/projects/${project.id}/documents`,
    {
      requestId: globalThis.crypto.randomUUID(),
      kind: "note",
      title: "正文稿",
    },
    201,
  );
  return { app, projectId: project.id, documentId: document.id };
}

async function saveDraft(
  app: App,
  projectId: string,
  documentId: string,
  payload: Record<string, unknown>,
) {
  return requestJson<{
    baseVersionId: string | null;
    content: string;
    contentHash: string;
    updatedAt: string;
  }>(
    app,
    "PUT",
    `/api/projects/${projectId}/studio/documents/${documentId}/draft`,
    payload,
    200,
  );
}

async function appendVersion(
  app: App,
  projectId: string,
  documentId: string,
  content: string,
  expectedCurrentVersionId: string | null,
) {
  return requestJson<{ id: string; content: string }>(
    app,
    "POST",
    `/api/projects/${projectId}/documents/${documentId}/versions`,
    { content, source: "manual", expectedCurrentVersionId },
    201,
  );
}

async function getDetail(app: App, projectId: string, documentId: string) {
  return requestJson<{
    document: { currentVersionId: string | null };
    currentVersion: { id: string; content: string } | null;
    draft: { content: string } | null;
    versions: unknown[];
  }>(
    app,
    "GET",
    `/api/projects/${projectId}/studio/documents/${documentId}`,
    undefined,
    200,
  );
}

async function requestJson<T>(
  app: App,
  method: "GET" | "POST" | "PUT",
  url: string,
  payload: Record<string, unknown> | undefined,
  expected: number,
): Promise<T> {
  const response =
    payload === undefined
      ? await app.inject({ method, url })
      : await app.inject({ method, url, payload });
  expect(response.statusCode, response.body).toBe(expected);
  return response.json() as T;
}
