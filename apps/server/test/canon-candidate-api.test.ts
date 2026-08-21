import type { NarrativeModelClient } from "@narralume/narrative";
import { SqliteRunRepository } from "@narralume/persistence";
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

describe("Canon Spread candidate API", () => {
  it("keeps one active candidate run per spread while preserving request replay (CR-36)", async () => {
    const { app, database } = await setup({ summary: "候选", items: [] });
    const projectId = await createProject(app, "候选任务单飞");
    const firstRequestId = "8e92f1f5-bc88-4657-a0ae-c7055e2bcad1";
    const first = await startCandidate(
      app,
      projectId,
      "intent",
      "加强创作承诺",
      firstRequestId,
    );

    const replay = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/canon-spreads/intent/candidates`,
      payload: {
        requestId: firstRequestId,
        instruction: "加强创作承诺",
      },
    });
    expect(replay.statusCode, replay.body).toBe(202);
    expect(replay.json()).toMatchObject({
      runId: first.runId,
      idempotentReplay: true,
    });

    const parallel = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/canon-spreads/intent/candidates`,
      payload: {
        requestId: "2f68148a-631f-4ec9-a87e-caf07e42a87f",
        instruction: "补充当前焦点",
      },
    });
    expect(parallel.statusCode, parallel.body).toBe(409);
    expect(parallel.json()).toMatchObject({
      error: { code: "canon_candidate.active_run_exists" },
    });

    database.raw
      .prepare("UPDATE runs SET status = 'failed_recoverable' WHERE id = ?")
      .run(first.runId);
    const duringRetry = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/canon-spreads/intent/candidates`,
      payload: {
        requestId: "01fe968e-dd08-464d-9609-fd2517d905ed",
        instruction: "再次补充当前焦点",
      },
    });
    expect(duringRetry.statusCode, duringRetry.body).toBe(409);
    expect(duringRetry.json()).toMatchObject({
      error: { code: "canon_candidate.active_run_exists" },
    });

    const otherSpread = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/canon-spreads/outline/candidates`,
      payload: {
        requestId: "cd84ea2b-f9d7-45da-883f-813a55b11e25",
        instruction: "补充章节目标",
      },
    });
    expect(otherSpread.statusCode, otherSpread.body).toBe(202);
    expect(otherSpread.json()).toMatchObject({ idempotentReplay: false });
  });

  it("returns a clear 409 instead of a generic 500 when a create candidate collides with existing canon (CR-55)", async () => {
    const { app } = await setup({ summary: "候选", items: [] });
    const projectId = await createProject(app, "正典冲突");
    modelValue = {
      summary: "新增人物。",
      items: [
        {
          operation: "create",
          targetId: null,
          title: "新增人物 沈佩",
          rationale: "故事需要第二位守信人。",
          impact: ["人物卡新增"],
          afterJson: JSON.stringify({
            type: "character",
            name: "沈佩",
            aliases: [],
            description: "候选生成时的人物描述",
            attributes: {},
          }),
        },
      ],
    };
    const started = await startCandidate(
      app,
      projectId,
      "entities",
      "新增人物",
    );
    await finishRun(app, projectId, started.runId);
    const set = (
      await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/canon-spreads/entities/candidates`,
      })
    ).json()[0];
    expect(set.items[0].operation).toBe("create");

    // 候选生成后，作者手工创建了同名同类型人物。
    const manual = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/entities`,
      payload: {
        type: "character",
        name: "沈佩",
        aliases: [],
        description: "作者手工创建的人物",
        attributes: {},
      },
    });
    expect(manual.statusCode, manual.body).toBe(201);

    // 采纳旧候选必须是明确的业务 409，而不是唯一约束触发的泛化 500。
    const conflict = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/canon-candidates/${set.id}/items/${set.items[0].id}/decisions`,
      payload: { action: "apply" },
    });
    expect(conflict.statusCode, conflict.body).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: { code: "canon_candidate.item.conflict" },
    });

    // 人工创建的内容保留，候选仍可重新裁定（例如拒绝）。
    const entities = (
      await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/entities`,
      })
    ).json() as { name: string }[];
    expect(entities.filter((entity) => entity.name === "沈佩")).toHaveLength(1);
    const rejected = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/canon-candidates/${set.id}/items/${set.items[0].id}/decisions`,
      payload: { action: "reject" },
    });
    expect(rejected.statusCode, rejected.body).toBe(200);
  });

  it("generates reviewable intent items and applies them one by one", async () => {
    const { app, database } = await setup({ summary: "候选", items: [] });
    const projectId = await createProject(app, "回声邮局");

    // Semantic validation rejects duplicate writes to one target, so use one
    // atomic intent patch in the actual run.
    modelValue = {
      summary: "把读者承诺和当下焦点收紧到同一条记忆代价规则。",
      items: [
        {
          operation: "update",
          targetId: "intent",
          title: "收紧记忆代价规则",
          rationale: "让下一章目标与全书承诺保持一致。",
          impact: ["后续章节需展示可见代价", "轻量审稿会据此检查"],
          afterJson: JSON.stringify({
            promise: "每一次寄信都必须留下可见且不可逆的记忆代价。",
            currentFocus: "验证每封信寄出后寄件人失去一段记忆",
          }),
        },
      ],
    };
    const started = await startCandidate(
      app,
      projectId,
      "intent",
      "加强记忆代价规则",
    );
    const replay = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/canon-spreads/intent/candidates`,
      payload: {
        requestId: "8e92f1f5-bc88-4657-a0ae-c7055e2bcad1",
        instruction: "加强记忆代价规则",
      },
    });
    expect(replay.statusCode, replay.body).toBe(202);
    expect(replay.json()).toMatchObject({
      runId: started.runId,
      idempotentReplay: true,
    });

    await finishRun(app, projectId, started.runId);
    const run = new SqliteRunRepository(database).getSnapshot(started.runId);
    expect(run.run.recipe).toBe("canon-spread-candidate");
    expect(run.run.status).toBe("completed");
    const listed = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/canon-spreads/intent/candidates`,
    });
    expect(listed.statusCode, listed.body).toBe(200);
    const set = listed.json()[0] as {
      id: string;
      status: string;
      stale: boolean;
      items: { id: string; diff: { field: string }[] }[];
    };
    expect(set).toMatchObject({ status: "candidate", stale: false });
    expect(set.items[0]!.diff.map((field) => field.field)).toEqual([
      "currentFocus",
      "promise",
    ]);
    const beforeApply = (
      await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/story-bible`,
      })
    ).json();
    expect(beforeApply.intent.promise).not.toBe(
      "每一次寄信都必须留下可见且不可逆的记忆代价。",
    );

    const applied = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/canon-candidates/${set.id}/items/${set.items[0]!.id}/decisions`,
      payload: { action: "apply" },
    });
    expect(applied.statusCode, applied.body).toBe(200);
    expect(applied.json()).toMatchObject({
      candidateSet: { status: "applied", stale: true },
      item: { decision: { action: "apply" } },
    });
    const bible = (
      await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/story-bible`,
      })
    ).json();
    expect(bible.intent).toMatchObject({
      promise: "每一次寄信都必须留下可见且不可逆的记忆代价。",
      currentFocus: "验证每封信寄出后寄件人失去一段记忆",
    });

    const applyReplay = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/canon-candidates/${set.id}/items/${set.items[0]!.id}/decisions`,
      payload: { action: "apply" },
    });
    expect(applyReplay.statusCode, applyReplay.body).toBe(200);
  });

  it.each([
    "outline",
    "entities",
    "facts",
    "relations",
    "timeline",
    "foreshadows",
  ] as const)("creates and applies a %s candidate", async (spread) => {
    const { app } = await setup({ summary: "候选", items: [] });
    const projectId = await createProject(app, `候选覆盖-${spread}`);
    const fixture = await createSpreadFixture(app, projectId, spread);
    modelValue = {
      summary: `补充${spread}正典内容。`,
      items: [
        {
          operation: "create",
          targetId: null,
          title: fixture.title,
          rationale: "补齐当前故事方向需要的结构化正典。",
          impact: ["后续章节上下文会读取这一项"],
          afterJson: JSON.stringify(fixture.after),
        },
      ],
    };

    const started = await startCandidate(
      app,
      projectId,
      spread,
      `请补充${spread}内容`,
    );
    await finishRun(app, projectId, started.runId);
    const listed = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/canon-spreads/${spread}/candidates`,
    });
    expect(listed.statusCode, listed.body).toBe(200);
    const set = listed.json()[0] as {
      id: string;
      items: { id: string; operation: string; decision: unknown }[];
    };
    expect(set.items[0]).toMatchObject({
      operation: "create",
      decision: null,
    });

    const applied = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/canon-candidates/${set.id}/items/${set.items[0]!.id}/decisions`,
      payload: { action: "apply" },
    });
    expect(applied.statusCode, applied.body).toBe(200);
    expect(applied.json()).toMatchObject({
      candidateSet: { status: "applied" },
      item: { decision: { action: "apply" } },
    });

    const bible = (
      await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/story-bible`,
      })
    ).json();
    fixture.verify(bible);
  });

  it("rejects stale item application instead of overwriting current canon", async () => {
    const { app } = await setup({
      summary: "更新人物描述。",
      items: [],
    });
    const projectId = await createProject(app, "潮声档案");
    const createdEntity = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/entities`,
      payload: {
        type: "character",
        name: "沈砚",
        aliases: [],
        description: "守信人",
        attributes: {},
      },
    });
    const entity = createdEntity.json() as {
      id: string;
      updatedAt: string;
    };
    modelValue = {
      summary: "补充人物承担的代价。",
      items: [
        {
          operation: "update",
          targetId: entity.id,
          title: "补充人物描述",
          rationale: "与创作承诺对齐。",
          impact: ["人物卡描述发生变化"],
          afterJson: JSON.stringify({
            description: "每次寄信都会失去记忆的守信人",
          }),
        },
      ],
    };
    const started = await startCandidate(
      app,
      projectId,
      "entities",
      "补充人物代价",
    );
    await finishRun(app, projectId, started.runId);
    const set = (
      await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/canon-spreads/entities/candidates`,
      })
    ).json()[0];

    const manual = await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/entities/${entity.id}`,
      payload: {
        name: "沈砚",
        aliases: [],
        description: "作者刚刚手动改过的人物描述",
        attributes: {},
        status: "active",
        expectedUpdatedAt: entity.updatedAt,
      },
    });
    expect(manual.statusCode, manual.body).toBe(200);
    const conflict = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/canon-candidates/${set.id}/items/${set.items[0].id}/decisions`,
      payload: { action: "apply" },
    });
    expect(conflict.statusCode, conflict.body).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: { code: "canon_candidate.item.version_conflict" },
    });
  });

  it("requires explicit confirmation before changing locked intent fields", async () => {
    const { app } = await setup({ summary: "修改锁定承诺。", items: [] });
    const projectId = await createProject(app, "灯下潮痕");
    const bible = (
      await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/story-bible`,
      })
    ).json();
    await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/intent`,
      payload: {
        ...bible.intent,
        lockedFields: ["promise"],
        expectedUpdatedAt: bible.intent?.updatedAt ?? null,
      },
    });
    modelValue = {
      summary: "让承诺更具体。",
      items: [
        {
          operation: "update",
          targetId: "intent",
          title: "修改锁定承诺",
          rationale: "明确代价。",
          impact: ["全书创作基线变化"],
          afterJson: JSON.stringify({
            promise: "每封信都会夺走一段姓名记忆。",
          }),
        },
      ],
    };
    const started = await startCandidate(
      app,
      projectId,
      "intent",
      "明确创作承诺",
    );
    await finishRun(app, projectId, started.runId);
    const set = (
      await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/canon-spreads/intent/candidates`,
      })
    ).json()[0];
    expect(set.items[0].requiresLockedConfirmation).toBe(true);
    const blocked = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/canon-candidates/${set.id}/items/${set.items[0].id}/decisions`,
      payload: { action: "apply" },
    });
    expect(blocked.statusCode, blocked.body).toBe(409);
    expect(blocked.json()).toMatchObject({
      error: { code: "canon_candidate.locked_confirmation_required" },
    });
    const confirmed = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/canon-candidates/${set.id}/items/${set.items[0].id}/decisions`,
      payload: { action: "apply", confirmLocked: true },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
  });

  it("requires explicit confirmation before revising a locked fact", async () => {
    const { app } = await setup({ summary: "候选", items: [] });
    const projectId = await createProject(app, "锁定事实确认");
    const subject = await createEntity(app, projectId, "沈砚");
    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/facts`,
      payload: {
        subjectId: subject.id,
        predicate: "寄信代价",
        value: "失去一天记忆",
        knowledgeScope: "omniscient",
        authority: "locked",
        sourceType: "manual",
        confidence: 1,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const factId = created.json().fact.id as string;
    modelValue = {
      summary: "校正锁定事实。",
      items: [
        {
          operation: "update",
          targetId: factId,
          title: "校正寄信代价",
          rationale: "让代价与当前正文保持一致。",
          impact: ["会替代锁定事实"],
          afterJson: JSON.stringify({ value: "失去一段姓名记忆" }),
        },
      ],
    };
    const started = await startCandidate(
      app,
      projectId,
      "facts",
      "校正寄信代价",
    );
    await finishRun(app, projectId, started.runId);
    const set = (
      await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/canon-spreads/facts/candidates`,
      })
    ).json()[0];
    expect(set.items[0].requiresLockedConfirmation).toBe(true);

    const blocked = await decideItem(app, projectId, set, "apply");
    expect(blocked.statusCode, blocked.body).toBe(409);
    const confirmed = await decideItem(app, projectId, set, "apply", true);
    expect(confirmed.statusCode, confirmed.body).toBe(200);
  });

  it("persists rejected items without changing canon", async () => {
    const { app } = await setup({ summary: "候选", items: [] });
    const projectId = await createProject(app, "拒绝候选");
    modelValue = {
      summary: "调整当前焦点。",
      items: [
        {
          operation: "update",
          targetId: "intent",
          title: "调整当前焦点",
          rationale: "集中到第一封信。",
          impact: ["下一章目标变化"],
          afterJson: JSON.stringify({ currentFocus: "追查第一封信" }),
        },
      ],
    };
    const started = await startCandidate(
      app,
      projectId,
      "intent",
      "调整当前焦点",
    );
    await finishRun(app, projectId, started.runId);
    const set = (
      await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/canon-spreads/intent/candidates`,
      })
    ).json()[0];
    const rejected = await decideItem(app, projectId, set, "reject");
    expect(rejected.statusCode, rejected.body).toBe(200);
    expect(rejected.json()).toMatchObject({
      candidateSet: { status: "rejected" },
      item: { decision: { action: "reject" } },
    });
    const listed = (
      await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/canon-spreads/intent/candidates`,
      })
    ).json()[0];
    expect(listed.items[0].decision.action).toBe("reject");
    const bible = (
      await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/story-bible`,
      })
    ).json();
    expect(bible.intent.currentFocus).toBeNull();
  });
});

