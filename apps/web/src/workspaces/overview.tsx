import "../styles/overview.css";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { ConfirmDialog } from "../components/confirm-dialog";
import { ErrorNote } from "../components/error-note";
import { ProjectRequiredState } from "../components/project-required-state";
import { Skeleton } from "../components/skeleton";
import {
  controlAutopilotSession,
  controlRun,
  getProjectOverview,
  resolveAutopilotFailure,
  type ProjectOverview,
  type ProjectOverviewActiveTask,
  type RunActionRequest,
  type SessionActionRequest,
} from "../lib/api";
import { formatRelativeDate } from "../lib/fmt";
import {
  nextActionKindLabel,
  outlineStatusLabel,
  projectPhaseLabel,
  stopReasonLabel,
  taskActionLabel,
  taskKindLabel,
  taskStatusLabel,
} from "../lib/labels";
import { projectWorkspacePath, useProjectId } from "../lib/project-route";
import {
  reconcileTasks,
  rememberTask,
  rememberedTasks,
  taskHref,
} from "../lib/task-ledger";

/* 项目概览：进入作品后的默认页面。数据源是服务端 overview 聚合：
   进度、当前章节、活动任务（origin / stopReason / availableActions）、
   待办计数与下一步。任务内部 Step 不在此解析；恢复走任务台账与深度链接。 */

export function OverviewWorkspace() {
  const projectId = useProjectId();
  const overviewQuery = useQuery({
    queryKey: ["project", projectId, "overview"],
    queryFn: ({ signal }) => getProjectOverview(projectId!, signal),
    enabled: Boolean(projectId),
    refetchInterval: (query) =>
      query.state.data?.activeTask ? 3_000 : false,
  });
  const overview = overviewQuery.data ?? null;

  /* 离页恢复对账：服务端真相是唯一权威；活跃任务收进台账，失踪任务清掉。 */
  useEffect(() => {
    if (!projectId || !overviewQuery.data) return;
    const active = overviewQuery.data.activeTask;
    if (active) {
      rememberTask({
        projectId,
        kind: active.kind,
        taskId: active.id,
        label: active.targetChapter?.title ?? taskKindLabel(active.kind),
        createdAt: new Date().toISOString(),
        origin: active.origin,
        documentId: active.targetChapter?.documentId ?? null,
      });
    }
    reconcileTasks(
      projectId,
      active ? [active.id] : [],
    );
  }, [projectId, overviewQuery.data]);

  if (!projectId) {
    return (
      <div className="overview">
        <ProjectRequiredState
          seal="览"
          title="项目概览"
          description="选定作品后，在这里查看创作进度、进行中的任务和下一步安排。"
        />
      </div>
    );
  }

  return (
    <div className="overview">
      {overviewQuery.isPending ? (
        <Skeleton lines={7} />
      ) : overviewQuery.isError ? (
        <ErrorNote error={overviewQuery.error} title="概览暂时无法加载" />
      ) : overview ? (
        <OverviewBoard overview={overview} />
      ) : null}
    </div>
  );
}

function OverviewBoard({ overview }: { overview: ProjectOverview }) {
  const { progress, currentChapter, activeTask, pending, nextAction } = overview;
  const nextEntry = nextActionEntry(overview);
  return (
    <main className="overview__board">
      <header className="overview__masthead">
        <h1 className="overview__masthead-title">{overview.project.title}</h1>
        <p className="overview__masthead-premise">{overview.project.premise ?? "卷首尚待题。"}</p>
        <div className="overview__masthead-row mono">
          <span className="overview__masthead-index">OVERLOOK · 02</span>
          <span className="overview__masthead-phase">{projectPhaseLabel(overview.project.phase)}</span>
          <span className="overview__masthead-progress">{progress.committedChapters} 已定稿 · 共 {progress.totalChapters} 章节 · {progress.wordCount} 字</span>
          <span className="overview__masthead-writingat">
            {progress.lastWritingAt ? `最后动笔 ${formatRelativeDate(progress.lastWritingAt)}` : "尚未动笔"}
          </span>
        </div>
      </header>

      {/* 按任务 id 重挂载：轮询切到别的任务时，取消确认与 mutation 状态不跨任务残留。 */}
      {activeTask ? <ActiveTaskCard key={activeTask.id} projectId={overview.project.id} task={activeTask} /> : null}

      {!activeTask && currentChapter ? (
        <section className="overview__current">
          <h2 className="overview__current-head">当前章节</h2>
          <article className="overview__chapter-card">
            <strong className="overview__chapter-title">{currentChapter.title}</strong>
            <span className="overview__chapter-status mono">{outlineStatusLabel(currentChapter.status)}</span>
            <div className="overview__chapter-actions">
              <Link to={chapterWritingHref(overview.project.id, currentChapter)} className="btn btn--primary" aria-label="在写作台续写此章">续写本章</Link>
              <Link to={projectWorkspacePath(overview.project.id, "bible")} className="btn" aria-label="查看故事">查看故事</Link>
            </div>
          </article>
        </section>
      ) : null}

      {!activeTask && !currentChapter ? (
        <section className="overview__current">
          <h2 className="overview__current-head">当前章节</h2>
          <p className="overview__current-done">{completedChapterMessage(overview)}</p>
        </section>
      ) : null}

      <PendingStrip projectId={overview.project.id} pending={pending} activeTask={activeTask} />

      <section className="overview__entries" aria-label="下一步入口">
        <h3 className="overview__entries-head mono">NEXT · {nextActionKindLabel(nextAction.kind)}</h3>
        {EntryCard(nextEntry.label, nextEntry.href, nextEntry.blurb, true)}
        {nextEntry.href !== projectWorkspacePath(overview.project.id, "bible") ? EntryCard("整理故事", projectWorkspacePath(overview.project.id, "bible"), "补齐人物、大纲和故事事实") : null}
        {nextEntry.href !== projectWorkspacePath(overview.project.id, "autopilot") ? EntryCard("AI 快速创作", projectWorkspacePath(overview.project.id, "autopilot"), "按默认链路连续完成多章，作者可随时介入") : null}
      </section>
    </main>
  );
}

