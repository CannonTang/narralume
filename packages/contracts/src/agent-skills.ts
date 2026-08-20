import { z } from "zod";

const IdSchema = z.string().trim().min(1).max(300);
const TimestampSchema = z.string().min(1);

/**
 * Agent Skill：代码所有的任务编排声明，与 Writing Skill（写作提示层）分离。
 * Skill 只声明触发范围、所需上下文、允许的既有领域能力、输出类型和停靠点；
 * 不能注册新工具、不能直写数据库。专业角色（Writer/Reviewer）只作为内部步骤。
 */
export const AgentSkillOutputKindSchema = z.enum([
  "answer",
  "candidate",
  "task_handle",
  "long_goal",
]);
export type AgentSkillOutputKind = z.infer<typeof AgentSkillOutputKindSchema>;

export const AgentSkillCheckpointSchema = z.enum([
  "none",
  "confirm_start",
  "candidate_adoption",
]);
export type AgentSkillCheckpoint = z.infer<typeof AgentSkillCheckpointSchema>;

export const AgentSkillSchema = z.object({
  id: IdSchema,
  label: z.string().min(1).max(100),
  description: z.string().min(1).max(2_000),
  triggerDescription: z.string().min(1).max(2_000),
  requiredContext: z.array(z.string().min(1).max(100)),
  allowedCapabilities: z.array(z.string().trim().min(1).max(100)),
  outputKind: AgentSkillOutputKindSchema,
  checkpoint: AgentSkillCheckpointSchema,
  builtin: z.literal(true),
});
export type AgentSkillDto = z.infer<typeof AgentSkillSchema>;

/**
 * 导入的 Agent Skill（R9）：与内置注册表同形，但 builtin=false，
 * 额外携带来源与内容哈希，并按项目启停。包格式只允许声明名称、版本、
 * 触发说明、指令、参考资料、能力白名单、输出契约和停靠策略；不允许脚本、
 * Shell、网络插件、数据库写入或动态注册新工具。首期只允许只读和候选型能力。
 */
export const ImportedAgentSkillSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  label: z.string().min(1).max(100),
  version: z.string().trim().min(1).max(50),
  description: z.string().min(1).max(2_000),
  triggerDescription: z.string().min(1).max(2_000),
  instructions: z.string().min(1).max(100_000),
  references: z.array(
    z.object({
      path: z.string().min(1).max(500),
      contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    }),
  ),
  requiredContext: z.array(z.string().min(1).max(100)),
  allowedCapabilities: z.array(z.string().trim().min(1).max(100)),
  outputKind: AgentSkillOutputKindSchema,
  checkpoint: AgentSkillCheckpointSchema,
  enabled: z.boolean(),
  source: z.string().min(1).max(500),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type ImportedAgentSkillDto = z.infer<typeof ImportedAgentSkillSchema>;

export const ImportAgentSkillPackageRequestSchema = z
  .object({
    filename: z.string().trim().min(1).max(300),
    contentBase64: z.string().min(1).max(12_000_000),
  })
  .strict();
export type ImportAgentSkillPackageRequest = z.infer<
  typeof ImportAgentSkillPackageRequestSchema
>;

/**
 * 首期导入 Skill 只允许的能力：只读查询（story/review.inspect）与候选型
 * 能力（outline/canon/selection 候选生成、task.control 任务控制）。
 * 推进正式状态或消耗大额写作预算的 confirm 级能力（foundation/chapter/
 * autopilot/long_goal）不对导入包开放，仍由系统内置裁定接口完成。
 */
export const IMPORTABLE_AGENT_SKILL_CAPABILITIES: readonly string[] = [
  "story.inspect",
  "review.inspect",
  "outline.plan.start",
  "canon.candidate.start",
  "selection.edit.start",
  "task.control",
];

export const SetImportedAgentSkillEnabledRequestSchema = z
  .object({
    enabled: z.boolean(),
    expectedUpdatedAt: TimestampSchema,
  })
  .strict();
export type SetImportedAgentSkillEnabledRequest = z.infer<
  typeof SetImportedAgentSkillEnabledRequestSchema
>;

export const AssistantLongGoalPhaseSchema = z.enum([
  "foundation",
  "outline",
  "writing",
  "done",
]);
export type AssistantLongGoalPhase = z.infer<
  typeof AssistantLongGoalPhaseSchema
>;

export const AssistantLongGoalStatusSchema = z.enum([
  "active",
  "paused_baseline",
  "completed",
  "failed",
  "cancelled",
]);
export type AssistantLongGoalStatus = z.infer<
  typeof AssistantLongGoalStatusSchema
>;

export const AssistantLongGoalSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  conversationId: IdSchema,
  activityId: IdSchema,
  title: z.string().min(1).max(200),
  targetChapters: z.number().int().min(1).max(500),
  phase: AssistantLongGoalPhaseSchema,
  status: AssistantLongGoalStatusSchema,
  baselineHash: z.string().min(1),
  sessionId: IdSchema.nullable(),
  foundationRunId: IdSchema.nullable(),
  outlineSessionId: IdSchema.nullable(),
  lastError: z.object({ code: z.string(), message: z.string() }).nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type AssistantLongGoalDto = z.infer<typeof AssistantLongGoalSchema>;

export const StartAssistantLongGoalRequestSchema = z
  .object({
    requestId: IdSchema,
    targetChapters: z.number().int().min(1).max(50),
    braindump: z.string().trim().min(1).max(100_000).nullable().default(null),
  })
  .strict();
export type StartAssistantLongGoalRequest = z.infer<
  typeof StartAssistantLongGoalRequestSchema
>;

export const AssistantLongGoalAcceptedSchema = z.object({
  goal: AssistantLongGoalSchema,
  idempotentReplay: z.boolean(),
});
export type AssistantLongGoalAcceptedDto = z.infer<
  typeof AssistantLongGoalAcceptedSchema
>;

export const AssistantLongGoalActionRequestSchema = z
  .object({ action: z.enum(["resume", "cancel"]) })
  .strict();
