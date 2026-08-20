import "../styles/runs.css";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Pause, Play, RotateCcw, Square } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { ConfirmDialog } from "../components/confirm-dialog";
import { Empty } from "../components/empty";
import { ErrorNote } from "../components/error-note";
import { PageBand } from "../components/page-band";
import { ProjectRequiredState } from "../components/project-required-state";
import { Skeleton } from "../components/skeleton";
import {
  MIN_VIABLE_PARTIAL_CHARACTERS,
  adoptRunStream,
  continueRunStream,
  controlRun,
  discardRunStream,
  getProjectRuns,
  getRunDetail,
  regenerateRunStream,
  type NarrativeRun,
  type RunDetail,
} from "../lib/api";
import { runStatusShortLabel, taskActionLabel } from "../lib/labels";
import { projectWorkspacePath, useProjectId } from "../lib/project-route";
import { useRunLiveText, useServerEvents } from "../lib/sse";

const TERMINAL = new Set(["failed", "cancelled", "completed"]);

export function RunsWorkspace() {
  const projectId = useProjectId();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedRunId = searchParams.get("run");
  const runsQuery = useQuery({
    queryKey: ["project", projectId, "runs"],
    queryFn: ({ signal }) => getProjectRuns(projectId!, signal),
    enabled: Boolean(projectId),
    refetchInterval: (query) => query.state.data?.some((run) => !TERMINAL.has(run.status)) ? 1_250 : false,
  });
  const detailQuery = useQuery({
    queryKey: ["run", selectedRunId],
    queryFn: ({ signal }) => getRunDetail(projectId!, selectedRunId!, signal),
    enabled: Boolean(projectId && selectedRunId),
    refetchInterval: (query) => query.state.data && !TERMINAL.has(query.state.data.run.status) ? 1_500 : false,
  });
  const persistedStreamSignal = detailQuery.data?.streams.length
    ? detailQuery.data.streams
        .map((stream) => `${stream.stepId}:${stream.attempt}:${stream.updatedAt}`)
        .join("|")
    : detailQuery.data && TERMINAL.has(detailQuery.data.run.status)
      ? `terminal:${detailQuery.data.run.status}:${detailQuery.data.run.updatedAt}`
      : null;
  const liveText = useRunLiveText(selectedRunId, persistedStreamSignal);
  useServerEvents({
    onRunStatus: (runId) => {
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "runs"] });
      if (runId === selectedRunId) void queryClient.invalidateQueries({ queryKey: ["run", runId] });
    },
    onRunEvent: (runId) => {
      if (runId === selectedRunId) void queryClient.invalidateQueries({ queryKey: ["run", runId] });
    },
  });

  const grouped = useMemo(() => {
    const groups = new Map<string, NarrativeRun[]>();
    for (const run of runsQuery.data ?? []) {
      const key = run.createdAt.slice(0, 7);
      groups.set(key, [...(groups.get(key) ?? []), run]);
    }
    for (const list of groups.values()) list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [runsQuery.data]);
  const [requestedIssue, setSelectedIssue] = useState<string | null>(null);
  const selectedIssue = grouped.some(([issue]) => issue === requestedIssue)
    ? requestedIssue
    : grouped[0]?.[0] ?? null;

  if (!projectId) return <MissingProject />;
  const current = grouped.find(([issue]) => issue === selectedIssue) ?? null;
  const selectRun = (runId: string) => setSearchParams({ run: runId }, { replace: false });

  return <div className="runs">
    <PageBand index="LEDGER · L1" title="运行中心" meta={<span className="mono">{runsQuery.data?.length ?? 0} 次运行 / {grouped.length} 期</span>} />
    <div className="runs__layout">
      <aside className="runs__volumes" aria-label="期号档案"><header className="runs__volumes-head"><p className="runs__volumes-title">卷期目录</p><span className="runs__volumes-count">{grouped.length} 期</span></header><div className="runs__volumes-list">
        {grouped.length === 0 ? <p className="runs__empty-guide">还没有运行记录；从故事圣经的大纲生成一章。</p> : grouped.map(([issue, list]) => <button key={issue} type="button" className="runs__volume" data-active={issue === selectedIssue} onClick={() => setSelectedIssue(issue)}><span className="runs__volume-no mono">ISSUE NO. {issue.replace("-", "")}</span><span className="runs__volume-title">{issue} 月刊 · {list.length} 条运行</span><span className="runs__volume-sub">{list[0]!.createdAt.slice(0, 16)}</span></button>)}
      </div></aside>
      <article className="runs__sheet" aria-label="当期档案">
        {runsQuery.isPending ? <div className="runs__pad"><Skeleton lines={8} /></div> : runsQuery.isError ? <div className="runs__pad"><ErrorNote error={runsQuery.error} title="任务记录暂时无法加载" /></div> : !current ? <Empty title="尚无档案" /> : <>
          <header className="runs__sheet-head"><span className="runs__sheet-kicker mono">本卷 · {current[0]}</span><h2 className="runs__sheet-title">ISSUE NO.{current[0].replace("-", "")}</h2><span className="runs__sheet-sub mono">{current[1].length} 条</span></header>
          <div className="runs__sheet-meta"><span>完成 {countStatus(current[1], "completed")} · 失败 {countStatus(current[1], "failed")} · 等待重试 {countStatus(current[1], "failed_recoverable")} · 运行中 {countStatus(current[1], "running")}</span></div>
          <div className="runs__rows">{current[1].map((run, index) => <button key={run.id} type="button" className="runs__row runs__row--button" data-active={run.id === selectedRunId} onClick={() => selectRun(run.id)}><span className="runs__row-seq mono">{String(index + 1).padStart(2, "0")}</span><span className="runs__row-title">{run.recipe}<small>修订 {run.revisionCycle} 轮</small></span><span className="runs__row-status" data-s={run.status}>{runStatusShortLabel(run.status)}</span><span className="runs__row-budget mono" title="包含自动重试">模型调用 {run.budgetUsage.calls} 次 · {run.id.slice(0, 6)}</span><ChevronRight size={14} /></button>)}</div>
        </>}
      </article>
    </div>
    {selectedRunId ? <RunDetailPanel projectId={projectId} detail={detailQuery.data} liveText={liveText} pending={detailQuery.isPending} error={detailQuery.error} onSelectRun={selectRun} /> : <p className="runs__select-hint">选择一条运行查看持久化正文、策略、收据、模型快照与调用账本。</p>}
  </div>;
}

