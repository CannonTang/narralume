import {
  SqliteAutomationRepository,
  SqliteRunRepository,
  SqliteStoryRepository,
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

describe("canon / compass concurrency guards", () => {
  it("rejects a forked fact revision or second promotion of a superseded fact (CR-14)", async () => {
    const { app } = await setupApp();
    const projectId = await createProject(app, "正典分叉");
    const entityId = await createEntity(app, projectId, "林昼");

    const fact = await createFact(app, projectId, entityId, "害怕", "黑暗");
    const revision = (over: Record<string, unknown>) => ({
      subjectId: entityId,
      predicate: "害怕",
      objectEntityId: null,
      value: "深水",
      validFromNodeId: null,
      validToNodeId: null,
      knowledgeScope: "omniscient",
      knowledgeSubjectId: null,
      authority: "confirmed",
      confidence: 1,
      confirmLockedRevision: false,
      ...over,
    });
    const first = await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/facts/${fact.id}`,
      payload: revision({ value: "深水" }),
    });
    expect(first.statusCode, first.body).toBe(201);
    // 同一旧事实的第二次修订必须显式冲突，不能产生第二条分叉正典。
    const second = await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/facts/${fact.id}`,
      payload: revision({ value: "浓雾" }),
    });
    expect(second.statusCode, second.body).toBe(409);
    expect(second.json()).toMatchObject({
      error: { code: "canon.fact.superseded" },
    });
    const bible = (
      await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/story-bible`,
      })
    ).json() as { facts: { predicate: string; value: unknown }[] };
    expect(
      bible.facts.filter((item) => item.predicate === "害怕"),
    ).toHaveLength(1);

    // 权威提升同样不能对已被替代的候选重复执行。
    const candidate = await createFact(
      app,
      projectId,
      entityId,
      "信任",
      "灯塔看守",
      "candidate",
    );
    const promote = () =>
      app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/facts/${candidate.id}/promote`,
        payload: { authority: "confirmed" },
      });
    expect((await promote()).statusCode).toBe(201);
    const promotedAgain = await promote();
    expect(promotedAgain.statusCode, promotedAgain.body).toBe(409);
    expect(promotedAgain.json()).toMatchObject({
      error: { code: "canon.fact.superseded" },
    });
  });

  it("rejects intent and timeline updates without a live version precondition (CR-16)", async () => {
    const { app } = await setupApp();
    const projectId = await createProject(app, "意图并发");
    const bible = (
      await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/story-bible`,
      })
    ).json() as { intent: { updatedAt: string } | null };

    const writeIntent = (expectedUpdatedAt: string | null, focus: string) =>
      app.inject({
        method: "PUT",
        url: `/api/projects/${projectId}/intent`,
        payload: { currentFocus: focus, expectedUpdatedAt },
      });
    const first = await writeIntent(
      bible.intent?.updatedAt ?? null,
      "第一版焦点",
    );
    expect(first.statusCode, first.body).toBe(200);
    // 旧快照的更新必须显式冲突。
    const stale = await writeIntent(
      bible.intent?.updatedAt ?? null,
      "旧标签页的覆盖",
    );
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json()).toMatchObject({
      error: { code: "intent.version.conflict" },
    });
    // 最新令牌可以保存。
    const fresh = await writeIntent(
      first.json().updatedAt as string,
      "最新标签页的保存",
    );
    expect(fresh.statusCode, fresh.body).toBe(200);

    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/timeline`,
      payload: {
        title: "灯塔熄灭",
        description: null,
        outlineNodeId: null,
        storyTimeStart: null,
        storyTimeEnd: null,
        sequence: 1,
        participants: [],
        causes: [],
        visibility: "omniscient",
        sourceId: null,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const event = created.json() as { id: string; updatedAt: string };
    const edit = (expectedUpdatedAt: string, title: string) =>
      app.inject({
        method: "PUT",
        url: `/api/projects/${projectId}/timeline/${event.id}`,
        payload: {
          title,
          description: null,
          outlineNodeId: null,
          storyTimeStart: null,
          storyTimeEnd: null,
          sequence: 1,
          participants: [],
          causes: [],
          visibility: "omniscient",
          sourceId: null,
          expectedUpdatedAt,
        },
      });
    const firstEdit = await edit(event.updatedAt, "灯塔在午夜熄灭");
    expect(firstEdit.statusCode, firstEdit.body).toBe(200);
    const staleEdit = await edit(event.updatedAt, "旧标签页的改写");
    expect(staleEdit.statusCode, staleEdit.body).toBe(409);
    expect(staleEdit.json()).toMatchObject({
      error: { code: "timeline.version.conflict" },
    });
  });

  it("rejects compass saves without a matching version (CR-49)", async () => {
    const { app } = await setupApp();
    const projectId = await createProject(app, "指南针并发");
    const writeCompass = (expectedVersion: number | null, promise: string) =>
      app.inject({
        method: "PUT",
        url: `/api/projects/${projectId}/compass`,
        payload: {
          corePromise: promise,
          endingDirection: null,
          longLines: [],
          themeQuestions: [],
          target: { chapters: 12, wordsPerChapter: 2000, volumes: 1 },
          constraints: [],
          expectedVersion,
        },
      });
    const created = await writeCompass(null, "每一次寄信都有代价");
    expect(created.statusCode, created.body).toBe(200);
    const duplicate = await writeCompass(null, "另一个标签页的指南针");
    expect(duplicate.statusCode, duplicate.body).toBe(409);
    expect(duplicate.json()).toMatchObject({
      error: { code: "compass.version.conflict" },
    });
    const updated = await writeCompass(1, "第二版指南针");
    expect(updated.statusCode, updated.body).toBe(200);
    const stale = await writeCompass(1, "旧版本的指南针");
    expect(stale.statusCode, stale.body).toBe(409);
    expect((await writeCompass(2, "最新版本的指南针")).statusCode).toBe(200);
  });

  it("rejects adopting a foundation candidate whose baseline changed (CR-54)", async () => {
    const { app, database } = await setupApp();
    const projectId = await createProject(app, "候选基线");
    const story = new SqliteStoryRepository(database);
    const automation = new SqliteAutomationRepository(database);
    const runs = new SqliteRunRepository(database);
    const createSourceRun = (suffix: string) =>
      runs.create({
        id: `run-${suffix}-${projectId}`,
        projectId,
        recipe: "test-source",
        recipeVersion: 1,
        mode: "manual",
        targetOutlineNodeId: null,
        policy: {},
        budgetLimit: {
          maxCalls: 1,
          maxInputTokens: 1_000,
          maxOutputTokens: 1_000,
          maxCostUsd: null,
          maxWallTimeMs: 1_000,
        },
        steps: [],
        now: new Date().toISOString(),
      }).run.id;
    const baselineIntent = story.getAuthorIntent(projectId);

    const adopt = (candidateId: string) =>
      app.inject({
        method: "POST",
        url: `/api/candidates/${candidateId}/actions`,
        payload: { action: "adopt" },
      });

    // 生成时的意图基线；采纳前作者手工改过意图 → 409。
    automation.stageCandidateSet({
      id: "set-intent",
      projectId,
      sourceRunId: createSourceRun("1"),
      title: "候选",
      candidates: [
        {
          id: "candidate-intent",
          kind: "intent",
          label: "作者意图",
          payload: {
            promise: "候选承诺",
            themes: [],
            audience: null,
            tone: null,
            boundaries: [],
            endingDirection: null,
            currentFocus: "候选焦点",
            baseline: { intentUpdatedAt: baselineIntent?.updatedAt ?? null },
          },
        },
      ],
      now: new Date().toISOString(),
    });
    const manual = await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/intent`,
      payload: {
        currentFocus: "作者手工焦点",
        expectedUpdatedAt: baselineIntent?.updatedAt ?? null,
      },
    });
    expect(manual.statusCode, manual.body).toBe(200);
    const blocked = await adopt("candidate-intent");
    expect(blocked.statusCode, blocked.body).toBe(409);
    expect(blocked.json()).toMatchObject({
      error: { code: "foundation_candidate.intent.stale" },
    });
    expect(story.getAuthorIntent(projectId)?.currentFocus).toBe("作者手工焦点");

    // 基线一致的指南针候选可以正常采纳。
    const compassBefore = automation.getCompass(projectId) ?? null;
    expect(compassBefore).toBeNull();
    automation.stageCandidateSet({
      id: "set-compass",
      projectId,
      sourceRunId: createSourceRun("2"),
      title: "指南针候选",
      candidates: [
        {
          id: "candidate-compass",
          kind: "compass",
          label: "故事指南针",
          payload: {
            corePromise: "候选指南针承诺",
            endingDirection: null,
            longLines: [],
            themeQuestions: [],
            target: { chapters: 10, wordsPerChapter: 2000, volumes: 1 },
            constraints: [],
            baseline: { compassVersion: null },
          },
        },
      ],
      now: new Date().toISOString(),
    });
    const adopted = await adopt("candidate-compass");
    expect(adopted.statusCode, adopted.body).toBe(200);
    expect(automation.getCompass(projectId)?.corePromise).toBe(
      "候选指南针承诺",
    );

    // 人工更新指南针后，旧的指南针候选（同一基线 null）不能再覆盖。
    automation.stageCandidateSet({
      id: "set-compass-2",
      projectId,
      sourceRunId: createSourceRun("3"),
      title: "旧指南针候选",
      candidates: [
        {
          id: "candidate-compass-stale",
          kind: "compass",
          label: "旧故事指南针",
          payload: {
            corePromise: "旧候选指南针",
            endingDirection: null,
            longLines: [],
            themeQuestions: [],
            target: { chapters: 10, wordsPerChapter: 2000, volumes: 1 },
            constraints: [],
            baseline: { compassVersion: null },
          },
        },
      ],
      now: new Date().toISOString(),
    });
    const stale = await adopt("candidate-compass-stale");
    expect(stale.statusCode, stale.body).toBe(409);
    expect(automation.getCompass(projectId)?.corePromise).toBe(
      "候选指南针承诺",
    );
  });
});

async function setupApp() {
  const database = new NodeNarrativeDatabase();
  const app = await buildApp({
    config,
    database,
    environment: {},
    enableRunWorker: false,
    logger: false,
  });
  resources.push({ app, database });
  return { app, database };
}

async function createProject(
  app: Awaited<ReturnType<typeof buildApp>>,
  title: string,
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: {
      requestId: globalThis.crypto.randomUUID(),
      title,
      premise: `${title}的验证故事`,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().id as string;
}

async function createEntity(
  app: Awaited<ReturnType<typeof buildApp>>,
  projectId: string,
  name: string,
) {
  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/entities`,
    payload: {
      type: "character",
      name,
      aliases: [],
      description: null,
      attributes: {},
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().id as string;
}

async function createFact(
  app: Awaited<ReturnType<typeof buildApp>>,
  projectId: string,
  subjectId: string,
  predicate: string,
  value: string,
  authority = "confirmed",
) {
  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/facts`,
    payload: {
      subjectId,
      predicate,
      value,
      knowledgeScope: "omniscient",
      authority,
      sourceType: "manual",
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().fact as { id: string };
}
