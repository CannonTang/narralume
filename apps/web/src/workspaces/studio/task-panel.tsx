import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Check, ExternalLink, Pause, Play, RefreshCcw, Sparkles, Square, X } from "lucide-react";
import { useRef, useState } from "react";
import { Link, Navigate } from "react-router";

import { ConfirmDialog } from "../../components/confirm-dialog";
import { ErrorNote } from "../../components/error-note";
import { Skeleton } from "../../components/skeleton";
import {
  controlRun,
  getRunDetail,
  type RunActionRequest,
} from "../../lib/api";
import { runStatusShortLabel, taskActionLabel } from "../../lib/labels";
import { projectWorkspacePath } from "../../lib/project-route";
import { rememberTask } from "../../lib/task-ledger";

const TERMINAL_STATUSES = new Set(["failed", "cancelled", "completed"]);

interface WritingTaskPanelProps {
  projectId: string;
  runId: string;
  onRunChange: (runId: string) => void;
  onDismiss: () => void;
  onAccepted: () => void;
  onRefreshDocument: () => void;
}

export function WritingTaskPanel({ projectId, runId, onRunChange, onDismiss, onAccepted, onRefreshDocument }: WritingTaskPanelProps) {
  const queryClient = useQueryClient();
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionInstruction, setRevisionInstruction] = useState("");
  const [confirmAction, setConfirmAction] = useState<"cancel" | "discard_manuscript" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const revisionRequestIdRef = useRef<string | null>(null);
  const query = useQuery({
    queryKey: ["run", runId],
    queryFn: ({ signal }) => getRunDetail(projectId, runId, signal),
    refetchInterval: (state) => state.state.data && !TERMINAL_STATUSES.has(state.state.data.run.status) ? 1_500 : false,
  });
  const mutation = useMutation({
    mutationFn: (request: RunActionRequest) => controlRun(projectId, runId, request),
    onSuccess: (value, request) => {
      if (request.action === "request_revision") {
        revisionRequestIdRef.current = null;
        setRevisionInstruction("");
        setRevisionOpen(false);
      }
      setConfirmAction(null);
      setNotice(actionNotice(request.action));
      const nextRunId = nestedRunId(value);
      if (nextRunId && nextRunId !== runId) onRunChange(nextRunId);
      if (request.action === "accept_manuscript") onAccepted();
      void queryClient.invalidateQueries({ queryKey: ["run", runId] });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "overview"] });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "runs"] });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "review"] });
      onRefreshDocument();
    },
  });
  const retryMutation = useMutation({
    mutationFn: () =>
      controlRun(projectId, runId, {
        action: "retry_chapter",
        requestId: crypto.randomUUID(),
      }),
    onSuccess: (created) => {
      const nextRunId = nestedRunId(created);
      if (!nextRunId) return;
      rememberTask({
        projectId,
        kind: "chapter",
        taskId: nextRunId,
        label: "重试本章写作",
        createdAt: new Date().toISOString(),
        origin: { surface: "writing" },
      });
      onRunChange(nextRunId);
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "runs"] });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "overview"] });
      onRefreshDocument();
    },
  });

  if (query.isPending) return <section className="studio__task" aria-label="AI 写作任务"><Skeleton lines={5} /></section>;
  if (query.isError) return <section className="studio__task" aria-label="AI 写作任务"><ErrorNote error={query.error} title="写作任务暂时无法加载" /><Link className="studio__task-evidence" to={`${projectWorkspacePath(projectId, "runs")}?run=${encodeURIComponent(runId)}`}>查看任务详情 <ExternalLink size={12} /></Link></section>;
  if (!query.data) return null;

  const detail = query.data;
  if (detail.run.recipe === "book-foundation") {
    return <Navigate replace to={`${projectWorkspacePath(projectId, "autopilot")}?foundation=${encodeURIComponent(runId)}`} />;
  }
  if (detail.run.recipe !== "chapter-production") {
    return <Navigate replace to={`${projectWorkspacePath(projectId, "runs")}?run=${encodeURIComponent(runId)}`} />;
  }
  const actions = new Set(detail.availableActions);
  const manuscript = stringValue(detail.result.manuscriptCandidate, "content");
  const planGoal = stringValue(detail.result.planCandidate, "chapterGoal");
  const reviewSummary = stringValue(detail.result.reviewSummary, "summary");
  const reviewVerdict = stringValue(detail.result.reviewSummary, "verdict");
  const issues = recordArray(detail.result.reviewSummary, "issues");
  const waitingForRetry = detail.run.status === "failed_recoverable";
  const failed = detail.run.status === "failed";
  const failedStep = [...(detail.steps ?? [])].reverse().find((step) => step.status === "failed");
  const failedMessage = failedStep?.error
    ? `${failedStep.error.code} · ${failedStep.error.message}`
    : null;
  const canRetry = actions.has("retry_chapter") && detail.parentTask === null;
  const showProgress = !manuscript && !planGoal && !waitingForRetry && !TERMINAL_STATUSES.has(detail.run.status);
  const submitRevision = () => mutation.mutate({
    action: "request_revision",
    requestId: revisionRequestIdRef.current ??= crypto.randomUUID(),
    instruction: revisionInstruction.trim() || "请在保持既有优点的前提下，重新修订并提升这一版正文。",
  });

  return <section className="studio__task" aria-label="AI 写作任务" id="writing-task">
    <header className="studio__task-head">
      <div><p className="mono">AI 候选稿</p><h2>{runStatusShortLabel(detail.run.status)}</h2></div>
      <button type="button" className="studio__task-close" aria-label="收起 AI 任务" onClick={onDismiss}><X size={15} /></button>
    </header>

    {waitingForRetry ? <div className="studio__task-progress"><Sparkles size={16} /><div><strong>等待自动重试</strong><p>本次调用暂时失败，后台会按原任务继续；不需要重复提交。</p></div></div> : null}
    {showProgress ? <div className="studio__task-progress"><Sparkles size={16} /><div><strong>AI 正在完成本章</strong><p>可以离开此页；返回后会继续显示同一任务和正式产物。</p></div></div> : null}
    {failed ? (
      <div className="studio__task-progress" data-tone="failed">
        <CircleAlert size={16} />
        <div>
          <strong>本章生成失败</strong>
          <p>{failedMessage ?? "模型调用在多次自动重试后仍失败。"}</p>
          <div className="studio__task-retry">
            {canRetry ? <button type="button" className="btn btn--primary" disabled={retryMutation.isPending} onClick={() => retryMutation.mutate()}><RefreshCcw size={13} />{retryMutation.isPending ? "正在重试…" : "重试本章"}</button> : detail.parentTask?.kind === "autopilot" ? <Link className="btn btn--primary" to={`${projectWorkspacePath(projectId, "autopilot")}?session=${encodeURIComponent(detail.parentTask.id)}`}>返回快速创作任务</Link> : null}
          </div>
          {retryMutation.isError ? <ErrorNote error={retryMutation.error} title="重试没有开始" /> : null}
        </div>
      </div>
    ) : null}

    {planGoal ? <article className="studio__task-note"><span className="mono">本章计划</span><p>{planGoal}</p></article> : null}

    {manuscript ? <article className="studio__candidate" aria-label="待采纳正文">
      <header><span className="mono">待采纳正文</span><strong>{[...manuscript].length} 字</strong></header>
      <div className="studio__candidate-body">{manuscript}</div>
    </article> : null}

    {reviewSummary ? <article className="studio__task-review" aria-label="审稿结果">
      <header><span className="mono">本次审稿</span>{reviewVerdict ? <strong>{reviewVerdictLabel(reviewVerdict)}</strong> : null}</header>
      <p>{reviewSummary}</p>
      {issues.length > 0 ? <ul>{issues.map((issue, index) => <li key={stringValue(issue, "id") ?? index}><strong>{stringValue(issue, "message") ?? "需要复核"}</strong>{stringValue(issue, "suggestedDirection") ? <span>{stringValue(issue, "suggestedDirection")}</span> : null}</li>)}</ul> : null}
    </article> : null}

    {detail.result.settlementCandidate ? <p className="studio__task-settlement">这版正文带来新的故事变化；采纳正文后，再在写作台确认无冲突的设定结算。</p> : null}

    <div className="studio__task-actions">
      {actions.has("accept_plan") ? <button type="button" className="btn btn--primary" disabled={mutation.isPending} onClick={() => mutation.mutate({ action: "accept_plan" })}><Check size={13} />{taskActionLabel("accept_plan")}</button> : null}
      {actions.has("accept_manuscript") ? <button type="button" className="btn btn--primary" disabled={mutation.isPending} onClick={() => mutation.mutate({ action: "accept_manuscript" })}><Check size={13} />采纳为正文版本</button> : null}
      {actions.has("request_revision") ? <button type="button" className="btn" disabled={mutation.isPending} onClick={() => setRevisionOpen((value) => !value)}><RefreshCcw size={13} />要求再改</button> : null}
      {actions.has("switch_to_manual") ? <button type="button" className="btn" disabled={mutation.isPending} onClick={() => mutation.mutate({ action: "switch_to_manual" })}>{taskActionLabel("switch_to_manual")}</button> : null}
      {actions.has("pause") ? <button type="button" className="btn" disabled={mutation.isPending} onClick={() => mutation.mutate({ action: "pause" })}><Pause size={13} />暂停</button> : null}
      {actions.has("resume") ? <button type="button" className="btn" disabled={mutation.isPending} onClick={() => mutation.mutate({ action: "resume" })}><Play size={13} />继续</button> : null}
      {actions.has("discard_manuscript") ? <button type="button" className="btn" disabled={mutation.isPending} onClick={() => setConfirmAction("discard_manuscript")}>丢弃候选</button> : null}
      {actions.has("cancel") ? <button type="button" className="btn" disabled={mutation.isPending} onClick={() => setConfirmAction("cancel")}><Square size={13} />取消任务</button> : null}
    </div>

    {revisionOpen ? <div className="studio__task-revision"><label>告诉 AI 这次要怎么改<textarea rows={3} value={revisionInstruction} onChange={(event) => setRevisionInstruction(event.target.value)} placeholder="例如：保留开头的克制感，把中段冲突提前，并删去解释性对白。" /></label><button type="button" className="btn btn--primary" disabled={mutation.isPending} onClick={submitRevision}>提交修订要求</button></div> : null}
    {detail.result.partialRecovery ? <p className="studio__task-settlement">生成被中断，已有 {detail.result.partialRecovery.characters} 字可恢复。请打开任务详情，选择取用残稿或重新生成。</p> : null}
    {mutation.isError ? <ErrorNote error={mutation.error} title="任务操作没有完成" /> : null}
    {notice ? <p className="studio__saved-note" role="status">{notice}</p> : null}
    <Link className="studio__task-evidence" to={`${projectWorkspacePath(projectId, "runs")}?run=${encodeURIComponent(runId)}`}>查看任务详情 <ExternalLink size={12} /></Link>

    {confirmAction ? <ConfirmDialog title={confirmAction === "cancel" ? "取消这次 AI 任务" : "丢弃这版候选正文"} confirmLabel={confirmAction === "cancel" ? "确认取消" : "确认丢弃"} danger pending={mutation.isPending} onCancel={() => setConfirmAction(null)} onConfirm={() => mutation.mutate({ action: confirmAction })}><p>{confirmAction === "cancel" ? "已经形成的草稿和版本不会被删除，但尚未完成的步骤会停止。" : "这只丢弃 AI 候选，不会删除你当前正在编辑的正文。"}</p></ConfirmDialog> : null}
  </section>;
}

function nestedRunId(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.run)) return null;
  return typeof value.run.id === "string" ? value.run.id : null;
}

function stringValue(value: unknown, key: string): string | null {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : null;
}

function recordArray(value: unknown, key: string): Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value[key])) return [];
  return value[key].filter(isRecord);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function reviewVerdictLabel(verdict: string): string {
  return ({ pass: "通过", revise: "建议修订", block: "需要裁定" } as Record<string, string>)[verdict] ?? verdict;
}

function actionNotice(action: RunActionRequest["action"]): string {
  return ({
    accept_plan: "本章计划已确认，AI 会继续完成正文。",
    accept_manuscript: "候选正文已采纳，正在刷新正式版本。",
    request_revision: "修订要求已提交，新的候选稿会回到这里。",
    discard_manuscript: "这版候选正文已丢弃。",
    switch_to_manual: "已转为手动创作。",
    pause: "任务会停在下一个安全边界。",
    resume: "任务已继续。",
    cancel: "任务已取消。",
  } as Record<string, string>)[action] ?? "操作已提交。";
}