function RunDetailPanel({ projectId, detail, liveText, pending, error, onSelectRun }: { projectId: string; detail: RunDetail | undefined; liveText: string; pending: boolean; error: unknown; onSelectRun: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (work: () => Promise<unknown>) => work(),
    onSuccess: (value) => {
      setConfirmCancel(false);
      setNotice("操作已提交，详情正在从服务端刷新。");
      if (value && typeof value === "object" && "run" in value) {
        const run = (value as { run?: { id?: string } }).run;
        if (run?.id && run.id !== detail?.run.id) onSelectRun(run.id);
      }
      void queryClient.invalidateQueries({ queryKey: ["run", detail?.run.id] });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "runs"] });
    },
  });
  if (pending) return <section className="run-detail"><Skeleton lines={10} /></section>;
  if (error) return <section className="run-detail"><ErrorNote error={error} title="任务详情暂时无法加载" /></section>;
  if (!detail) return null;
  const { run } = detail;
  const completedSteps = detail.steps.filter((step) => ["succeeded", "skipped"].includes(step.status)).length;
  const act = (work: () => Promise<unknown>) => { setNotice(null); mutation.mutate(work); };
  /* 按钮完全由服务端 availableActions 驱动；未知动作不再猜测。 */
  const can = new Set(detail.availableActions);
  /* 与 harness 路由同式：有效尝试上限 = min(配方 maxAttempts, 策略 maxRetries + 1)。 */
  const policyMaxRetries = detail.effectivePolicy?.maxRetries ?? policyRetryNumber(run.policy.maxRetries);
  const attemptCap = (step: RunDetail["steps"][number]) =>
    policyMaxRetries === null ? step.maxAttempts : Math.min(step.maxAttempts, policyMaxRetries + 1);
  return <section className="run-detail" aria-label={`运行详情 ${run.id}`}>
    <header className="run-detail__head"><div><p className="mono">RUN {run.id}</p><h2>{run.recipe}</h2></div><span className="runs__row-status" data-s={run.status}>{runStatusShortLabel(run.status)}</span></header>
    <div className="run-detail__controls">
      {can.has("pause") ? <button type="button" className="btn" disabled={mutation.isPending} onClick={() => act(() => controlRun(projectId, run.id, { action: "pause" }))}><Pause size={13} />{taskActionLabel("pause")}</button> : null}
      {can.has("resume") ? <button type="button" className="btn" disabled={mutation.isPending} onClick={() => act(() => controlRun(projectId, run.id, { action: "resume" }))}><Play size={13} />{taskActionLabel("resume")}</button> : null}
      {can.has("accept_plan") ? <button type="button" className="btn btn--primary" disabled={mutation.isPending} onClick={() => act(() => controlRun(projectId, run.id, { action: "accept_plan" }))}>{taskActionLabel("accept_plan")}</button> : null}
      {can.has("accept_manuscript") ? <button type="button" className="btn btn--primary" disabled={mutation.isPending} onClick={() => act(() => controlRun(projectId, run.id, { action: "accept_manuscript" }))}>{taskActionLabel("accept_manuscript")}</button> : null}
      {can.has("discard_manuscript") ? <button type="button" className="btn" disabled={mutation.isPending} onClick={() => act(() => controlRun(projectId, run.id, { action: "discard_manuscript" }))}>{taskActionLabel("discard_manuscript")}</button> : null}
      {run.status === "awaiting_user" && detail.result.canonChangeSetId ? <Link className="btn btn--primary" to={projectWorkspacePath(projectId, "studio")}>处理故事变化</Link> : null}
      {can.has("switch_to_manual") ? <button type="button" className="btn" disabled={mutation.isPending} onClick={() => act(() => controlRun(projectId, run.id, { action: "switch_to_manual" }))}>{taskActionLabel("switch_to_manual")}</button> : null}
      {can.has("retry_chapter") ? <button type="button" className="btn btn--primary" disabled={mutation.isPending} onClick={() => act(() => controlRun(projectId, run.id, { action: "retry_chapter", requestId: crypto.randomUUID() }))}><RotateCcw size={13} />{taskActionLabel("retry_chapter")}</button> : null}
      {detail.parentTask?.kind === "autopilot" ? <Link className="btn btn--primary" to={`${projectWorkspacePath(projectId, "autopilot")}?session=${encodeURIComponent(detail.parentTask.id)}`}>返回快速创作任务</Link> : null}
      {can.has("cancel") ? <button type="button" className="btn" disabled={mutation.isPending} onClick={() => setConfirmCancel(true)}><Square size={13} />{taskActionLabel("cancel")}</button> : null}
    </div>
    {can.has("request_revision") ? <RevisionRequest pending={mutation.isPending} onSubmit={(requestId, instruction) => act(() => controlRun(projectId, run.id, { action: "request_revision", requestId, instruction }))} /> : null}
    {mutation.isError ? <ErrorNote error={mutation.error} title="运行操作未完成" /> : null}{notice ? <p className="run-detail__notice" role="status">{notice}</p> : null}
    <div className="run-detail__summary"><span>流程 {completedSteps}/{detail.steps.length}</span><span title="包含自动重试">模型调用 {run.budgetUsage.calls} 次</span><span>输入 {run.budgetUsage.inputTokens} tokens</span><span>输出 {run.budgetUsage.outputTokens} tokens</span><span>模型耗时 {Math.round(run.budgetUsage.wallTimeMs / 1000)}s</span></div>
    <DetailBlock title="正文流"><div className="run-detail__streams">{detail.streams.length === 0 && !liveText ? <p>尚无正文流。</p> : detail.streams.map((stream) => <StreamCard key={`${stream.stepId}:${stream.attempt}`} projectId={projectId} runId={run.id} stream={stream} pending={mutation.isPending} can={can} onAction={act} />)}{liveText ? <article className="run-detail__stream" data-status="streaming"><header>实时增量 · 尚未持久化</header><pre>{liveText}</pre></article> : null}</div></DetailBlock>
    <DetailBlock title="步骤与错误"><div className="run-detail__timeline">{detail.steps.map((step) => <article key={step.id}><strong>{step.ordinal + 1}. {step.kind}</strong><span>{step.status} · 尝试 {step.attempt}/{attemptCap(step)}</span>{step.error ? <p>{step.error.code} · {step.error.message}</p> : null}</article>)}</div></DetailBlock>
    <DetailBlock title="事件、检查点与审稿"><JsonView value={{ events: detail.events, latestCheckpoint: detail.latestCheckpoint, reviews: detail.reviews }} /></DetailBlock>
    <DetailBlock title="有效执行策略"><JsonView value={detail.effectivePolicy ?? run.policy} /></DetailBlock>
    <DetailBlock title={`上下文收据 ${detail.contextReceipts.length}`}><JsonView value={detail.contextReceipts} /></DetailBlock>
    <DetailBlock title={`模型快照 ${detail.modelSnapshots.length}`}><JsonView value={detail.modelSnapshots} /></DetailBlock>
    <DetailBlock title={`调用账本 ${detail.llmCalls.length}`}><div className="run-detail__calls">{detail.llmCalls.length === 0 ? <p>尚无调用。</p> : detail.llmCalls.map((call) => <article key={call.id}><strong>{call.purpose} · {call.model}</strong><span>{call.protocol} · {call.status} · {call.finishReason ?? "—"}</span><span>TTFT {call.ttftMs ?? "—"}ms · 总耗时 {call.durationMs ?? "—"}ms · tokens {call.usage?.totalTokens ?? "—"}</span>{call.error ? <JsonView value={call.error} /> : null}</article>)}</div></DetailBlock>
    {confirmCancel ? <ConfirmDialog title="取消运行" confirmLabel="确认取消" danger pending={mutation.isPending} onCancel={() => setConfirmCancel(false)} onConfirm={() => act(() => controlRun(projectId, run.id, { action: "cancel" }))}><p>取消会终止尚未完成的步骤；已经持久化的 partial 正文仍保留在详情中供恢复。</p></ConfirmDialog> : null}
  </section>;
}