/** 活动任务卡：只展示任务协议字段（kind / status / stopReason / availableActions），
 *  并提供「回到任务现场」的恢复链接；不展开任务内部步骤。 */
function ActiveTaskCard({ projectId, task }: { projectId: string; task: ProjectOverviewActiveTask }) {
  const queryClient = useQueryClient();
  const restore = rememberedTasks(projectId).find((item) => item.taskId === task.id);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const mutation = useMutation<unknown, Error, string>({
    mutationFn: (action: string) => {
      if (task.kind === "quick_creation") {
        if (["retry-current", "skip-chapter", "replan", "stop"].includes(action)) {
          return resolveAutopilotFailure(task.id, action as "retry-current" | "skip-chapter" | "replan" | "stop");
        }
        return controlAutopilotSession(task.id, { action } as SessionActionRequest);
      }
      return controlRun(projectId, task.id, { action } as RunActionRequest);
    },
    onSuccess: () => {
      setConfirmCancel(false);
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "overview"] });
      void queryClient.invalidateQueries({ queryKey: ["run", task.id] });
    },
  });
  const directActions = task.availableActions.filter((action) => ["pause", "resume", "retry-current", "skip-chapter", "replan", "stop"].includes(action));
  const needsProductDecision = task.availableActions.some((action) => ["accept_plan", "accept_manuscript", "request_revision", "discard_manuscript"].includes(action)) || task.stopReason === "settlement_conflict_requires_resolution";
  const href = taskHref(projectId, task.kind, task.id, {
    origin: task.origin,
    documentId: task.targetChapter?.documentId ?? restore?.documentId ?? null,
  });
  return (
    <section className="overview__current" aria-label="活动任务">
      <h2 className="overview__current-head">活动任务 · {taskKindLabel(task.kind)}</h2>
      <article className="overview__chapter-card" data-task={task.kind}>
        <strong className="overview__chapter-title">
          {task.targetChapter?.title ?? restore?.label ?? "后台任务"}
        </strong>
        <span className="overview__chapter-status mono">{taskStatusLabel(task.status)}</span>
        {task.stopReason ? (
          <p className="overview__chapter-goal">{stopReasonLabel(task.stopReason)}</p>
        ) : null}
        <div className="overview__chapter-actions">
          {directActions.map((action) => <button key={action} type="button" className="btn" disabled={mutation.isPending} onClick={() => mutation.mutate(action)}>{action === "pause" ? <Pause size={13} /> : action === "resume" ? <Play size={13} /> : null}{taskActionLabel(action)}</button>)}
          {task.availableActions.includes("cancel") ? <button type="button" className="btn" disabled={mutation.isPending} onClick={() => setConfirmCancel(true)}><Square size={13} />取消</button> : null}
          <Link
            to={href}
            className="btn btn--primary"
            aria-label="回到任务现场"
          >
            {needsProductDecision ? "处理候选与裁定" : "回到任务现场"}
          </Link>
        </div>
        {mutation.isError ? <ErrorNote error={mutation.error} title="任务操作没有完成" /> : null}
      </article>
      {confirmCancel ? <ConfirmDialog title="取消当前任务" confirmLabel="确认取消" danger pending={mutation.isPending} onCancel={() => setConfirmCancel(false)} onConfirm={() => mutation.mutate("cancel")}><p>任务会在安全边界停止；已经保存的正文和版本不会被删除。</p></ConfirmDialog> : null}
    </section>
  );
}

