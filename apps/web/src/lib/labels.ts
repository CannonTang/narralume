import type {
  AssignmentRole,
  AutopilotSession,
  AutopilotSessionDetail,
  CanonEntity,
  CanonFact,
  ExportFormat,
  FoundationCandidate,
  FoundationCandidateSet,
  Foreshadow,
  ModelConfigDto,
  NarrativeRun,
  OutlineNode,
  Project,
  ProjectQualityReport,
  QualityPreset,
  ReviewIssueDecisionAction,
  ReviewRevisionProposal,
  ReviewWorkspaceIssue,
  ReviewWorkspaceReport,
  RunStatus,
  RunStepKind,
  StoryDocument,
  StoryPersona,
  WireApi,
  WritingSkillScope,
} from "./api";

/* ==========================================================================
   集中标签表：状态 / 步骤 / 角色 / 模式的中文名，从各旧视图去重搬入。
   ========================================================================== */

/* --- 运行 -------------------------------------------------------------- */

export function runStatusLabel(status: RunStatus, recipe?: string): string {
  return {
    pending: "等待点灯",
    running: "正在写作",
    paused: "已停在安全边界",
    awaiting_user: "等待作者裁决",
    failed_recoverable: "可恢复故障",
    failed: "运行失败",
    cancelled: "已取消",
    completed: recipe === "chapter-production" ? "章节已提交" : "运行已完成",
  }[status];
}

/** 面向列表的短版运行状态（无 recipe 语境）。 */
export function runStatusShortLabel(status: string): string {
  return (
    {
      pending: "等待",
      running: "执行中",
      paused: "已暂停",
      awaiting_user: "等待作者",
      failed_recoverable: "等待自动重试",
      failed: "失败",
      cancelled: "已取消",
      completed: "完成",
    }[status] ?? status
  );
}

export function runStepLabel(kind: RunStepKind): string {
  return {
    "context.compile": "整理本章背景",
    "scene.plan": "场景规划",
    "draft.generate": "生成初稿",
    "deterministic.check": "确定性检查",
    "semantic.review": "证据审稿",
    "revision.generate": "有界修订",
    "chapter.settle": "章节结算",
    "chapter.commit": "原子提交",
    "foundation.generate": "生成建书候选",
    "foundation.stage": "登记候选",
    "outline.generate": "规划后续章节",
    "outline.commit": "写入航线",
    "steer.classify": "分类导演指令",
    "arc.review": "故事弧复盘",
    "volume.review": "卷级复盘",
    "cocreate.context": "编排故事房上下文",
    "cocreate.respond": "生成角色回复",
    "cocreate.stage": "登记回复版本",
    "adoption.prepare": "整理采纳范围",
    "adoption.settle": "结算场景与正典候选",
    "adoption.commit": "提交共创场景",
    "edit.transform": "生成选区改写",
    "edit.stage": "登记可审阅差异",
    "import.analyze": "AI 拆解旧稿",
    "import.stage": "登记拆书候选",
    "assistant.context": "整理协作上下文",
    "assistant.respond": "生成协作回复",
    "assistant.stage": "登记协作结果",
    "canon.context": "整理正典上下文",
    "canon.candidate": "生成正典修改候选",
    "canon.stage": "登记正典修改候选",
  }[kind];
}

export function runModeLabel(mode: NarrativeRun["mode"]): string {
  return {
    autopilot: "AI 快速创作",
    "chapter-gate": "章节闸门",
    director: "导演模式",
    "co-create": "共同创作",
    manual: "手动流水线",
  }[mode];
}

export function runVerdictLabel(verdict: "pass" | "revise" | "block"): string {
  return { pass: "通过", revise: "需要修订", block: "阻断" }[verdict];
}

/* --- 模型供给：Provider / Model / Assignment ----------------------------- */

export function wireApiLabel(wireApi: WireApi): string {
  return {
    "openai-chat": "Chat Completions",
    "openai-responses": "Responses",
    "anthropic-messages": "Anthropic Messages",
  }[wireApi];
}

export function assignmentRoleLabel(role: AssignmentRole): string {
  return {
    writing: "写作",
    planning: "规划",
    review: "审稿",
    embedding: "向量",
    rerank: "重排",
  }[role];
}