/** 请求修订：带修订指示提交。每次点提交生成一个新 requestId（= 一次新提交）；
 *  同一 requestId 的网络重试由服务端幂等去重。 */
function RevisionRequest({ pending, onSubmit }: { pending: boolean; onSubmit: (requestId: string, instruction: string) => void }) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const requestIdRef = useRef<string | null>(null);
  if (!open) {
    return <div className="run-detail__controls"><button type="button" className="btn" disabled={pending} onClick={() => setOpen(true)}>{taskActionLabel("request_revision")}</button></div>;
  }
  return (
    <div className="run-detail__revision">
      <textarea
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
        placeholder="写给修订模型的指示；留空则使用默认修订指令。"
        aria-label="修订指示"
        rows={3}
      />
      <div className="run-detail__controls">
        <button type="button" className="btn btn--primary" disabled={pending} onClick={() => onSubmit(requestIdRef.current ??= crypto.randomUUID(), instruction.trim() || "请在保持既有优点的前提下，重新修订并提升这一版正文。")}>{taskActionLabel("request_revision")}</button>
        <button type="button" className="btn" disabled={pending} onClick={() => setOpen(false)}>收起</button>
      </div>
    </div>
  );
}

function StreamCard({ projectId, runId, stream, pending, can, onAction }: { projectId: string; runId: string; stream: RunDetail["streams"][number]; pending: boolean; can: Set<string>; onAction: (work: () => Promise<unknown>) => void }) {
  const viable = stream.content.length >= MIN_VIABLE_PARTIAL_CHARACTERS;
  return <article className="run-detail__stream" data-status={stream.status}><header><span>{stream.status} · 尝试 {stream.attempt}</span><span>{stream.content.length} 字</span></header><pre>{stream.content}</pre>{stream.status === "interrupted" ? <div className="run-detail__stream-actions"><button type="button" className="btn" disabled={pending || !viable} title={!viable ? `少于 ${MIN_VIABLE_PARTIAL_CHARACTERS} 字，不能续写或采纳` : undefined} onClick={() => onAction(() => continueRunStream(projectId, runId, { stepId: stream.stepId, attempt: stream.attempt }))}>续写</button><button type="button" className="btn btn--primary" disabled={pending || !viable || !can.has("use_partial")} onClick={() => onAction(() => adoptRunStream(projectId, runId, { stepId: stream.stepId, attempt: stream.attempt }))}>{taskActionLabel("use_partial")}</button><button type="button" className="btn" disabled={pending || !can.has("regenerate")} onClick={() => onAction(() => regenerateRunStream(projectId, runId, { stepId: stream.stepId, attempt: stream.attempt }))}><RotateCcw size={11} />{taskActionLabel("regenerate")}</button><button type="button" className="btn" disabled={pending} onClick={() => onAction(() => discardRunStream(projectId, runId, stream.stepId, stream.attempt))}>丢弃</button></div> : null}{!viable && stream.status === "interrupted" ? <p className="run-detail__warning">partial 少于 {MIN_VIABLE_PARTIAL_CHARACTERS} 字，只能丢弃或重生成。</p> : null}</article>;
}

function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) { return <details className="run-detail__block" open><summary>{title}</summary><div>{children}</div></details>; }
function JsonView({ value }: { value: unknown }) { return <pre className="run-detail__json">{JSON.stringify(value, null, 2)}</pre>; }
function policyRetryNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}
function MissingProject() {
  return (
    <div className="runs">
      <ProjectRequiredState
        seal="行"
        title="运行中心"
        description="选定作品后，在这里回看每次 AI 运行的过程、结果、模型用量和失败原因。"
      />
    </div>
  );
}
function countStatus(runs: NarrativeRun[], status: string) { return runs.filter((run) => run.status === status).length; }
