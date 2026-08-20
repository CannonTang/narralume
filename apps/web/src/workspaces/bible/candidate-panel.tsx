import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Check,
  CircleAlert,
  LoaderCircle,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { ErrorNote } from "../../components/error-note";
import {
  decideCanonCandidateItem,
  getCanonCandidates,
  getProjectRuns,
  getRunDetail,
  startCanonCandidate,
  type CanonCandidateSetDto,
  type CanonSpread,
  type NarrativeRun,
} from "../../lib/api";
import { projectWorkspacePath } from "../../lib/project-route";
import { useServerEvents } from "../../lib/sse";

interface CanonCandidatePanelProps {
  projectId: string;
  spread: CanonSpread;
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export function CanonCandidatePanel(props: CanonCandidatePanelProps) {
  /* 指示文本与 startedRunId 绑定 Spread 身份：切换页签时重挂载，避免串页。 */
  return <CanonCandidatePanelView key={props.spread} {...props} />;
}

function CanonCandidatePanelView({
  projectId,
  spread,
}: CanonCandidatePanelProps) {
  const queryClient = useQueryClient();
  const [instruction, setInstruction] = useState("");
  const [startedRunId, setStartedRunId] = useState<string | null>(null);
  const createRequestRef = useRef<{
    identity: string;
    requestId: string;
  } | null>(null);
  const candidatesQuery = useQuery({
    queryKey: ["project", projectId, "canon-candidates", spread],
    queryFn: ({ signal }) => getCanonCandidates(projectId, spread, signal),
  });
  const runsQuery = useQuery({
    queryKey: ["project", projectId, "runs"],
    queryFn: ({ signal }) => getProjectRuns(projectId, signal),
  });
  const relevantRuns = useMemo(
    () =>
      (runsQuery.data ?? []).filter(
        (run) =>
          run.recipe === "canon-spread-candidate" &&
          run.policy.canonSpread === spread,
      ),
    [runsQuery.data, spread],
  );
  const activeRun = latestRun(
    relevantRuns.filter((run) => !TERMINAL.has(run.status)),
  );
  const watchedRunId = activeRun?.id ?? startedRunId;
  const runQuery = useQuery({
    queryKey: ["run", watchedRunId],
    queryFn: ({ signal }) => getRunDetail(projectId, watchedRunId!, signal),
    enabled: Boolean(watchedRunId),
    refetchInterval: (query) =>
      query.state.data && TERMINAL.has(query.state.data.run.status)
        ? false
        : 1_500,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: ["project", projectId, "runs"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["project", projectId, "canon-candidates", spread],
    });
  };
  useServerEvents({
    onRunStatus: (runId) => {
      if (runId === watchedRunId) refresh();
    },
    onRunEvent: (runId) => {
      if (runId === watchedRunId) refresh();
    },
  });
  useEffect(() => {
    const detail = runQuery.data;
    if (!detail || !TERMINAL.has(detail.run.status)) return;
    refresh();
  }, [runQuery.data?.run.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const createMutation = useMutation({
    mutationFn: (text: string) => {
      const identity = JSON.stringify({ spread, instruction: text });
      if (createRequestRef.current?.identity !== identity) {
        createRequestRef.current = {
          identity,
          requestId: crypto.randomUUID(),
        };
      }
      return startCanonCandidate(projectId, spread, {
        requestId: createRequestRef.current.requestId,
        instruction: text,
      });
    },
    onSuccess: (accepted) => {
      createRequestRef.current = null;
      setInstruction("");
      setStartedRunId(accepted.runId);
      refresh();
    },
  });
  const visibleSets = useMemo(() => {
    const sets = candidatesQuery.data ?? [];
    const pending = sets.filter((item) =>
      ["candidate", "partially_applied"].includes(item.status),
    );
    const history = sets.filter((item) => !pending.includes(item)).slice(0, 3);
    return [...pending, ...history];
  }, [candidatesQuery.data]);
  const liveRun = runQuery.data?.run;

  return (
    <section className="bible-ai" aria-label="AI 候选修改">
      <header className="bible-ai__head">
        <span className="bible-ai__seal" aria-hidden="true">
          <Sparkles size={15} strokeWidth={1.45} />
        </span>
        <div>
          <p className="bible-ai__eyebrow mono">AI · CANDIDATE DESK</p>
          <h3>候选修改</h3>
        </div>
      </header>
      <p className="bible-ai__intro">
        说明你想补充或调整什么。AI 只会提出逐项候选，采纳前不会改变故事圣经。
      </p>

      {activeRun || (liveRun && !TERMINAL.has(liveRun.status)) ? (
        <RunNotice projectId={projectId} run={liveRun ?? activeRun!} />
      ) : (
        <div className="bible-ai__composer">
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder={spreadPrompt(spread)}
            aria-label="Canon 修改指示"
          />
          <button
            type="button"
            className="btn btn--primary"
            disabled={!instruction.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate(instruction.trim())}
          >
            {createMutation.isPending ? (
              <LoaderCircle className="bible-ai__spin" size={13} />
            ) : (
              <Sparkles size={13} />
            )}
            {createMutation.isPending ? "正在交付…" : "生成候选修改"}
          </button>
        </div>
      )}

      {createMutation.isError ? (
        <ErrorNote error={createMutation.error} title="候选任务未能开始" />
      ) : null}
      {runQuery.data &&
      ["failed", "cancelled"].includes(runQuery.data.run.status) ? (
        <ErrorNote
          error={new Error("AI 候选任务未完成；可进入运行中心查看原因后重新发起。")}
          title="候选没有生成"
        />
      ) : null}
      {candidatesQuery.isError ? (
        <ErrorNote error={candidatesQuery.error} title="候选内容暂时无法加载" />
      ) : null}

      <div className="bible-ai__sets">
        {visibleSets.map((set) => (
          <CandidateSet key={set.id} projectId={projectId} value={set} />
        ))}
      </div>
    </section>
  );
}

function RunNotice({
  projectId,
  run,
}: {
  projectId: string;
  run: NarrativeRun;
}) {
  return (
    <div className="bible-ai__running" role="status">
      <LoaderCircle className="bible-ai__spin" size={16} aria-hidden="true" />
      <div>
        <strong>AI 正在整理这一页的候选</strong>
        <span>{runStage(run)}</span>
      </div>
      <Link
        to={`${projectWorkspacePath(projectId, "runs")}?run=${encodeURIComponent(run.id)}`}
        aria-label="查看候选任务进度"
      >
        <ArrowUpRight size={14} />
      </Link>
    </div>
  );
}

function CandidateSet({
  projectId,
  value,
}: {
  projectId: string;
  value: CanonCandidateSetDto;
}) {
  return (
    <article className="bible-ai__set" data-status={value.status}>
      <header>
        <div>
          <span className="mono">候选 · {candidateStatus(value.status)}</span>
          <h4>{value.summary}</h4>
        </div>
        <Link
          to={`${projectWorkspacePath(projectId, "runs")}?run=${encodeURIComponent(value.runId)}`}
          aria-label="查看候选生成记录"
        >
          <ArrowUpRight size={14} />
        </Link>
      </header>
      {value.stale && value.items.some((item) => !item.decision) ? (
        <p className="bible-ai__stale">
          <CircleAlert size={13} aria-hidden="true" />
          这一页之后有过修改；采纳时会逐项核对，不会覆盖新内容。
        </p>
      ) : null}
      <p className="bible-ai__instruction">“{value.instruction}”</p>
      <div className="bible-ai__items">
        {value.items.map((item) => (
          <CandidateItem
            key={item.id}
            projectId={projectId}
            set={value}
            item={item}
          />
        ))}
      </div>
    </article>
  );
}

function CandidateItem({
  projectId,
  set,
  item,
}: {
  projectId: string;
  set: CanonCandidateSetDto;
  item: CanonCandidateSetDto["items"][number];
}) {
  const queryClient = useQueryClient();
  const [confirmLocked, setConfirmLocked] = useState(false);
  const decisionMutation = useMutation({
    mutationFn: (input: { action: "apply" | "reject"; confirmLocked?: boolean }) =>
      decideCanonCandidateItem(projectId, set.id, item.id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["project", projectId, "canon-candidates", set.spread],
      });
      void queryClient.invalidateQueries({
        queryKey: ["project", projectId, "bible"],
      });
    },
  });
  const apply = () => {
    if (item.requiresLockedConfirmation && !confirmLocked) {
      setConfirmLocked(true);
      return;
    }
    decisionMutation.mutate({ action: "apply", confirmLocked });
  };

  return (
    <section className="bible-ai__item" data-decided={item.decision ? "true" : undefined}>
      <div className="bible-ai__item-title">
        <span className="mono">{operationLabel(item.operation)}</span>
        <h5>{item.title}</h5>
      </div>
      <p>{item.rationale}</p>
      {item.diff.length ? (
        <dl className="bible-ai__diff">
          {item.diff.map((field) => (
            <div key={field.field}>
              <dt>{fieldLabel(field.field)}</dt>
              <dd>
                <del>{printValue(field.before)}</del>
                <span aria-hidden="true">→</span>
                <ins>{printValue(field.after)}</ins>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {item.impact.length ? (
        <ul className="bible-ai__impact">
          {item.impact.map((impact) => (
            <li key={impact}>{impact}</li>
          ))}
        </ul>
      ) : null}
      {item.decision ? (
        <p className="bible-ai__decision" data-action={item.decision.action}>
          {item.decision.action === "apply" ? (
            <Check size={13} aria-hidden="true" />
          ) : (
            <X size={13} aria-hidden="true" />
          )}
          {item.decision.action === "apply" ? "已采纳" : "已拒绝"}
        </p>
      ) : (
        <div className="bible-ai__actions">
          <button
            type="button"
            className="btn"
            disabled={decisionMutation.isPending}
            onClick={() => decisionMutation.mutate({ action: "reject" })}
          >
            <X size={12} />拒绝
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={decisionMutation.isPending}
            onClick={apply}
          >
            <Check size={12} />
            {confirmLocked ? "确认修改锁定内容" : "采纳此项"}
          </button>
        </div>
      )}
      {confirmLocked && !item.decision ? (
        <p className="bible-ai__locked-note">
          这项会改变锁定内容。再次点击确认，或选择拒绝。
        </p>
      ) : null}
      {decisionMutation.isError ? (
        <ErrorNote error={decisionMutation.error} title="这项候选没有被写入" />
      ) : null}
    </section>
  );
}

function latestRun(runs: NarrativeRun[]): NarrativeRun | null {
  return [...runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}

function runStage(run: NarrativeRun): string {
  if (run.status === "pending") return "等待开始；可以离开此页。";
  if (run.status === "paused") return "任务已暂停，候选记录仍会保留。";
  if (run.status === "failed_recoverable")
    return "本次响应超时，系统正在等待自动重试；可以离开此页。";
  return "正在读取当前内容并比较相关故事事实；可以离开此页。";
}

function spreadPrompt(spread: CanonSpread): string {
  const prompts: Record<CanonSpread, string> = {
    intent: "例如：让创作承诺更具体，但不要改变已锁定的结局方向。",
    outline: "例如：补强下一章的目标与冲突，不要提前回收长期伏笔。",
    entities: "例如：补充主人公的公开身份与隐藏代价。",
    facts: "例如：补齐第一章已经确认、但尚未登记的规则事实。",
    relations: "例如：更新两名角色在第一章结束后的信任状态。",
    timeline: "例如：整理第一章事件的先后顺序和因果。",
    foreshadows: "例如：登记可跨章发展的伏笔，不要安排立即回收。",
  };
  return prompts[spread];
}

function candidateStatus(status: CanonCandidateSetDto["status"]): string {
  return {
    candidate: "待裁定",
    partially_applied: "部分已采纳",
    applied: "已处理",
    rejected: "已拒绝",
  }[status];
}

function operationLabel(operation: "create" | "update" | "withdraw") {
  return { create: "新增", update: "修改", withdraw: "撤回" }[operation];
}

function fieldLabel(field: string): string {
  const labels: Record<string, string> = {
    promise: "创作承诺",
    themes: "主题",
    audience: "读者",
    tone: "语气",
    boundaries: "边界",
    endingDirection: "结局方向",
    currentFocus: "当前焦点",
    description: "描述",
    title: "标题",
    summary: "摘要",
    goal: "目标",
    conflict: "冲突",
    outcome: "结果",
    "$item": "整项",
  };
  return labels[field] ?? field;
}

function printValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "未填写";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "复杂内容";
  }
}