/** 角色用途与降级规则（与后端语义一致）。 */
export function assignmentRoleHint(role: AssignmentRole): string {
  return {
    writing: "正文、修订、结算和通用分析",
    planning: "建书、场景计划、后续章节规划；未设置时回落到写作",
    review: "语义审稿；未设置时回落到写作",
    embedding: "向量检索；未设置时显式降级，不回落写作",
    rerank: "重排；未设置时显式降级，当前没有生产调用闭环",
  }[role];
}

export function metadataSourceLabel(
  source: ModelConfigDto["metadataSource"],
): string {
  return {
    manual: "手动声明",
    environment: "环境",
    catalog: "目录",
    migration: "迁移",
  }[source];
}

export function qualityPresetLabel(preset: QualityPreset): string {
  return { fast: "快速", standard: "标准", deep: "深研" }[preset];
}

export function probeStageLabel(
  stage: "text" | "stream" | "tool" | "structured-output",
): string {
  return {
    text: "基础文本",
    stream: "流式事件",
    tool: "工具调用",
    "structured-output": "结构输出",
  }[stage];
}

export function probeStageStatusLabel(
  status: "passed" | "failed" | "unsupported" | "skipped",
): string {
  return {
    passed: "通过",
    failed: "失败",
    unsupported: "不支持",
    skipped: "跳过",
  }[status];
}

/* --- 故事圣经 ----------------------------------------------------------- */

export function projectPhaseLabel(phase: Project["phase"]): string {
  return {
    idea: "创意",
    foundation: "设定",
    outlining: "大纲",
    writing: "写作",
    revising: "修订",
    complete: "完成",
  }[phase];
}

export function entityTypeLabel(type: CanonEntity["type"]): string {
  return {
    character: "人物",
    location: "地点",
    organization: "组织",
    item: "物件",
    rule: "规则",
    concept: "概念",
  }[type];
}

export function outlineKindLabel(kind: OutlineNode["kind"]): string {
  return {
    book: "全书",
    volume: "卷",
    arc: "篇章",
    chapter: "章",
    scene: "场景",
    beat: "节拍",
  }[kind];
}

export function outlineStatusLabel(status: OutlineNode["status"]): string {
  return {
    planned: "计划",
    drafting: "起草",
    review: "审查",
    committed: "已定稿",
    abandoned: "已弃用",
  }[status];
}

export function factAuthorityLabel(authority: CanonFact["authority"]): string {
  return {
    candidate: "候选",
    inferred: "推断",
    confirmed: "确认",
    locked: "锁定",
  }[authority];
}

export function foreshadowStatusLabel(status: Foreshadow["status"]): string {
  return {
    planned: "计划埋设",
    planted: "已埋下",
    developing: "正在推进",
    resolved: "已回收",
    abandoned: "已放弃",
  }[status];
}

/* --- 自动驾驶 / 建书候选 -------------------------------------------------- */

export function autopilotSessionStatusLabel(
  status: AutopilotSession["status"],
): string {
  return {
    pending: "等待开始",
    planning: "正在规划章节",
    running: "连续创作中",
    paused: "已暂停",
    awaiting_user: "等待作者处理",
    failed: "需要处理",
    cancelled: "创作已停止",
    completed: "创作已完成",
  }[status];
}

export function autopilotLinkRoleLabel(
  role: AutopilotSessionDetail["links"][number]["role"],
): string {
  return {
    "rolling-plan": "后续章节规划",
    chapter: "本章写作",
    "closing-review": "阶段复盘",
  }[role];
}

export function steerClassificationLabel(
  value: NonNullable<
    AutopilotSessionDetail["steers"][number]["classification"]
  >,
): string {
  return {
    immediate_current: "立即影响当前生成",
    next_scene: "下一场景生效",
    future_plan: "重排未来计划",
    canon_change: "正典变更候选",
    rewrite_existing: "需要重写既有正文",
    temporary_director_note: "临时导演注",
  }[value];
}

