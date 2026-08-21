import type { NarrativeModelClient } from "@narralume/narrative";
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

type App = Awaited<ReturnType<typeof buildApp>>;

const ENVIRONMENT = {
  NARRATIVE_LLM_API_KEY: "server-only-test-key",
  NARRATIVE_LLM_BASE_URL: "https://api.example.com/v1",
  NARRATIVE_LLM_MODEL: "test-model",
};

async function setup() {
  const database = new NodeNarrativeDatabase();
  const app = await buildApp({
    config,
    database,
    environment: ENVIRONMENT,
    narrativeModelClient: scriptedModel(),
    enableRunWorker: false,
    logger: false,
  });
  resources.push({ app, database });
  return { app, database };
}

async function createProject(app: App, title: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: {
      requestId: globalThis.crypto.randomUUID(),
      title,
      premise: `${title}的前提。`,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return (response.json() as { id: string }).id;
}

async function createPersona(app: App, projectId: string, name: string) {
  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/personas`,
    payload: { kind: "narrator", name, instructions: "克制、具体" },
  });
  expect(response.statusCode, response.body).toBe(201);
  return (response.json() as { id: string }).id;
}

async function createManualRoom(
  app: App,
  projectId: string,
  title: string,
  participantIds: string[],
) {
  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/cocreate/sessions`,
    payload: { title, speakerPolicy: "manual", participantIds },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as {
    session: { id: string };
    turns: { id: string }[];
  };
}

function scriptedModel(): NarrativeModelClient {
  const usage = {
    inputTokens: 10,
    outputTokens: 10,
    calls: 1,
    costUsd: 0,
    wallTimeMs: 1,
  };
  return {
    async text() {
      return { text: "unused", usage };
    },
    async structured() {
      throw new Error("unexpected model call");
    },
  } as unknown as NarrativeModelClient;
}

describe("cocreate manual speaker guards (CR-85)", () => {
  it("rejects creating a manual session without participants", async () => {
    const { app } = await setup();
    const projectId = await createProject(app, "手动房间");

    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/cocreate/sessions`,
      payload: {
        title: "零参与者",
        speakerPolicy: "manual",
        participantIds: [],
      },
    });
    expect(created.statusCode, created.body).toBe(422);
    expect(created.json()).toMatchObject({
      error: { code: "cocreate.participants.required" },
    });

    // 自动策略不受限
    const auto = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/cocreate/sessions`,
      payload: { title: "自动房间", speakerPolicy: "auto", participantIds: [] },
    });
    expect(auto.statusCode, auto.body).toBe(201);
  });

  it("rejects a reply-generating turn without speaker and writes nothing", async () => {
    const { app } = await setup();
    const projectId = await createProject(app, "手动发言");
    const personaId = await createPersona(app, projectId, "旁白");
    const room = await createManualRoom(app, projectId, "房间", [personaId]);

    const rejected = await app.inject({
      method: "POST",
      url: `/api/cocreate/sessions/${room.session.id}/turns`,
      payload: {
        requestId: "missing-speaker",
        role: "user",
        content: "写一段潮声。",
        generateReply: true,
      },
    });
    expect(rejected.statusCode, rejected.body).toBe(422);
    expect(rejected.json()).toMatchObject({
      error: { code: "cocreate.speaker.required" },
    });

    // 失败的请求不能写入用户回合
    const detail = await app.inject({
      method: "GET",
      url: `/api/cocreate/sessions/${room.session.id}`,
    });
    expect(detail.statusCode, detail.body).toBe(200);
    expect((detail.json() as { turns: unknown[] }).turns).toHaveLength(0);

    // 显式指定发言者则正常接受
    const accepted = await app.inject({
      method: "POST",
      url: `/api/cocreate/sessions/${room.session.id}/turns`,
      payload: {
        requestId: "explicit-speaker",
        role: "user",
        content: "写一段潮声。",
        generateReply: true,
        speakerPersonaId: personaId,
      },
    });
    expect(accepted.statusCode, accepted.body).toBe(202);
  });

  it("rejects retired participants before creating a reply run or user turn", async () => {
    const { app } = await setup();
    const projectId = await createProject(app, "退役发言者");
    const personaId = await createPersona(app, projectId, "旧旁白");
    const room = await createManualRoom(app, projectId, "旧房间", [personaId]);

    const retired = await app.inject({
      method: "PUT",
      url: `/api/personas/${personaId}`,
      payload: {
        kind: "narrator",
        entityId: null,
        name: "旧旁白",
        description: null,
        instructions: "克制、具体",
        voice: {},
        status: "retired",
        expectedVersion: 0,
      },
    });
    expect(retired.statusCode, retired.body).toBe(200);

    const rejected = await app.inject({
      method: "POST",
      url: `/api/cocreate/sessions/${room.session.id}/turns`,
      payload: {
        requestId: "retired-speaker",
        role: "user",
        content: "继续生成。",
        generateReply: true,
        speakerPersonaId: personaId,
      },
    });
    expect(rejected.statusCode, rejected.body).toBe(422);
    expect(rejected.json()).toMatchObject({
      error: { code: "cocreate.participants.empty" },
    });

    const detail = await app.inject({
      method: "GET",
      url: `/api/cocreate/sessions/${room.session.id}`,
    });
    expect((detail.json() as { turns: unknown[] }).turns).toHaveLength(0);
  });
});