async function createSpreadFixture(
  app: Awaited<ReturnType<typeof buildApp>>,
  projectId: string,
  spread:
    "outline" | "entities" | "facts" | "relations" | "timeline" | "foreshadows",
): Promise<{
  title: string;
  after: Record<string, unknown>;
  verify: (bible: Record<string, unknown>) => void;
}> {
  if (spread === "outline") {
    const bible = (
      await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/story-bible`,
      })
    ).json() as { outline: { id: string }[] };
    const rootId = bible.outline[0]!.id;
    return {
      title: "补充第一章大纲",
      after: {
        parentId: rootId,
        kind: "chapter",
        ordinal: 0,
        title: "第一章：空白回信",
        summary: "围绕寄信与记忆代价推进。",
      },
      verify: (bible) =>
        expect(bible.outline).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ title: "第一章：空白回信" }),
          ]),
        ),
    };
  }
  if (spread === "entities")
    return {
      title: "登记守信人",
      after: {
        type: "character",
        name: "沈砚",
        aliases: ["守信人"],
        description: "替陌生人保管遗失记忆的人。",
      },
      verify: (bible) =>
        expect(bible.entities).toEqual(
          expect.arrayContaining([expect.objectContaining({ name: "沈砚" })]),
        ),
    };
  if (spread === "facts") {
    const subject = await createEntity(app, projectId, "沈砚");
    return {
      title: "登记记忆代价",
      after: {
        subjectId: subject.id,
        predicate: "每次寄信的代价",
        value: "失去一段与收件人有关的记忆",
        knowledgeScope: "omniscient",
        confidence: 1,
      },
      verify: (bible) =>
        expect(bible.facts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ predicate: "每次寄信的代价" }),
          ]),
        ),
    };
  }
  if (spread === "relations") {
    const from = await createEntity(app, projectId, "沈砚");
    const to = await createEntity(app, projectId, "回声邮局", "location");
    return {
      title: "登记守护关系",
      after: {
        fromEntityId: from.id,
        toEntityId: to.id,
        relation: "守护",
        intensity: 0.8,
        state: { trust: "fragile" },
        storyTime: "第一夜",
      },
      verify: (bible) =>
        expect(bible.relationships).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ relation: "守护" }),
          ]),
        ),
    };
  }
  if (spread === "timeline")
    return {
      title: "登记第一封回信",
      after: {
        title: "第一封空白回信显名",
        description: "煤油灯下浮现寄信人的姓名。",
        storyTimeStart: "第一夜 23:41",
        sequence: 1,
        participants: [],
        causes: [],
        visibility: "reader",
      },
      verify: (bible) =>
        expect(bible.timeline).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ title: "第一封空白回信显名" }),
          ]),
        ),
    };
  return {
    title: "登记跨章伏笔",
    after: {
      title: "空白信会抹去寄信人的记忆",
      description: "每次显名都会让寄信人遗失一段相关记忆。",
      status: "planted",
      importance: 4,
      dependencies: [],
      evidenceNodeIds: [],
    },
    verify: (bible) =>
      expect(bible.foreshadows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            title: "空白信会抹去寄信人的记忆",
          }),
        ]),
      ),
  };
}

async function createEntity(
  app: Awaited<ReturnType<typeof buildApp>>,
  projectId: string,
  name: string,
  type: "character" | "location" = "character",
) {
  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/entities`,
    payload: { type, name, aliases: [], description: null, attributes: {} },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as { id: string };
}

function decideItem(
  app: Awaited<ReturnType<typeof buildApp>>,
  projectId: string,
  set: { id: string; items: { id: string }[] },
  action: "apply" | "reject",
  confirmLocked = false,
) {
  return app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/canon-candidates/${set.id}/items/${set.items[0]!.id}/decisions`,
    payload: { action, confirmLocked },
  });
}

let modelValue: { summary: string; items: unknown[] } = {
  summary: "候选",
  items: [],
};

async function setup(initialValue: typeof modelValue) {
  modelValue = initialValue;
  const database = new NodeNarrativeDatabase();
  const environment = {
    NARRATIVE_LLM_API_KEY: "server-only-test-key",
    NARRATIVE_LLM_BASE_URL: "https://api.example.com/v1",
    NARRATIVE_LLM_MODEL: "test-model",
  };
  const app = await buildApp({
    config,
    database,
    environment,
    narrativeModelClient: candidateModel(),
    enableRunWorker: false,
    logger: false,
  });
  resources.push({ app, database });
  return { app, database };
}

function candidateModel(): NarrativeModelClient {
  return {
    async text() {
      throw new Error("Canon candidate must use structured output");
    },
    async structured(_run, _step, purpose, _request, _contract, validate) {
      if (purpose !== "canon-revision")
        throw new Error(`unexpected purpose ${purpose}`);
      const checked = validate(modelValue);
      if (!checked.success) throw new Error(checked.issues.join("; "));
      return {
        value: checked.data,
        usage: {
          inputTokens: 100,
          outputTokens: 100,
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
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: {
      requestId: globalThis.crypto.randomUUID(),
      title,
      premise: `${title}中的记忆与责任`,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().id as string;
}

async function startCandidate(
  app: Awaited<ReturnType<typeof buildApp>>,
  projectId: string,
  spread: string,
  instruction: string,
  requestId = "8e92f1f5-bc88-4657-a0ae-c7055e2bcad1",
) {
  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/canon-spreads/${spread}/candidates`,
    payload: {
      requestId,
      instruction,
    },
  });
  expect(response.statusCode, response.body).toBe(202);
  return response.json() as { runId: string };
}

async function finishRun(
  app: Awaited<ReturnType<typeof buildApp>>,
  projectId: string,
  runId: string,
) {
  for (let index = 0; index < 8; index += 1) {
    const response = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/advance`,
      payload: { projectId },
    });
    expect(response.statusCode, response.body).toBe(200);
    const status = response.json().snapshot.run.status as string;
    if (status === "completed") return;
    if (["failed", "cancelled"].includes(status))
      throw new Error(
        `candidate run ended as ${status}: ${JSON.stringify(response.json().snapshot.steps)}`,
      );
  }
  throw new Error("candidate run did not complete");
}