export function steerStatusLabel(
  steer: AutopilotSessionDetail["steers"][number],
): string {
  if (steer.status === "awaiting_confirmation")
    return `${steer.classification ? steerClassificationLabel(steer.classification) : "创作变更"} · 等待裁定`;
  if (steer.status === "applied")
    return `${steer.classification ? steerClassificationLabel(steer.classification) : "创作指示"} · 已应用`;
  if (steer.status === "rejected") return "未应用";
  if (steer.classification) return steerClassificationLabel(steer.classification);
  if (steer.status === "classifying") return "正在判断影响范围";
  return "等待判断影响范围";
}

export function foundationCandidateKindLabel(
  kind: FoundationCandidate["kind"],
): string {
  return { intent: "意图", compass: "指南针", entity: "实体" }[kind];
}

export function foundationCandidateStatusLabel(
  status: FoundationCandidate["status"],
): string {
  return { pending: "待裁定", adopted: "已采纳", discarded: "已搁置" }[
    status
  ];
}

export function foundationCandidateSetStatusLabel(
  status: FoundationCandidateSet["set"]["status"],
): string {
  return {
    open: "待裁定",
    partially_adopted: "部分采纳",
    adopted: "已采纳",
    discarded: "已搁置",
  }[status];
}

/* --- 审稿室 -------------------------------------------------------------- */

export function reviewCategoryLabel(category: string): string {
  return (
    (
      {
        continuity: "连续性",
        canon: "正典",
        pov: "视角",
        character: "人物",
        agency: "能动性",
        causality: "因果",
        pacing: "节奏",
        information: "信息释放",
        prose: "文句",
        style: "风格",
        foreshadow: "伏笔",
        goal: "章节目标",
        safety: "边界",
      } as Record<string, string>
    )[category] ?? category
  );
}

export function reviewIssueStatusLabel(issue: ReviewWorkspaceIssue): string {
  if (issue.decision) return reviewIssueActionLabel(issue.decision.action);
  return issue.status === "open" ? "待裁定" : issue.status;
}

export function reviewIssueActionLabel(
  action: ReviewIssueDecisionAction,
): string {
  return {
    accept: "已接受",
    reject: "已拒绝",
    false_positive: "误报",
    intentional_keep: "故意保留",
  }[action];
}

export function reviewVerdictLabel(
  verdict: ReviewWorkspaceReport["verdict"],
): string {
  return { pass: "通过", revise: "建议修订", block: "阻断" }[verdict];
}

export function proposalStatusLabel(
  status: ReviewRevisionProposal["status"],
): string {
  return {
    proposed: "待定",
    accepted: "已采纳",
    rejected: "已拒绝",
    superseded: "已被替代",
  }[status];
}

/* --- 交付 / 导入 / 体检 --------------------------------------------------- */

export function qualityReadinessLabel(
  readiness: ProjectQualityReport["readiness"],
): string {
  if (readiness === "blocked") return "未通过交付门禁";
  if (readiness === "needs_attention") return "门禁通过，建议复核";
  return "可以交付";
}

export function qualitySeverityLabel(
  severity: ProjectQualityReport["issues"][number]["severity"],
): string {
  return severity === "error" ? "阻塞" : severity === "warning" ? "提醒" : "建议";
}

export function importStatusLabel(status: string): string {
  return (
    (
      {
        previewed: "预览候选",
        analyzing: "AI 拆书中",
        ready: "等待裁定",
        applied: "已采用",
        discarded: "已放弃",
      } as Record<string, string>
    )[status] ?? status
  );
}

export function importCandidateKindLabel(kind: string): string {
  return (
    (
      {
        project: "作品",
        document: "稿件",
        outline: "大纲",
        intent: "意图",
        entity: "实体",
        style: "风格",
        skill: "Skill",
        relationship: "关系",
        timeline: "时间线",
        foreshadow: "伏笔",
        "character-arc": "角色弧",
        "scene-analysis": "场景分析",
      } as Record<string, string>
    )[kind] ?? kind
  );
}

export function writingSkillScopeLabel(scope: WritingSkillScope): string {
  return {
    all: "全部",
    chapter: "章节",
    cocreate: "共创",
    edit: "改写",
    review: "审稿",
  }[scope];
}

export function exportFormatLabel(format: ExportFormat): string {
  return {
    markdown: "Markdown",
    text: "纯文本",
    docx: "DOCX",
    epub: "EPUB",
    "narrative-bundle": "作品包",
  }[format];
}

