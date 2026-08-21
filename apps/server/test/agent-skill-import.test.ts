import type { NarrativeModelClient } from "@narralume/narrative";
import { NodeNarrativeDatabase } from "@narralume/persistence/node";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

const config: ServerConfig = {
  dataDirectory: ".",
  databasePath: ":memory:",
  host: "127.0.0.1",
  port: 4321,
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

interface SkillDto {
  id: string;
  projectId: string;
  label: string;
  version: string;
  description: string;
  allowedCapabilities: string[];
  outputKind: string;
  checkpoint: string;
  enabled: boolean;
  contentHash: string;
  updatedAt: string;
}

describe("agent skill import (R9)", () => {
  it("imports a valid package and exposes it in the project list", async () => {
    const { app } = await setup();
    const projectId = await createProject(app, "导入样本");

    const imported = await importPackage(app, projectId, {
      label: "伏笔巡检",
      allowedCapabilities: ["story.inspect", "task.control"],
    });
    expect(imported.id).toBeTruthy();
    expect(imported.label).toBe("伏笔巡检");
    expect(imported.version).toBe("1.0.0");
    expect(imported.allowedCapabilities).toEqual([
      "story.inspect",
      "task.control",
    ]);
    expect(imported.enabled).toBe(true);
    expect(imported.contentHash).toMatch(/^[a-f0-9]{64}$/u);

    const list = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/agent-skills`,
    });
    expect(list.statusCode).toBe(200);
    const skills = list.json() as SkillDto[];
    expect(skills).toHaveLength(1);
    expect(skills[0]?.id).toBe(imported.id);

    // 助手会话详情合并启用的导入技能。
    const conversation = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/assistant/conversations`,
      payload: {
        requestId: globalThis.crypto.randomUUID(),
        title: "导入技能可见性",
      },
    });
    expect(conversation.statusCode).toBe(201);
    const detail = await app.inject({
      method: "GET",
      url: `/api/assistant/conversations/${conversation.json().id}`,
    });
    expect(detail.statusCode).toBe(200);
    const importedSkills = detail.json().importedSkills as SkillDto[];
    expect(importedSkills.map((skill) => skill.id)).toEqual([imported.id]);
  });

  it("rejects packages without manifest or instructions", async () => {
    const { app } = await setup();
    const projectId = await createProject(app, "缺件样本");

    const noManifest = new JSZip();
    noManifest.file("INSTRUCTIONS.md", "只有指令，没有清单。");
    const missingManifest = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/agent-skills/import`,
      payload: {
        filename: "no-manifest.zip",
        contentBase64: (
          await noManifest.generateAsync({ type: "nodebuffer" })
        ).toString("base64"),
      },
    });
    expect(missingManifest.statusCode).toBe(422);
    expect(missingManifest.json().error.code).toBe(
      "agent_skill.missing_manifest",
    );

    const noInstructions = new JSZip();
    noInstructions.file(
      "agent-skill.json",
      JSON.stringify(manifest({ label: "无指令" })),
    );
    const missingInstructions = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/agent-skills/import`,
      payload: {
        filename: "no-instructions.zip",
        contentBase64: (
          await noInstructions.generateAsync({ type: "nodebuffer" })
        ).toString("base64"),
      },
    });
    expect(missingInstructions.statusCode).toBe(422);
    expect(missingInstructions.json().error.code).toBe(
      "agent_skill.missing_instructions",
    );

    const invalidManifest = new JSZip();
    invalidManifest.file("agent-skill.json", "{not json");
    invalidManifest.file("INSTRUCTIONS.md", "指令正文");
    const invalidManifestResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/agent-skills/import`,
      payload: {
        filename: "invalid-manifest.zip",
        contentBase64: (
          await invalidManifest.generateAsync({ type: "nodebuffer" })
        ).toString("base64"),
      },
    });
    expect(invalidManifestResponse.statusCode).toBe(422);
    expect(invalidManifestResponse.json().error.code).toBe(
      "agent_skill.invalid_manifest",
    );

    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/agent-skills`,
        })
      ).json(),
    ).toHaveLength(0);
  });

  it("rejects capabilities outside the whitelist", async () => {
    const { app } = await setup();
    const projectId = await createProject(app, "白名单样本");

    const zip = new JSZip();
    zip.file(
      "agent-skill.json",
      JSON.stringify(
        manifest({
          label: "越权写作",
          allowedCapabilities: ["story.inspect", "chapter.start"],
        }),
      ),
    );
    zip.file("INSTRUCTIONS.md", "尝试直接启动章节写作，不应被允许。");
    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/agent-skills/import`,
      payload: {
        filename: "escalation.zip",
        contentBase64: (
          await zip.generateAsync({ type: "nodebuffer" })
        ).toString("base64"),
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe(
      "agent_skill.capability_not_allowed",
    );
  });

  it("rejects highly compressed instructions before expanding them", async () => {
    const { app } = await setup();
    const projectId = await createProject(app, "高压缩比样本");
    const zip = new JSZip();
    zip.file(
      "agent-skill.json",
      JSON.stringify(manifest({ label: "过大指令" })),
    );
    zip.file("INSTRUCTIONS.md", "重复指令。".repeat(120_000));
    const bytes = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });
    expect(bytes.length).toBeLessThan(32 * 1024);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/agent-skills/import`,
      payload: {
        filename: "compressed-bomb.zip",
        contentBase64: bytes.toString("base64"),
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe(
      "agent_skill.instructions_too_large",
    );
  });

  it("rejects unsafe reference paths and duplicate labels", async () => {
    const { app } = await setup();
    const projectId = await createProject(app, "路径样本");

    const unsafe = new JSZip();
    unsafe.file(
      "agent-skill.json",
      JSON.stringify(manifest({ label: "路径穿越" })),
    );
    unsafe.file("INSTRUCTIONS.md", "引用路径穿越包外，必须被拒绝。");
    // JSZip 加载时会清洗 ".."，但保留绝对路径；服务端必须拒绝。
    unsafe.file("/etc/passwd", "越界内容");
    const unsafeBytes = await unsafe.generateAsync({ type: "nodebuffer" });
    const unsafeResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/agent-skills/import`,
      payload: {
        filename: "unsafe.zip",
        contentBase64: unsafeBytes.toString("base64"),
      },
    });
    expect(unsafeResponse.statusCode).toBe(422);
    expect(unsafeResponse.json().error.code).toBe("agent_skill.unsafe_path");

    await importPackage(app, projectId, { label: "重名技能" });
    const duplicate = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/agent-skills/import`,
      payload: {
        filename: "duplicate.zip",
        contentBase64: await packageBase64({ label: "重名技能" }),
      },
    });
    expect(duplicate.statusCode).toBe(422);
    expect(duplicate.json().error.code).toBe("agent_skill.duplicate_label");
  });

  it("toggles enabled with optimistic concurrency and deletes cleanly", async () => {
    const { app } = await setup();
    const projectId = await createProject(app, "启停样本");
    const skill = await importPackage(app, projectId, { label: "启停技能" });

    const disabled = await app.inject({
      method: "POST",
      url: `/api/agent-skills/${skill.id}/enabled`,
      payload: { enabled: false, expectedUpdatedAt: skill.updatedAt },
    });
    expect(disabled.statusCode, disabled.body).toBe(200);
    expect(disabled.json().enabled).toBe(false);

    // 停用的技能不再出现在会话详情。
    const conversation = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/assistant/conversations`,
      payload: {
        requestId: globalThis.crypto.randomUUID(),
        title: "停用可见性",
      },
    });
    const detail = await app.inject({
      method: "GET",
      url: `/api/assistant/conversations/${conversation.json().id}`,
    });
    expect(detail.json().importedSkills).toHaveLength(0);

    // 旧的 expectedUpdatedAt 触发并发冲突。
    const conflict = await app.inject({
      method: "POST",
      url: `/api/agent-skills/${skill.id}/enabled`,
      payload: { enabled: true, expectedUpdatedAt: skill.updatedAt },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe(
      "imported_agent_skill.version.conflict",
    );

    const enabled = await app.inject({
      method: "POST",
      url: `/api/agent-skills/${skill.id}/enabled`,
      payload: {
        enabled: true,
        expectedUpdatedAt: disabled.json().updatedAt,
      },
    });
    expect(enabled.statusCode, enabled.body).toBe(200);
    expect(enabled.json().enabled).toBe(true);

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/agent-skills/${skill.id}`,
    });
    expect(removed.statusCode).toBe(204);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/agent-skills`,
        })
      ).json(),
    ).toHaveLength(0);

    const missing = await app.inject({
      method: "DELETE",
      url: `/api/agent-skills/${skill.id}`,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("agent_skill.not_found");
  });

  it("keeps skills isolated per project", async () => {
    const { app } = await setup();
    const firstId = await createProject(app, "项目甲");
    const secondId = await createProject(app, "项目乙");
    await importPackage(app, firstId, { label: "甲的技能" });

    const secondList = await app.inject({
      method: "GET",
      url: `/api/projects/${secondId}/agent-skills`,
    });
    expect(secondList.json()).toHaveLength(0);
  });
});

function manifest(overrides: {
  label: string;
  allowedCapabilities?: string[];
}): Record<string, unknown> {
  return {
    format: "narrative-agent-skill",
    version: 1,
    label: overrides.label,
    skillVersion: "1.0.0",
    description: "导入测试用技能",
    triggerDescription: "测试触发",
    requiredContext: ["project"],
    allowedCapabilities: overrides.allowedCapabilities ?? ["story.inspect"],
    outputKind: "answer",
    checkpoint: "none",
  };
}

async function packageBase64(overrides: {
  label: string;
  allowedCapabilities?: string[];
}): Promise<string> {
  const zip = new JSZip();
  zip.file("agent-skill.json", JSON.stringify(manifest(overrides)));
  zip.file("INSTRUCTIONS.md", "按清单给出的触发说明工作，只读查询并汇总。");
  zip.file("references/checklist.md", "# 检查表\n- 是否引用了项目事实");
  return (await zip.generateAsync({ type: "nodebuffer" })).toString("base64");
}

async function setup() {
  const database = new NodeNarrativeDatabase();
  const app = await buildApp({
    config,
    database,
    environment: {
      NARRATIVE_LLM_API_KEY: "server-only-test-key",
      NARRATIVE_LLM_BASE_URL: "https://api.example.com/v1",
      NARRATIVE_LLM_MODEL: "test-model",
      NARRATIVE_LLM_CONTEXT_WINDOW: "128000",
      NARRATIVE_LLM_MAX_OUTPUT_TOKENS: "32000",
    },
    narrativeModelClient: fakeModel(),
    enableRunWorker: false,
    logger: false,
  });
  resources.push({ app, database });
  return { app, database };
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
      premise: `${title} 的前提。`,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().id as string;
}

async function importPackage(
  app: Awaited<ReturnType<typeof buildApp>>,
  projectId: string,
  overrides: { label: string; allowedCapabilities?: string[] },
): Promise<SkillDto> {
  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/agent-skills/import`,
    payload: {
      filename: `${overrides.label}.zip`,
      contentBase64: await packageBase64(overrides),
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as SkillDto;
}

function fakeModel(): NarrativeModelClient {
  return {
    async complete() {
      throw new Error("not needed for agent skill import tests");
    },
    stream() {
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        async next(): Promise<IteratorResult<unknown>> {
          throw new Error("not needed for agent skill import tests");
        },
      };
    },
  } as unknown as NarrativeModelClient;
}