/** 待办汇总：四项计数大于零才显形；各连到裁定位置。 */
function PendingStrip({ projectId, pending, activeTask }: { projectId: string; pending: ProjectOverview["pending"]; activeTask: ProjectOverviewActiveTask | null }) {
  const resumeHint = activeTask === null ? rememberedTasks(projectId)[0] : null;
  const reviewHref = reviewWorkspaceHref(projectId, pending.reviewDocumentId);
  const items = [
    { key: "foundation", count: pending.foundationCandidates, label: "建书候选", href: projectWorkspacePath(projectId, "autopilot") },
    { key: "issues", count: pending.reviewIssues, label: "审稿问题", href: reviewHref },
    { key: "proposals", count: pending.revisionProposals, label: "修订提案", href: reviewHref },
    { key: "canon", count: pending.canonChangeSets, label: "故事变化", href: `${projectWorkspacePath(projectId, "studio")}?focus=canon` },
  ].filter((item) => item.count > 0);
  if (items.length === 0 && !resumeHint) return null;
  return (
    <section className="overview__pending" aria-label="待办">
      {items.map((item) => (
        <Link key={item.key} className="overview__pending-item mono" to={item.href}>
          {item.label} · {item.count}
        </Link>
      ))}
      {resumeHint ? (
        <Link className="overview__pending-item mono" to={taskHref(projectId, resumeHint.kind, resumeHint.taskId, { origin: resumeHint.origin ?? null, documentId: resumeHint.documentId ?? null })}>
          最近的 AI 任务 · {resumeHint.label}
        </Link>
      ) : null}
    </section>
  );
}

function EntryCard(label: string, to: string, blurb: string, primary = false) {
  return (
    <Link className="overview__entry" data-primary={primary} to={to} aria-label={label}>
      <span className="overview__entry-label">{label}</span>
      <span className="overview__entry-blurb mono">{blurb}</span>
    </Link>
  );
}

function chapterWritingHref(projectId: string, chapter: ProjectOverview["currentChapter"]): string {
  const params = new URLSearchParams();
  if (chapter?.documentId) params.set("document", chapter.documentId);
  else if (chapter?.outlineNodeId) params.set("outline", chapter.outlineNodeId);
  const query = params.toString();
  return `${projectWorkspacePath(projectId, "studio")}${query ? `?${query}` : ""}`;
}

function nextActionEntry(overview: ProjectOverview): { label: string; href: string; blurb: string } {
  const projectId = overview.project.id;
  switch (overview.nextAction.kind) {
    case "continue_task": {
      const task = overview.activeTask;
      return task ? {
        label: "继续当前任务",
        href: taskHref(projectId, task.kind, task.id, { origin: task.origin, documentId: task.targetChapter?.documentId ?? null }),
        blurb: "回到发起位置，处理候选稿或继续创作",
      } : { label: "回到写作台", href: projectWorkspacePath(projectId, "studio"), blurb: "继续当前正文" };
    }
    case "review_foundation":
      return { label: "确认作品方向", href: projectWorkspacePath(projectId, "autopilot"), blurb: "从建书候选中确定故事指南针" };
    case "resolve_story_changes":
      return { label: "确认故事变化", href: `${projectWorkspacePath(projectId, "studio")}?focus=canon`, blurb: "裁定正文带来的人物、时间线与伏笔变化" };
    case "review_writing":
      return { label: "处理审稿与修订", href: reviewWorkspaceHref(projectId, overview.pending.reviewDocumentId), blurb: "在正文旁完成问题和修改建议的裁定" };
    case "write_chapter":
      return { label: "续写本章", href: chapterWritingHref(projectId, overview.currentChapter), blurb: "手动写作，或把本章交给 AI 生成待采纳正文" };
    case "build_outline":
      return { label: "先搭故事大纲", href: projectWorkspacePath(projectId, "bible"), blurb: "确定人物、章节与故事推进方向" };
    case "complete":
      return { label: "检查并交付", href: projectWorkspacePath(projectId, "delivery"), blurb: "检查质量后导出或备份作品" };
  }
}

function reviewWorkspaceHref(projectId: string, documentId: string | null | undefined): string {
  const params = new URLSearchParams({ focus: "review" });
  if (documentId) params.set("document", documentId);
  return `${projectWorkspacePath(projectId, "studio")}?${params}`;
}

function completedChapterMessage(overview: ProjectOverview): string {
  if (overview.progress.totalChapters === 0) {
    return "还没有章节；下一步：先搭故事大纲。";
  }
  switch (overview.nextAction.kind) {
    case "review_foundation":
      return "没有正在撰写的章节；下一步：确认作品方向。";
    case "resolve_story_changes":
      return "章节正文已定稿；下一步：确认正文带来的故事变化。";
    case "review_writing":
      return "章节正文已定稿；下一步：处理审稿与修订。";
    case "build_outline":
      return "还没有可写章节；下一步：先搭故事大纲。";
    case "complete":
      return "所有章节已定稿；下一步：检查并交付。";
    default:
      return `没有正在撰写的章节；下一步：${nextActionKindLabel(overview.nextAction.kind)}。`;
  }
}
