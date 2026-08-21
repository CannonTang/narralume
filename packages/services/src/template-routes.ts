import { randomUuid } from "@narralume/domain";
import type { RouteApp } from "@narralume/services";

import {
  CloneHarnessTemplateRequestSchema,
  HarnessTemplateSchema,
  RestoreHarnessTemplateRequestSchema,
  UpdateHarnessTemplateRequestSchema,
} from "@narralume/contracts";
import { validateRecipeTemplateContent } from "@narralume/harness";
import {
  SqliteTemplateRepository,
  type NarrativeDatabase,
} from "@narralume/persistence";
import { z } from "zod";

const ParamsSchema = z.object({ key: z.string().min(1) });

export function seedHarnessTemplates(
  database: NarrativeDatabase,
  now = new Date().toISOString(),
): void {
  new SqliteTemplateRepository(database).seed(
    TEMPLATE_DEFINITIONS.map((definition) => ({
      ...definition,
      updatedAt: now,
    })),
  );
}

export function registerTemplateRoutes(
  app: RouteApp,
  database: NarrativeDatabase,
): void {
  const templates = new SqliteTemplateRepository(database);
  app.route("GET", "/api/harness/templates", async () =>
    templates.list().map((template) => HarnessTemplateSchema.parse(template)),
  );
  app.route("PUT", "/api/harness/templates/:key", async (request) => {
    const { key } = ParamsSchema.parse(request.params);
    const input = UpdateHarnessTemplateRequestSchema.parse(request.body);
    const current = templates.getByKey(key);
    if (current?.kind === "recipe")
      validateRecipeTemplateContent(key, input.content);
    return HarnessTemplateSchema.parse(
      templates.updateOverride(
        key,
        input.content,
        input.expectedVersion,
        new Date().toISOString(),
      ),
    );
  });
  app.route("POST", "/api/harness/templates/:key/restore", async (request) => {
    const { key } = ParamsSchema.parse(request.params);
    const input = RestoreHarnessTemplateRequestSchema.parse(request.body);
    return HarnessTemplateSchema.parse(
      templates.restoreDefault(
        key,
        input.expectedVersion,
        new Date().toISOString(),
      ),
    );
  });
  app.route("POST", "/api/harness/templates/:key/clone", async (request) => {
    const { key } = ParamsSchema.parse(request.params);
    const input = CloneHarnessTemplateRequestSchema.parse(request.body);
    return {
      status: 201,
      body: HarnessTemplateSchema.parse(
        templates.clone(key, {
          id: randomUuid(),
          ...input,
          updatedAt: new Date().toISOString(),
        }),
      ),
    };
  });
}

const TEMPLATE_DEFINITIONS = [
  {
    id: "prompt-scene-plan",
    kind: "prompt" as const,
    key: "prompt.scene-plan",
    name: "章节场景规划",
    description: "在当前章范围内拆分目标、阻力、转折与结果。",
    systemInvariants: "不得写正文；不得创建上下文外的锁定事实；只规划当前章。",
    defaultContent: "优先让每个场景改变人物选择空间，并显式连接前后因果。",
  },
  {
    id: "prompt-chapter-draft",
    kind: "prompt" as const,
    key: "prompt.chapter-draft",
    name: "章节正文",
    description: "依据已编译上下文和场景计划生成正文。",
    systemInvariants: "锁定正典优先；遵守知识边界；只输出正文。",
    defaultContent: "让转折通过行动和后果落地，避免总结腔与解释性结尾。",
  },
  {
    id: "prompt-semantic-review",
    kind: "prompt" as const,
    key: "prompt.semantic-review",
    name: "语义审稿",
    description: "以证据检查连续性、角色、因果、视角与风格。",
    systemInvariants:
      "每个问题必须逐字举证；无法举证不得提出；误报不得触发修订。",
    defaultContent: "优先报告影响读者理解或人物能动性的少量高价值问题。",
  },
  {
    id: "prompt-chapter-revision",
    kind: "prompt" as const,
    key: "prompt.chapter-revision",
    name: "章节修订",
    description: "针对已举证问题形成最小充分修订。",
    systemInvariants:
      "不得改写锁定正典；不得借润色全篇换风格；只输出完整正文。",
    defaultContent: "保留原稿有效段落，只改动与问题因果链直接相关的部分。",
  },
  {
    id: "prompt-chapter-settlement",
    kind: "prompt" as const,
    key: "prompt.chapter-settlement",
    name: "章节结算",
    description: "从正文提取状态变化与正典候选。",
    systemInvariants:
      "所有结果都是候选；只引用已知实体 ID；不得把修辞或谎言当事实。",
    defaultContent: "宁可少提取，也不要用缺乏正文证据的推断填满字段。",
  },
  {
    id: "recipe-chapter-production",
    kind: "recipe" as const,
    key: "recipe.chapter-production",
    name: "章节生产配方",
    description: "上下文、规划、正文、双重检查、修订、结算与提交。",
    systemInvariants: "commit 永远位于门禁和 settle 之后；不得移除确定性检查。",
    defaultContent: JSON.stringify(
      {
        steps: [
          "context.compile",
          "scene.plan",
          "draft.generate",
          "deterministic.check",
          "semantic.review",
          "revision.generate?",
          "chapter.settle",
          "chapter.commit",
        ],
        maxRevisionCycles: 2,
      },
      null,
      2,
    ),
  },
  {
    id: "recipe-cocreate-reply",
    kind: "recipe" as const,
    key: "recipe.cocreate-reply",
    name: "共同创作回复配方",
    description: "编译故事房上下文、回复并暂存候选。",
    systemInvariants: "回复不得自动进入正典或正文；采纳必须走独立配方。",
    defaultContent: JSON.stringify(
      { steps: ["cocreate.context", "cocreate.respond", "cocreate.stage"] },
      null,
      2,
    ),
  },
] as const;
