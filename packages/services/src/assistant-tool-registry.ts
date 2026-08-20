import {
  AssistantToolDescriptorSchema,
  assistantToolAccess,
  type AssistantToolDescriptorDto,
  type AssistantToolName,
} from "@narrative-lantern/contracts";

interface AssistantToolDescriptorSeed {
  readonly name: AssistantToolName;
  readonly label: string;
  readonly description: string;
}

/**
 * The project assistant can only propose tools declared here. This is a
 * code-owned allowlist, not a model-authored capability list. The access
 * grading (read / auto / confirm) lives in
 * `@narrative-lantern/contracts` assistant-tool-policy and is shared with the
 * narrative stage worker; these descriptors only carry author-facing copy.
 */
const ASSISTANT_TOOL_COPY: readonly AssistantToolDescriptorSeed[] = [
  {
    name: "story.inspect",
    label: "查看故事状态",
    description: "只读查看作者意图、大纲、人物、正典、时间线和伏笔。",
  },
  {
    name: "review.inspect",
    label: "查看审稿状态",
    description: "只读查看最近的审稿报告、未处理问题和裁定记录。",
  },
  {
    name: "foundation.start",
    label: "整理故事方向",
    description: "复用现有建书候选任务；结果仍需作者逐项采纳。",
  },
  {
    name: "chapter.start",
    label: "开始单章写作",
    description: "为明确的章节大纲启动现有单章生产任务。",
  },
  {
    name: "autopilot.start",
    label: "开始 AI 快速创作",
    description: "启动现有连续或逐章确认的快速创作会话。",
  },
  {
    name: "outline.plan.start",
    label: "规划后续章节",
    description:
      "只为后续章节生成或补齐大纲节点；任务到大纲完成即结束，不会继续写正文。",
  },
  {
    name: "canon.candidate.start",
    label: "生成 Canon 候选修改",
    description: "为指定故事板块生成结构化候选修改；采纳仍由作者逐项裁定。",
  },
  {
    name: "selection.edit.start",
    label: "修改选中文本",
    description: "对当前稿件的明确选区生成修改候选；采纳仍由作者确认。",
  },
  {
    name: "long_goal.start",
    label: "启动复合创作任务",
    description:
      "作者最终目标是正文时，串联整理故事方向、补齐章节大纲与连续创作指定章节数。",
  },
  {
    name: "task.control",
    label: "控制当前任务",
    description: "控制已经存在的 Run / 快速创作会话，并处理可恢复的章节失败。",
  },
];

export const ASSISTANT_TOOL_REGISTRY: readonly AssistantToolDescriptorDto[] =
  ASSISTANT_TOOL_COPY.map((tool) =>
    AssistantToolDescriptorSchema.parse({
      ...tool,
      access: assistantToolAccess(tool.name),
    }),
  );

export function isRegisteredAssistantTool(
  name: string,
): name is AssistantToolName {
  return ASSISTANT_TOOL_REGISTRY.some((tool) => tool.name === name);
}
