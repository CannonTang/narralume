import { AgentSkillSchema, type AgentSkillDto } from "@narralume/contracts";

/**
 * 内置 Agent Skill 注册表：代码所有，与 Writing Skill（写作提示层）分离。
 * Skill 只声明触发范围、所需上下文、允许的既有领域能力、输出类型和停靠点；
 * 实际执行永远复用 assistant 工具登记表与既有 Run/Session，不注册新工具。
 * 专业 Writer/Reviewer 等角色只作为章节/审稿配方内部步骤，不对用户暴露配置。
 */
export const AGENT_SKILL_REGISTRY: readonly AgentSkillDto[] = [
  {
    id: "story.query",
    label: "故事查询",
    description: "只读查看作品事实、大纲、正典、时间线、伏笔与运行状态。",
    triggerDescription: "询问当前作品状态、设定一致性、进度或下一步建议。",
    requiredContext: ["project"],
    allowedCapabilities: ["story.inspect", "review.inspect"],
    outputKind: "answer",
    checkpoint: "none",
    builtin: true,
  },
  {
    id: "book.foundation",
    label: "建书与规划",
    description: "整理故事方向候选并补齐后续章节大纲。",
    triggerDescription: "从零整理故事方向，或为后续章节补齐大纲节点。",
    requiredContext: ["project"],
    allowedCapabilities: ["foundation.start", "outline.plan.start"],
    outputKind: "candidate",
    checkpoint: "confirm_start",
    builtin: true,
  },
  {
    id: "chapter.write",
    label: "单章写作",
    description: "为明确的章节大纲生成候选正文，采纳前停在待确认边界。",
    triggerDescription: "指定一个已有章节节点，委托 AI 完成该章候选正文。",
    requiredContext: ["project", "outlineNode"],
    allowedCapabilities: ["chapter.start"],
    outputKind: "candidate",
    checkpoint: "confirm_start",
    builtin: true,
  },
  {
    id: "serial.write",
    label: "连续创作",
    description: "串行推进多个章节的快速创作会话。",
    triggerDescription: "指定章节数，连续完成一段正文的快速创作。",
    requiredContext: ["project"],
    allowedCapabilities: ["autopilot.start"],
    outputKind: "task_handle",
    checkpoint: "confirm_start",
    builtin: true,
  },
  {
    id: "compose.serial",
    label: "复合创作任务",
    description: "整理故事方向、补齐章节大纲，再连续创作指定章节数。",
    triggerDescription:
      "委托一件完整的长任务：整理大纲 → 建立章节 → 连续创作指定章节数。",
    requiredContext: ["project"],
    allowedCapabilities: [
      "foundation.start",
      "outline.plan.start",
      "autopilot.start",
    ],
    outputKind: "long_goal",
    checkpoint: "confirm_start",
    builtin: true,
  },
  {
    id: "review.run",
    label: "审稿",
    description: "查看审稿状态与未处理问题；深度审稿作为按需任务另行启动。",
    triggerDescription: "查询当前审稿结论、未处理问题或裁定历史。",
    requiredContext: ["project"],
    allowedCapabilities: ["review.inspect"],
    outputKind: "answer",
    checkpoint: "none",
    builtin: true,
  },
  {
    id: "canon.edit",
    label: "Canon 编辑",
    description: "为指定故事板块生成结构化候选修改；采纳仍逐项裁定。",
    triggerDescription: "明确要求修改人物、正典、时间线、伏笔等故事板块。",
    requiredContext: ["project", "canonSpread"],
    allowedCapabilities: ["canon.candidate.start"],
    outputKind: "candidate",
    checkpoint: "candidate_adoption",
    builtin: true,
  },
  {
    id: "selection.polish",
    label: "局部润色",
    description: "对当前稿件的明确选区生成修改候选。",
    triggerDescription: "选中一段正文，要求润色、改写或收紧。",
    requiredContext: ["project", "document", "selection"],
    allowedCapabilities: ["selection.edit.start"],
    outputKind: "candidate",
    checkpoint: "candidate_adoption",
    builtin: true,
  },
].map((skill) => AgentSkillSchema.parse(skill));

export function getBuiltinAgentSkill(id: string): AgentSkillDto | null {
  return AGENT_SKILL_REGISTRY.find((skill) => skill.id === id) ?? null;
}