/* --- 写作台 --------------------------------------------------------------- */

export function documentKindLabel(kind: StoryDocument["kind"]): string {
  return {
    manuscript: "正文总稿",
    chapter: "章节正文",
    scene: "场景正文",
    outline: "大纲稿",
    synopsis: "故事梗概",
    note: "写作笔记",
    "style-sample": "风格样本",
  }[kind];
}

export function documentSourceLabel(source: string): string {
  if (source.startsWith("restore:")) return "历史恢复";
  if (source.startsWith("edit-proposal:")) return "AI 提案";
  if (source.startsWith("cocreate:")) return "故事房采纳";
  return source === "manual" ? "手工保存" : source;
}

export function speakerPolicyLabel(
  policy: "manual" | "round_robin" | "auto",
): string {
  return { manual: "手动点名", round_robin: "依次发言", auto: "剧情调度" }[
    policy
  ];
}

export function personaKindLabel(kind: StoryPersona["kind"]): string {
  return { author: "作者代理", narrator: "叙述者", character: "角色" }[kind];
}

/* --- 任务协议（origin / stopReason / availableActions / nextAction） --------- */

/** 后台任务可执行动作的中文名（RunAvailableAction + 航次失败处置）。 */
export function taskActionLabel(action: string): string {
  return (
    {
      pause: "暂停",
      resume: "继续",
      cancel: "取消",
      accept_plan: "采纳规划",
      switch_to_manual: "转手动创作",
      accept_manuscript: "采纳正文",
      request_revision: "请求修订",
      discard_manuscript: "丢弃正文",
      use_partial: "取用残稿",
      regenerate: "重生成",
      retry_chapter: "重试本章",
      "retry-current": "重试当前章节",
      "skip-chapter": "跳过本章",
      replan: "重新规划",
      stop: "终止并结算",
    } as Record<string, string>
  )[action] ?? action;
}

export function taskStatusLabel(status: string): string {
  return (
    {
      pending: "等待开始",
      planning: "正在规划",
      running: "正在创作",
      paused: "已暂停",
      awaiting_user: "等待你处理",
      failed_recoverable: "等待自动重试",
      failed: "需要处理",
      cancelled: "已取消",
      completed: "已完成",
    } as Record<string, string>
  )[status] ?? status;
}

/** 活动任务的种类名（ProjectOverview.activeTask.kind）。 */
export function taskKindLabel(kind: string): string {
  return (
    {
      quick_creation: "AI 快速创作",
      chapter: "单章任务",
      foundation: "AI 引导建书",
    } as Record<string, string>
  )[kind] ?? kind;
}

/** 全站唯一的等待/停止原因文案表：服务端各投影只传机器码，
 *  侧栏、概览、快速创作都从这里渲染。 */
export function stopReasonLabel(reason: string): string {
  return (
    {
      chapter_commit_approval_required: "正文候选等待采纳",
      critical_review_unresolved: "审稿仍有严重问题，需要先修订",
      quality_gate_blocked: "审稿已阻断，需要作者处理",
      semantic_review_blocked: "审稿已阻断，需要作者处理",
      revision_limit_reached: "自动修订次数已用完，需要作者处理",
      scene_plan_approval_required: "本章细纲等待确认",
      settlement_conflict_requires_resolution: "故事变化存在冲突，等待裁定",
      request_start_timeout: "模型首响应超时，可以重试",
      session_cancelled: "快速创作已经取消",
      "child.fatal": "模型调用中断，请修复默认模型后选择恢复方式",
      awaiting_user: "等待作者裁决",
    } as Record<string, string>
  )[reason] ?? reason;
}

/** 项目概览 suggested 下一步（ProjectOverview.nextAction.kind）。 */
export function nextActionKindLabel(kind: string): string {
  return (
    {
      continue_task: "继续未完成的任务",
      review_foundation: "裁定建书候选",
      resolve_story_changes: "裁定故事变化",
      review_writing: "处理审稿与修订",
      write_chapter: "写下一章",
      build_outline: "先搭大纲",
      complete: "全书已定稿",
    } as Record<string, string>
  )[kind] ?? kind;
}
