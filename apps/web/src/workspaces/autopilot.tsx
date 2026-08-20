/* 长篇推演（航海日志）：罗盘 hero + 航次档 + 指令口 + 手账。 */

import "../styles/autopilot.css";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AUTOMATION_DEFAULTS,
  AUTOMATION_LIMITS,
} from "@narrative-lantern/contracts";
import { Compass, Play, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { ErrorNote } from "../components/error-note";
import { NumberField } from "../components/number-field";
import { PageBand } from "../components/page-band";
import { ProjectRequiredState } from "../components/project-required-state";
import { Skeleton } from "../components/skeleton";
import { formatTime, shortId } from "../lib/fmt";
import {
  controlAutopilotSession,
  createAutopilotSession,
  decideStorySteer,
  generateFoundation,
  getFoundationCandidates,
  getProjectRuns,
  getReviewWorkspace,
  getStoryCompass,
  getAutopilotSession,
  getAutopilotSessions,
  listAssignments,
  listModels,
  resolveAutopilotFailure,
  resolveFoundationCandidate,
  resolveFoundationCandidateSet,
  sendStorySteer,
  updateStoryCompass,
  type AutopilotSession,
  type AutopilotSessionDetail,
  type FoundationCandidate,
  type FoundationCandidateSet,
  type NarrativeRun,
  type ReviewWorkspaceReport,
  type SessionActionRequest,
  type StoryCompass,
} from "../lib/api";
import {
  autopilotLinkRoleLabel,
  foundationCandidateKindLabel,
  foundationCandidateStatusLabel,
  steerStatusLabel,
  stopReasonLabel,
  taskActionLabel,
} from "../lib/labels";
import { useProjectId } from "../lib/project-route";
import { projectWorkspacePath } from "../lib/project-route";
import { rememberTask } from "../lib/task-ledger";
import {
  DEMO_RELAY_PROVIDER_ID,
  TRIAL_RELAY_AUTOPILOT_CHAPTER_LIMIT,
} from "../lib/trial-policy";

/* 后台会自行推进、需要轮询收敛的会话状态；慢启动的 pending 也在其列。
   paused / awaiting_user / failed 由用户动作驱动，动作完成后已 invalidate。 */
const SESSION_PROGRESSING_STATUSES = ["pending", "planning", "running"];
/* 进行中的建书 Run：候选可能在 Run 推进期间才写入，候选列表要跟着轮询。 */
const FOUNDATION_RUN_ACTIVE_STATUSES = ["pending", "running", "failed_recoverable"];
const trialMode = import.meta.env.VITE_TRIAL_MODE === "1";

export function AutopilotWorkspace() {
  const projectId = useProjectId();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSessionId = searchParams.get("session");
  const requestedFoundationRunId = searchParams.get("foundation");

  const sessionsQuery = useQuery({
    queryKey: ["project", projectId, "autopilot", "sessions"],
    queryFn: ({ signal }) => getAutopilotSessions(projectId!, signal),
    enabled: Boolean(projectId),
    refetchInterval: (query) =>
      query.state.data?.some((session) => SESSION_PROGRESSING_STATUSES.includes(session.status)) ? 2_000 : false,
  });
  const sessions = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data]);
  const foundationRunsQuery = useQuery({
    queryKey: ["project", projectId, "runs"],
    queryFn: ({ signal }) => getProjectRuns(projectId!, signal),
    enabled: Boolean(projectId),
    refetchInterval: (query) => query.state.data?.some((run) =>
      run.recipe === "book-foundation" && FOUNDATION_RUN_ACTIVE_STATUSES.includes(run.status)) ? 1_500 : false,
  });
  const candidatesQuery = useQuery({
    queryKey: ["project", projectId, "foundation", "candidates"],
    queryFn: ({ signal }) => getFoundationCandidates(projectId!, signal),
    enabled: Boolean(projectId),
    refetchInterval: (query) =>
      query.state.data?.some((set) => set.set.status === "open") ||
      (foundationRunsQuery.data ?? []).some((run) =>
        run.recipe === "book-foundation" && FOUNDATION_RUN_ACTIVE_STATUSES.includes(run.status))
        ? 2_000
        : false,
  });
  const compassQuery = useQuery({
    queryKey: ["project", projectId, "compass"],
    queryFn: ({ signal }) => getStoryCompass(projectId!, signal),
    enabled: Boolean(projectId),
    retry: false,
  });
  const reviewQuery = useQuery({
    queryKey: ["project", projectId, "review"],
    queryFn: ({ signal }) => getReviewWorkspace(projectId!, signal),
    enabled: Boolean(projectId),
    refetchInterval: () =>
      sessions.some((session) =>
        SESSION_PROGRESSING_STATUSES.includes(session.status),
      )
        ? 2_500
        : false,
  });
  const assignmentsQuery = useQuery({
    queryKey: ["assignments"],
    queryFn: ({ signal }) => listAssignments(signal),
    enabled: trialMode,
  });
  const modelsQuery = useQuery({
    queryKey: ["models"],
    queryFn: ({ signal }) => listModels(undefined, signal),
    enabled: trialMode,
  });
  const writingAssignment = assignmentsQuery.data?.find(
    (assignment) => assignment.role === "writing",
  );
  const writingModel = modelsQuery.data?.find(
    (model) => model.id === writingAssignment?.modelId,
  );
  const usesTrialRelay =
    trialMode &&
    (!writingModel || writingModel.providerId === DEMO_RELAY_PROVIDER_ID);

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const foundationRun = useMemo(() => {
    const runs = (foundationRunsQuery.data ?? [])
      .filter((run) => run.recipe === "book-foundation")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    if (requestedFoundationRunId) {
      const requested = runs.find((run) => run.id === requestedFoundationRunId);
      if (requested) return requested;
    }
    return runs.find((run) => ["pending", "running", "paused", "awaiting_user", "failed_recoverable"].includes(run.status)) ?? null;
  }, [foundationRunsQuery.data, requestedFoundationRunId]);

  /* 生成 Run 落定（从进行中变为终态或让位）时补拉一次候选，收敛最后一次写入。 */
  const foundationRunActive = Boolean(
    foundationRun && FOUNDATION_RUN_ACTIVE_STATUSES.includes(foundationRun.status),
  );
  const foundationRunWasActiveRef = useRef(false);
  useEffect(() => {
    const wasActive = foundationRunWasActiveRef.current;
    foundationRunWasActiveRef.current = foundationRunActive;
    if (wasActive && !foundationRunActive) {
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "foundation", "candidates"] });
    }
  }, [foundationRunActive, projectId, queryClient]);

  const selectSession = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("session", sessionId);
    setSearchParams(nextParams, { replace: true });
  };

  useEffect(() => {
    if (sessions.length === 0) return;
    const selectedStillExists = sessions.some((session) => session.id === selectedSessionId);
    const requested = requestedSessionId
      ? sessions.find((session) => session.id === requestedSessionId)?.id
      : null;
    const nextSessionId = requested ?? (selectedStillExists ? selectedSessionId : sessions[0]!.id);
    if (nextSessionId && nextSessionId !== selectedSessionId) {
      queueMicrotask(() => setSelectedSessionId(nextSessionId));
    }
    if (nextSessionId && requestedSessionId !== nextSessionId) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("session", nextSessionId);
      queueMicrotask(() => setSearchParams(nextParams, { replace: true }));
    }
  }, [requestedSessionId, searchParams, selectedSessionId, sessions, setSearchParams]);

  const sessionDetailQuery = useQuery({
    queryKey: ["autopilot", "session", selectedSessionId],
    queryFn: ({ signal }) => getAutopilotSession(selectedSessionId!, signal),
    enabled: Boolean(selectedSessionId),
    /* 慢启动会话首次读回仍是 pending，漏掉就永久停在「等待开始」。 */
    refetchInterval: (query) =>
      query.state.data && SESSION_PROGRESSING_STATUSES.includes(query.state.data.session.status)
        ? 1_400
        : false,
  });

  const [steerInput, setSteerInput] = useState("");
  const steerRequestRef = useRef<PendingRequest | null>(null);
  const foundationRequestRef = useRef<PendingRequest | null>(null);

  /* 舵令输入绑定所选航次：切换会话即在渲染期间清空，避免写给 A 的指示发给 B。 */
  const [steerSessionId, setSteerSessionId] = useState(selectedSessionId);
  if (steerSessionId !== selectedSessionId) {
    setSteerSessionId(selectedSessionId);
    setSteerInput("");
  }

  const steerMutation = useMutation({
    mutationFn: (content: string) => {
      const requestId = requestIdFor(steerRequestRef, content);
      return sendStorySteer(selectedSessionId!, { requestId, content });
    },
    onSuccess: () => {
      steerRequestRef.current = null;
      void queryClient.invalidateQueries({
        queryKey: ["autopilot", "session", selectedSessionId],
      });
      setSteerInput("");
    },
  });
  const actionMutation = useMutation({
    mutationFn: (work: () => Promise<unknown>) => work(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "autopilot"] });
      void queryClient.invalidateQueries({ queryKey: ["autopilot", "session", selectedSessionId] });
    },
  });
  const foundationMutation = useMutation({
    mutationFn: (braindump: string) => generateFoundation(projectId!, { requestId: requestIdFor(foundationRequestRef, braindump), braindump, preferences: { genre: null, audience: null, tone: null, ...AUTOMATION_DEFAULTS }, policy: { qualityPreset: "standard" } }),
    onSuccess: (snapshot) => {
      foundationRequestRef.current = null;
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "foundation"] });
      queryClient.setQueryData<NarrativeRun[]>(["project", projectId, "runs"], (current = []) => [
        snapshot.run,
        ...current.filter((run) => run.id !== snapshot.run.id),
      ]);
      window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["project", projectId, "foundation"] }), 1_500);
      rememberTask({ projectId: projectId!, kind: "foundation", taskId: snapshot.run.id, label: "建书候选生成", createdAt: new Date().toISOString(), origin: { surface: "autopilot" } });
      setSelectedSessionId(null);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("foundation", snapshot.run.id);
      setSearchParams(nextParams, { replace: true });
    },
  });
  const candidateMutation = useMutation({
    mutationFn: (work: () => Promise<unknown>) => work(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "foundation"] });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "compass"] });
    },
  });
  const compassMutation = useMutation({
    mutationFn: (input: Omit<StoryCompass, "projectId" | "version" | "updatedAt">) => updateStoryCompass(projectId!, { ...input, expectedVersion: compassQuery.data?.version ?? null }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["project", projectId, "compass"] }),
  });
  const createSessionMutation = useMutation({
    mutationFn: (input: Parameters<typeof createAutopilotSession>[1]) => createAutopilotSession(projectId!, input),
    onSuccess: (session) => {
      rememberTask({ projectId: projectId!, kind: "quick_creation", taskId: session.id, label: `快速创作 ${session.targetChapters} 章`, createdAt: new Date().toISOString() });
      selectSession(session.id);
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "autopilot", "sessions"] });
    },
  });
  const detail = sessionDetailQuery.data;
  const activeSession = findActiveSession(
    detail?.session,
    createSessionMutation.data,
    ...sessions,
  );

  if (!projectId) {
    return (
      <div className="autopilot">
        <ProjectRequiredState
          seal="创"
          title="AI 快速创作"
          description="选定作品后，让 AI 按故事规划连续完成多章，作者可随时介入。"
        />
      </div>
    );
  }

  const headlineSession = activeSession ?? detail?.session;

  return (
    <div className="autopilot">
      <PageBand
        index="QUICK · Q1"
        title="AI 快速创作"
        meta={
          <span className="mono">
            {headlineSession
              ? `${autopilotStatusLabel(headlineSession.status)} · 已完成 ${
                  headlineSession.completedChapters
                } / ${headlineSession.targetChapters} 章`
              : sessions.length > 0
                ? `${sessions.length} 次创作记录`
                : "尚未开始连续创作"}
          </span>
        }
      />

      <div className="autopilot__layout">
        <div className="autopilot__setup">
          <FoundationPanel
            key={foundationRun?.id ?? "new-foundation"}
            sets={candidatesQuery.data ?? []}
            pending={foundationMutation.isPending || candidateMutation.isPending}
            error={foundationMutation.error ?? foundationRunsQuery.error ?? candidatesQuery.error ?? candidateMutation.error}
            foundationRun={foundationRun}
            projectId={projectId}
            onGenerate={(value) => foundationMutation.mutate(value)}
            onCandidate={(candidate, action, payload) => candidateMutation.mutate(() => resolveFoundationCandidate(candidate.id, action, payload))}
            onSet={(set, action) => candidateMutation.mutate(() => resolveFoundationCandidateSet(set.set.id, action))}
          />
          {compassQuery.isError ? (
            <section className="autopilot__setup-card">
              <ErrorNote error={compassQuery.error} title="创作方向读取失败" />
            </section>
          ) : (
            <CompassForm key={`compass-${compassQuery.data?.version ?? "new"}`} compass={compassQuery.data ?? null} pending={compassMutation.isPending} error={compassMutation.error} onSubmit={(input) => compassMutation.mutate(input)} />
          )}
          {activeSession ? (
            <ActiveSessionPanel
              session={activeSession}
              detail={detail?.session.id === activeSession.id ? detail : undefined}
              selected={selectedSessionId === activeSession.id}
              onSelect={() => selectSession(activeSession.id)}
            />
          ) : (
            <StartSessionForm key={`session-${createSessionMutation.data?.id ?? "new"}`} projectId={projectId} compass={compassQuery.data ?? null} pending={createSessionMutation.isPending} error={createSessionMutation.error} maxChapters={usesTrialRelay ? TRIAL_RELAY_AUTOPILOT_CHAPTER_LIMIT : AUTOMATION_LIMITS.targetChapters} usesTrialRelay={usesTrialRelay} onSubmit={(input) => createSessionMutation.mutate(input)} />
          )}
        </div>
        <CompassCard detail={detail} reports={reviewQuery.data?.reports ?? []} />
        <CommandDeck
          sessions={sessions}
          selectedId={selectedSessionId}
          setSelected={selectSession}
          sessionsPending={sessionsQuery.isPending}
          sessionsError={sessionsQuery.error}
          detail={detail}
          onControl={(action) =>
            actionMutation.mutate(() => controlAutopilotSession(selectedSessionId!, action))
          }
          onResolve={(action) => actionMutation.mutate(() => resolveAutopilotFailure(selectedSessionId!, action))}
          actionPending={actionMutation.isPending}
          actionError={actionMutation.error}
          onSteer={(content) => steerMutation.mutate(content)}
          onSteerDecision={(steerId, action) =>
            actionMutation.mutate(() =>
              decideStorySteer(selectedSessionId!, steerId, action),
            )
          }
          steerInput={steerInput}
          setSteerInput={setSteerInput}
          steerPending={steerMutation.isPending}
          steerError={steerMutation.error}
        />
      </div>
    </div>
  );
}

function FoundationPanel({ sets, pending, error, foundationRun, projectId, onGenerate, onCandidate, onSet }: {
  sets: FoundationCandidateSet[];
  pending: boolean;
  error: unknown;
  foundationRun: NarrativeRun | null;
  projectId: string;
  onGenerate: (braindump: string) => void;
  onCandidate: (candidate: FoundationCandidate, action: "adopt" | "discard", payload?: Record<string, unknown>) => void;
  onSet: (set: FoundationCandidateSet, action: "adopt-all" | "discard-all") => void;
}) {
  const [braindump, setBraindump] = useState(() => foundationBraindump(foundationRun));
  const openSets = sets.filter((set) => set.set.status === "open" || set.set.status === "partially_adopted");
  const blocksNewGeneration = Boolean(foundationRun && ["pending", "running", "paused", "awaiting_user", "failed_recoverable"].includes(foundationRun.status));
  return <section className="autopilot__setup-card"><header><p className="mono">STEP 1</p><h2>准备故事方向</h2></header><p className="autopilot__setup-hint">已有清晰设定可以跳过；如果只有一个想法，让 AI 先整理成可确认的方向。</p>
    {foundationRun && blocksNewGeneration ? <FoundationRunStatus run={foundationRun} projectId={projectId} /> : null}
    {openSets.length === 0 ? <><textarea className="autopilot__braindump" value={braindump} onChange={(event) => setBraindump(event.target.value)} placeholder="写下题材、人物、冲突和你想抵达的结局。" aria-label="故事想法" /><button type="button" className="btn btn--primary" disabled={pending || blocksNewGeneration || !braindump.trim()} onClick={() => onGenerate(braindump.trim())}><Play size={12} />{pending ? "处理中…" : blocksNewGeneration ? "当前任务尚未结束" : "让 AI 整理创作方向"}</button></> : openSets.map((set) => <CandidateSet key={set.set.id} value={set} pending={pending} onCandidate={onCandidate} onSet={onSet} />)}
    {error ? <ErrorNote error={error} title="创作方向没有整理完成" /> : null}
  </section>;
}

function FoundationRunStatus({ run, projectId }: { run: NarrativeRun; projectId: string }) {
  const failed = run.status === "failed_recoverable";
  const title = failed
    ? "本次响应超时，等待自动重试"
    : run.status === "paused"
      ? "整理已暂停"
      : run.status === "awaiting_user"
        ? "整理结果等待处理"
        : "AI 正在整理创作方向";
  return <div className="autopilot__foundation-run" data-status={run.status} role="status"><div><strong>{title}</strong><p>{failed ? "后台会按运行策略自动继续，不需要重复提交；你可以离开此页。" : "可以离开此页；返回后会从服务端恢复同一任务。"}</p></div><div className="autopilot__setup-actions"><Link className="autopilot__setup-link" to={`${projectWorkspacePath(projectId, "runs")}?run=${encodeURIComponent(run.id)}`}>查看技术详情</Link></div></div>;
}

function foundationBraindump(run: NarrativeRun | null): string {
  return typeof run?.policy.braindump === "string" ? run.policy.braindump : "";
}

function CandidateSet({ value, pending, onCandidate, onSet }: { value: FoundationCandidateSet; pending: boolean; onCandidate: (candidate: FoundationCandidate, action: "adopt" | "discard", payload?: Record<string, unknown>) => void; onSet: (set: FoundationCandidateSet, action: "adopt-all" | "discard-all") => void }) {
  return <div className="autopilot__candidate-set"><h3>{value.set.title}</h3>{value.candidates.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} pending={pending} onAction={onCandidate} />)}<div className="autopilot__setup-actions"><button type="button" className="btn" disabled={pending} onClick={() => onSet(value, "adopt-all")}>全部采纳</button><button type="button" className="btn" disabled={pending} onClick={() => onSet(value, "discard-all")}>全部丢弃</button></div></div>;
}
function CandidateCard({ candidate, pending, onAction }: { candidate: FoundationCandidate; pending: boolean; onAction: (candidate: FoundationCandidate, action: "adopt" | "discard", payload?: Record<string, unknown>) => void }) {
  const [payloadText, setPayloadText] = useState(() => JSON.stringify(candidate.editedPayload ?? candidate.payload, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const adopt = () => { try { onAction(candidate, "adopt", JSON.parse(payloadText) as Record<string, unknown>); setParseError(null); } catch { setParseError("候选 JSON 无法解析，请修正后采纳。"); } };
  const summary = foundationSummary(candidate.kind, safeCandidatePayload(payloadText, candidate.payload));
  return <article className="autopilot__candidate" data-status={candidate.status}><header><strong>{candidate.label}</strong><span>{foundationCandidateKindLabel(candidate.kind)} · {foundationCandidateStatusLabel(candidate.status)}</span></header><dl className="autopilot__candidate-summary">{summary.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>{candidate.status === "pending" ? <details className="autopilot__candidate-advanced"><summary>高级编辑完整字段</summary><textarea value={payloadText} onChange={(event) => setPayloadText(event.target.value)} aria-label={`编辑候选 ${candidate.label}`} /></details> : null}{parseError ? <p role="alert">{parseError}</p> : null}{candidate.status === "pending" ? <div className="autopilot__candidate-actions"><button type="button" className="btn btn--primary" disabled={pending} onClick={adopt}>采纳</button><button type="button" className="btn" disabled={pending} onClick={() => onAction(candidate, "discard")}>搁置</button></div> : null}</article>;
}

function CompassForm({ compass, pending, error, onSubmit }: { compass: StoryCompass | null; pending: boolean; error: unknown; onSubmit: (input: Omit<StoryCompass, "projectId" | "version" | "updatedAt">) => void }) {
  const [corePromise, setCorePromise] = useState(compass?.corePromise ?? ""); const [endingDirection, setEndingDirection] = useState(compass?.endingDirection ?? ""); const [themeQuestions, setThemeQuestions] = useState(compass?.themeQuestions.join("\n") ?? ""); const [constraints, setConstraints] = useState(compass?.constraints.join("\n") ?? ""); const [chapters, setChapters] = useState(compass?.target.chapters ?? AUTOMATION_DEFAULTS.targetChapters); const [words, setWords] = useState(compass?.target.wordsPerChapter ?? AUTOMATION_DEFAULTS.wordsPerChapter); const [volumes, setVolumes] = useState(compass?.target.volumes ?? AUTOMATION_DEFAULTS.volumes);
  return <form className="autopilot__setup-card" onSubmit={(event) => { event.preventDefault(); onSubmit({ corePromise, endingDirection: endingDirection || null, longLines: compass?.longLines ?? [], themeQuestions: themeQuestions.split("\n").map((v) => v.trim()).filter(Boolean), target: { chapters, wordsPerChapter: words, volumes }, constraints: constraints.split("\n").map((v) => v.trim()).filter(Boolean) }); }}><header><p className="mono">STEP 2</p><h2>确认创作方向</h2></header><label>这本书要给读者什么<textarea required value={corePromise} onChange={(event) => setCorePromise(event.target.value)} /></label><label>结局方向<textarea value={endingDirection ?? ""} onChange={(event) => setEndingDirection(event.target.value)} /></label><label>想持续追问的问题（每行一个）<textarea value={themeQuestions} onChange={(event) => setThemeQuestions(event.target.value)} /></label><label>不可违背的要求（每行一个）<textarea value={constraints} onChange={(event) => setConstraints(event.target.value)} /></label><div className="autopilot__setup-grid"><label>目标章数<NumberField min={1} max={AUTOMATION_LIMITS.targetChapters} value={chapters} onChange={setChapters} /></label><label>每章参考字数<NumberField min={1} value={words} onChange={setWords} /></label><label>卷数<NumberField min={1} max={AUTOMATION_LIMITS.volumes} value={volumes} onChange={setVolumes} /></label></div><button type="submit" className="btn btn--primary" disabled={pending || !corePromise.trim()}>{pending ? "保存中…" : compass ? "更新创作方向" : "确认创作方向"}</button>{error ? <ErrorNote error={error} title="创作方向未保存" /> : null}</form>;
}

function StartSessionForm({ projectId, compass, pending, error, maxChapters, usesTrialRelay, onSubmit }: { projectId: string; compass: StoryCompass | null; pending: boolean; error: unknown; maxChapters: number; usesTrialRelay: boolean; onSubmit: (input: Parameters<typeof createAutopilotSession>[1]) => void }) {
  const [approvalMode, setApprovalMode] = useState<"continuous" | "per_chapter">("continuous");
  const [planningMode, setPlanningMode] = useState<"auto" | "confirm">("auto");
  const [targetChapters, setTarget] = useState(() => Math.min(rememberedTarget(projectId) ?? compass?.target.chapters ?? 3, maxChapters));
  const [windowSize, setWindow] = useState(3);
  const [maxRevisionCycles, setCycles] = useState(2);
  const [qualityPreset, setPreset] = useState<"fast" | "standard" | "deep">("standard");
  const requestRef = useRef<PendingRequest | null>(null);
  const targetEditedRef = useRef(false);
  /* 首次使用（没有记忆值）时跟随罗盘的目标章数；一旦写过一次会话，
     之后回到本页都恢复上次使用的章数，不再被罗盘的 12 覆盖。 */
  useEffect(() => {
    if (compass && !targetEditedRef.current && rememberedTarget(projectId) === null) {
      setTarget(Math.min(compass.target.chapters, maxChapters));
    }
  }, [compass, maxChapters, projectId]);
  const effectiveTargetChapters = Math.min(targetChapters, maxChapters);
  return <form className="autopilot__setup-card" onSubmit={(event) => { event.preventDefault(); const input = { approvalMode, planningMode, origin: { surface: "autopilot" as const }, targetChapters: effectiveTargetChapters, windowSize, maxRevisionCycles, chapterPolicy: { qualityPreset } }; rememberTarget(projectId, effectiveTargetChapters); onSubmit({ ...input, requestId: requestIdFor(requestRef, JSON.stringify(input)) }); }}><header><p className="mono">STEP 3</p><h2>开始连续创作</h2></header><p className="autopilot__setup-hint">默认会连续完成多章，并在每章结束后保存正文和故事状态；你可以随时暂停或补充指示。本章只要一份待采纳稿，请回写作台使用「交给 AI」。</p>{usesTrialRelay ? <p className="autopilot__setup-hint">当前使用内置体验模型，每次最多连续创作 3 章；切换到自带 Key 的默认模型后恢复完整上限。</p> : null}<label>创作方式<select value={approvalMode} onChange={(event) => setApprovalMode(event.target.value as typeof approvalMode)}><option value="continuous">连续创作（推荐）</option><option value="per_chapter">每章完成后等我确认</option></select></label><label>这次写几章<NumberField min={1} max={maxChapters} value={effectiveTargetChapters} onChange={(value) => { targetEditedRef.current = true; setTarget(value); }} /></label><details className="autopilot__advanced"><summary>高级选项</summary><label>章节规划<select value={planningMode} onChange={(event) => setPlanningMode(event.target.value as typeof planningMode)}><option value="auto">自动执行</option><option value="confirm">每章规划先确认</option></select></label><div className="autopilot__setup-grid"><label>向前规划章数<NumberField min={1} max={AUTOMATION_LIMITS.planningWindow} value={windowSize} onChange={setWindow} /></label><label>最多自动修订<NumberField min={0} max={AUTOMATION_LIMITS.revisionCycles} value={maxRevisionCycles} onChange={setCycles} /></label></div><label>生成质量<select value={qualityPreset} onChange={(event) => setPreset(event.target.value as typeof qualityPreset)}><option value="fast">快速</option><option value="standard">标准</option><option value="deep">深度</option></select></label></details><button type="submit" className="btn btn--primary" disabled={pending || !compass}>{pending ? "正在开始…" : "开始 AI 快速创作"}</button>{!compass ? <p className="autopilot__setup-hint">先确认上面的创作方向，才能开始连续创作。</p> : null}{error ? <ErrorNote error={error} title="快速创作没有开始" /> : null}</form>;
}

/* 每个项目记忆「这次写几章」的上次取值；只存导航线索级别的轻量偏好。 */
const TARGET_KEY_PREFIX = "narralume:autopilot-target:";

function rememberedTarget(projectId: string): number | null {
  try {
    const raw = window.localStorage.getItem(`${TARGET_KEY_PREFIX}${projectId}`);
    const parsed = raw === null ? Number.NaN : Number(raw);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= AUTOMATION_LIMITS.targetChapters ? parsed : null;
  } catch {
    return null;
  }
}

function rememberTarget(projectId: string, value: number): void {
  try {
    window.localStorage.setItem(`${TARGET_KEY_PREFIX}${projectId}`, String(value));
  } catch {
    /* 私密模式下放弃持久化 */
  }
}

function ActiveSessionPanel({ session, detail, selected, onSelect }: {
  session: AutopilotSession;
  detail: AutopilotSessionDetail | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const title = session.status === "paused"
    ? "快速创作已暂停"
    : session.status === "awaiting_user"
      ? "快速创作等待你确认"
      : session.status === "failed"
        ? "快速创作需要处理"
        : "AI 正在连续创作";
  const currentChapter = detail?.currentChapter?.title;
  return (
    <section className="autopilot__setup-card" aria-label="当前快速创作">
      <header><p className="mono">STEP 3</p><h2>连续创作已经开始</h2></header>
      <div className="autopilot__foundation-run" data-status={session.status} role="status">
        <div>
          <strong>{title}</strong>
          <p>{autopilotStatusLabel(session.status)} · 已完成 {session.completedChapters} / {session.targetChapters} 章{currentChapter ? ` · 当前处理《${currentChapter}》` : ""}</p>
          <p>可以离开此页；返回后会从服务端恢复同一任务和创作结果。</p>
        </div>
        {!selected ? (
          <div className="autopilot__setup-actions">
            <button type="button" className="btn btn--primary" onClick={onSelect}>回到正在进行的创作</button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* ---- 罗盘 hero ----------------------------------------------------------- */

function CompassCard({ detail, reports }: { detail: AutopilotSessionDetail | undefined; reports: ReviewWorkspaceReport[] }) {
  const legs = detail?.links ?? [];
  const quality = sessionQualitySummary(detail, reports);
  const running = detail?.session;
  /* 针动 = 已入账 / 目标；得到 360° 上的一个角。 */
  const progress = running
    ? Math.min(1, running.completedChapters / Math.max(1, running.targetChapters))
    : 0;
  const angle = -Math.PI / 2 + progress * Math.PI * 2;
  const needleX = 100 + 72 * Math.cos(angle);
  const needleY = 100 + 72 * Math.sin(angle);

  return (
    <article className="autopilot__compass" aria-label="连续创作进度">
      <div className="autopilot__compass-face" aria-hidden="true">
        <svg viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="92" fill="none" stroke="var(--ink)" strokeWidth="0.6" />
          <circle cx="100" cy="100" r="78" fill="none" stroke="var(--ink)" strokeWidth="0.4" strokeDasharray="1 5" />
          {/* 外周小字刻（船舶日志的气场） */}
          {Array.from({ length: 8 }).map((_, index) => {
            const tickAngle = (-Math.PI / 2) + (index / 8) * Math.PI * 2;
            const x1 = 100 + 86 * Math.cos(tickAngle);
            const y1 = 100 + 86 * Math.sin(tickAngle);
            const x2 = 100 + 78 * Math.cos(tickAngle);
            const y2 = 100 + 78 * Math.sin(tickAngle);
            return (
              <line
                key={index}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="var(--ink)"
                strokeWidth="0.8"
              />
            );
          })}
          {/* 进度弧 */}
          <path
            d={describeArc(100, 100, 70, -Math.PI / 2, angle)}
            fill="none"
            stroke="var(--vera)"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          {/* 指针 & 针心 */}
          <line x1="100" y1="100" x2={needleX} y2={needleY} stroke="var(--vera)" strokeWidth="1.8" />
          <line x1="100" y1="100" x2={100 + 46 * Math.cos(angle + Math.PI)} y2={100 + 46 * Math.sin(angle + Math.PI)} stroke="var(--ink-soft)" strokeWidth="0.6" strokeDasharray="1 4" />
          <circle cx="100" cy="100" r="5" fill="var(--vera)" />
        </svg>
      </div>
      <div className="autopilot__compass-body">
        <p className="autopilot__compass-kicker">
          <Compass size={13} strokeWidth={1.5} aria-hidden="true" />
          创作进度 · {Math.round(progress * 100)}%
        </p>
        {running ? (
          <>
            <p className="autopilot__current-title">
              计划创作 {running.targetChapters} 章
              {detail?.currentChapter ? ` · 当前 ${detail.currentChapter.title}` : ""}
            </p>
            <p className="autopilot__current-sub">
              {running.approvalMode === "continuous" ? "连续创作" : "逐章确认"}
              {" · "}已完成 {running.completedChapters} 章
              {running.skippedChapters > 0 ? ` · 已跳过 ${running.skippedChapters} 章` : ""}
            </p>
          </>
        ) : (
          <p className="autopilot__current-sub">
            还没有开始。先在上方确认创作方向，再选择连续创作或逐章确认。
          </p>
        )}
        <div className="autopilot__legs">
          {quality.total > 0 ? <div className="autopilot__quality" aria-label="本次创作质量汇总">
            <span><strong>{quality.pass}</strong> 已通过</span>
            <span data-quality="revise"><strong>{quality.revise}</strong> 待复看</span>
            <span data-quality="block"><strong>{quality.block}</strong> 已阻断</span>
            {quality.missing > 0 ? <span data-quality="missing"><strong>{quality.missing}</strong> 未形成报告</span> : null}
          </div> : null}
          {legs.length === 0 ? (
            <p className="autopilot__legs-empty">开始后，这里会显示规划、正文和阶段复盘的进展。</p>
          ) : (
            legs.map((leg) => {
              const isCurrent = running?.currentRunId === leg.runId;
              return (
              <div
                key={leg.runId + leg.sequence}
                className="autopilot__leg"
                data-role={leg.role}
                data-state={isCurrent ? "running" : legOutcomeState(leg.outcome)}
              >
                <span className="autopilot__leg-no">
                  {String(leg.sequence + 1).padStart(2, "0")}
                </span>
                <span className="autopilot__leg-name">
                  {autopilotLinkRoleLabel(leg.role)}
                </span>
                <span className="autopilot__leg-state">
                  {isCurrent ? "正在进行" : legOutcomeLabel(leg.outcome)}
                </span>
                {running ? <Link to={`${projectWorkspacePath(running.projectId, "runs")}?run=${encodeURIComponent(leg.runId)}`}>技术记录</Link> : null}
              </div>
              );
            })
          )}
        </div>
      </div>
    </article>
  );
}

function sessionQualitySummary(
  detail: AutopilotSessionDetail | undefined,
  reports: ReviewWorkspaceReport[],
): { total: number; pass: number; revise: number; block: number; missing: number } {
  const completedChapterRuns = new Set(
    (detail?.links ?? [])
      .filter((link) => link.role === "chapter" && link.outcome === "completed")
      .map((link) => link.runId),
  );
  const latestByRun = new Map<string, ReviewWorkspaceReport>();
  for (const report of [...reports].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )) {
    if (completedChapterRuns.has(report.runId) && !latestByRun.has(report.runId)) {
      latestByRun.set(report.runId, report);
    }
  }
  const values = [...latestByRun.values()];
  return {
    total: completedChapterRuns.size,
    pass: values.filter((report) => report.verdict === "pass").length,
    revise: values.filter((report) => report.verdict === "revise").length,
    block: values.filter((report) => report.verdict === "block").length,
    missing: completedChapterRuns.size - values.length,
  };
}

/* ---- 指挥台 -------------------------------------------------------------- */

function CommandDeck({
  sessions,
  selectedId,
  setSelected,
  sessionsPending,
  sessionsError,
  detail,
  onControl,
  onResolve,
  actionPending,
  actionError,
  onSteer,
  onSteerDecision,
  steerInput,
  setSteerInput,
  steerPending,
  steerError,
}: {
  sessions: AutopilotSession[];
  selectedId: string | null;
  setSelected: (id: string) => void;
  sessionsPending: boolean;
  sessionsError: unknown;
  detail: AutopilotSessionDetail | undefined;
  onControl: (action: SessionActionRequest) => void;
  onResolve: (action: "retry-current" | "skip-chapter" | "replan" | "stop") => void;
  actionPending: boolean;
  actionError: unknown;
  onSteer: (content: string) => void;
  onSteerDecision: (steerId: string, action: "apply" | "reject") => void;
  steerInput: string;
  setSteerInput: (s: string) => void;
  steerPending: boolean;
  steerError: unknown;
}) {
  const running = detail?.session;
  const resolutionActions = (
    ["retry-current", "skip-chapter", "replan", "stop"] as const
  ).filter((action) => detail?.availableActions.includes(action));
  return (
    <div className="autopilot__stack">
      <div className="autopilot__list" aria-label="创作记录">
        <header className="autopilot__list-head">
          <p className="autopilot__list-title">创作记录</p>
          <span className="autopilot__list-count mono">
            {sessions.length} 次
          </span>
        </header>
        {sessionsPending ? (
          <Skeleton lines={3} />
        ) : sessionsError ? (
          <div className="autopilot__list-note">
            <ErrorNote error={sessionsError} title="创作记录暂时无法加载" />
          </div>
        ) : sessions.length === 0 ? (
          <p className="autopilot__list-empty">
            还没有连续创作记录。完成上方三步后，进度会保存在这里。
          </p>
        ) : (
          sessions.map((session, index) => (
            <button
              key={session.id}
              type="button"
              className="autopilot__session"
              data-active={session.id === selectedId}
              aria-current={session.id === selectedId ? "page" : undefined}
              onClick={() => setSelected(session.id)}
            >
              <span className="autopilot__session-no mono">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="autopilot__session-title">
                {session.completedChapters === session.targetChapters
                  ? `已完成 ${session.completedChapters}/${session.targetChapters} 章`
                  : `${session.completedChapters}/${session.targetChapters} 章 · ${session.approvalMode === "continuous" ? "连续创作" : "逐章确认"}`}
                <small>
                  {formatTime(session.createdAt)} · 任务 {shortId(session.id)}{session.currentOutlineNodeId ? ` · 当前章节 ${shortId(session.currentOutlineNodeId)}` : ""}
                </small>
              </span>
              <span className="autopilot__session-status">
                {autopilotStatusLabel(session.status)}
              </span>
            </button>
          ))
        )}
        {running && !["completed", "cancelled"].includes(running.status) ? (
          <div className="autopilot__actions">
            {(detail?.availableActions ?? []).includes("pause") ? <button type="button" className="autopilot__action-btn" data-t="pause" disabled={actionPending} onClick={() => onControl({ action: "pause" })}>暂停</button> : null}
            {(detail?.availableActions ?? []).includes("resume") ? <button type="button" className="autopilot__action-btn" data-t="resume" disabled={actionPending} onClick={() => onControl({ action: "resume" })}>继续</button> : null}
            {(detail?.availableActions ?? []).includes("accept_plan") ? <button type="button" className="autopilot__action-btn" data-t="accept" disabled={actionPending} onClick={() => onControl({ action: "accept_plan", requestId: `${running.currentRunId}:accept_plan` })}>{taskActionLabel("accept_plan")}</button> : null}
            {(detail?.availableActions ?? []).includes("accept_manuscript") ? <button type="button" className="autopilot__action-btn" data-t="accept" disabled={actionPending} onClick={() => onControl({ action: "accept_manuscript", requestId: `${running.currentRunId}:accept_manuscript` })}>确认本章正文</button> : null}
            {detail?.stopReason === "settlement_conflict_requires_resolution" ? <Link className="autopilot__action-btn" data-t="accept" to={projectWorkspacePath(running.projectId, "studio")}>处理故事变化</Link> : null}
            {(detail?.availableActions ?? []).includes("cancel") ? <button type="button" className="autopilot__action-btn" disabled={actionPending} onClick={() => onControl({ action: "cancel" })}>结束本次创作</button> : null}
          </div>
        ) : null}
        {(detail?.availableActions ?? []).includes("request_revision") ? <SessionRevisionRequest pending={actionPending} onSubmit={(requestId, instruction) => onControl({ action: "request_revision", requestId, instruction })} /> : null}
        {resolutionActions.length ? <div className="autopilot__failure-actions"><p>这次创作中断了，请选择下一步：</p>{resolutionActions.map((action) => <button key={action} type="button" className="btn" disabled={actionPending} onClick={() => onResolve(action)}>{taskActionLabel(action)}</button>)}</div> : null}
        {actionError ? <ErrorNote error={actionError} title="操作没有完成" /> : null}
      </div>

      {running && !["completed", "cancelled"].includes(running.status) ? (
      <div className="autopilot__steer" aria-label="给 AI 的创作指示">
        <header className="autopilot__steer-head">
          <p className="autopilot__steer-title">给 AI 的创作指示</p>
          <span className="autopilot__steer-kicker mono">随时介入</span>
        </header>
        <textarea
          className="autopilot__steer-input"
          value={steerInput}
          onChange={(event) => setSteerInput(event.target.value)}
          placeholder="例如：下一章先不要揭示父亲的身份，让读者只看到那封信。"
          aria-label="新创作指示"
        />
        {steerError ? (
          <ErrorNote error={steerError} title="舵令推不进去" />
        ) : null}
        <button
          type="button"
          className="autopilot__steer-btn"
          disabled={!steerInput.trim() || steerPending || !selectedId}
          onClick={() => onSteer(steerInput.trim())}
        >
          <Send size={13} strokeWidth={1.5} aria-hidden="true" />
          应用到后续创作
        </button>
      </div>
      ) : null}

      {detail?.session.activeNotes.length ? (
        <div className="autopilot__notes">
          <p className="autopilot__notes-title">当前有效的创作要求</p>
          <ul>
            {detail.session.activeNotes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {detail?.steers.some((steer) => steer.status === "awaiting_confirmation") ? <div className="autopilot__notes" data-t="warn"><p className="autopilot__notes-title">待裁定的创作指示</p>{detail.steers.filter((steer) => steer.status === "awaiting_confirmation").map((steer) => <article key={steer.id}><strong>{steerStatusLabel(steer)}</strong><p>{steer.content}</p>{steer.rationale ? <small>{steer.rationale}</small> : null}<div className="autopilot__candidate-actions"><button type="button" className="btn btn--primary" disabled={actionPending} onClick={() => onSteerDecision(steer.id, "apply")}>采纳并重排</button><button type="button" className="btn" disabled={actionPending} onClick={() => onSteerDecision(steer.id, "reject")}>不采用，继续创作</button></div></article>)}</div> : null}

      {detail?.steers.length ? <details className="autopilot__notes"><summary className="autopilot__notes-title">历史创作指示</summary><ul>{detail.steers.map((steer) => <li key={steer.id}><strong>{steerStatusLabel(steer)}</strong><br />{steer.content}{steer.rationale ? <small> · {steer.rationale}</small> : null}</li>)}</ul></details> : null}

      {detail?.reviews.length ? (
        <div className="autopilot__reviews">
          <p className="autopilot__reviews-title">阶段复盘</p>
          <ul>
            {detail.reviews.map((review) => (
              <li key={review.id}>
                {review.summary}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {detail?.session.lastError ? (
        <div className="autopilot__notes" data-t="warn">
          <p className="autopilot__notes-title">创作中断</p>
          <p className="autopilot__notes-error">
            {humanError(detail.session.lastError)}
          </p>
        </div>
      ) : null}
      {detail?.stopReason && ["paused", "awaiting_user", "failed"].includes(detail.session.status) ? (
        <div className="autopilot__notes" data-t="stop">
          <p className="autopilot__notes-title">{detail.session.status === "paused" ? "暂停原因" : detail.session.status === "awaiting_user" ? "等待确认" : "中断原因"}</p>
          <p className="autopilot__notes-error">{stopReasonLabel(detail.stopReason)}</p>
        </div>
      ) : null}
    </div>
  );
}

/* ---- 请求修订（航次级） ---------------------------------------------------- */

function SessionRevisionRequest({ pending, onSubmit }: { pending: boolean; onSubmit: (requestId: string, instruction: string) => void }) {
  const [instruction, setInstruction] = useState("");
  const requestIdRef = useRef<string | null>(null);
  return (
    <div className="autopilot__revision">
      <textarea
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
        placeholder="写给这一章的修订指示；留空则使用默认修订指令。"
        aria-label="修订指示"
        rows={3}
      />
      <button type="button" className="autopilot__action-btn" disabled={pending} onClick={() => onSubmit(requestIdRef.current ??= crypto.randomUUID(), instruction.trim() || "请在保持既有优点的前提下，重新修订并提升这一版正文。")}>{taskActionLabel("request_revision")}</button>
    </div>
  );
}

/* ---- 小工具 ------------------------------------------------------------ */

function safeCandidatePayload(
  text: string,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : fallback;
  } catch {
    return fallback;
  }
}

function foundationSummary(
  kind: FoundationCandidate["kind"],
  payload: Record<string, unknown>,
): Array<{ label: string; value: string }> {
  const text = (key: string) => typeof payload[key] === "string" ? payload[key] : "";
  const lines = (key: string) => Array.isArray(payload[key])
    ? (payload[key] as unknown[]).filter((value): value is string => typeof value === "string").join("、")
    : "";
  if (kind === "intent") {
    return [
      { label: "创作承诺", value: text("promise") },
      { label: "主题", value: lines("themes") },
      { label: "语气", value: text("tone") },
      { label: "结局方向", value: text("endingDirection") },
    ].filter((item) => item.value);
  }
  if (kind === "compass") {
    const target = payload.target && typeof payload.target === "object"
      ? payload.target as Record<string, unknown>
      : {};
    return [
      { label: "核心方向", value: text("corePromise") },
      { label: "结局方向", value: text("endingDirection") },
      { label: "持续问题", value: lines("themeQuestions") },
      { label: "篇幅", value: typeof target.chapters === "number" ? `${target.chapters} 章 · 每章约 ${String(target.wordsPerChapter ?? "—")} 字` : "" },
    ].filter((item) => item.value);
  }
  const attributes = payload.attributes && typeof payload.attributes === "object"
    ? payload.attributes as Record<string, unknown>
    : {};
  return [
    { label: "名称", value: text("name") },
    { label: "描述", value: text("description") },
    { label: "故事作用", value: typeof attributes.role === "string" ? attributes.role : "" },
    { label: "欲望", value: typeof attributes.desire === "string" ? attributes.desire : "" },
    { label: "恐惧", value: typeof attributes.fear === "string" ? attributes.fear : "" },
  ].filter((item) => item.value);
}

function humanError(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "任务意外中断，请选择重试或结束。";
  const record = value as Record<string, unknown>;
  for (const key of ["message", "detail", "reason", "code"]) {
    if (typeof record[key] === "string" && record[key]) return record[key];
  }
  return "任务意外中断，请选择重试或结束。";
}

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
): string {
  const startX = cx + r * Math.cos(startAngle);
  const startY = cy + r * Math.sin(startAngle);
  const endX = cx + r * Math.cos(endAngle);
  const endY = cy + r * Math.sin(endAngle);
  const largeArcFlag = endAngle - startAngle <= Math.PI ? 0 : 1;
  return `M ${startX} ${startY} A ${r} ${r} 0 ${largeArcFlag} 1 ${endX} ${endY}`;
}

function autopilotStatusLabel(status: AutopilotSession["status"]): string {
  return {
    pending: "等待开始",
    planning: "正在规划",
    running: "正在连续创作",
    paused: "已暂停",
    awaiting_user: "等待你确认",
    failed: "需要处理",
    cancelled: "已结束",
    completed: "已完成",
  }[status];
}

/* 环节终态来自 autopilot_run_links.outcome（completed/failed/cancelled，以及
   失败处置动作 retry-current/skip-chapter/replan、转修订 revision_requested）。 */
function legOutcomeState(outcome: string | null): string {
  if (outcome === null) return "pending";
  if (outcome === "failed" || outcome === "cancelled") return outcome;
  return "done";
}

function legOutcomeLabel(outcome: string | null): string {
  return (
    {
      completed: "已完成",
      failed: "失败",
      cancelled: "已取消",
      revision_requested: "已转修订",
      "retry-current": "已重试",
      "skip-chapter": "已跳过",
      replan: "已重排",
    } as Record<string, string>
  )[outcome ?? ""] ?? "等待中";
}

function findActiveSession(...sessions: Array<AutopilotSession | null | undefined>): AutopilotSession | null {
  const seen = new Set<string>();
  for (const session of sessions) {
    if (!session || seen.has(session.id)) continue;
    seen.add(session.id);
    if (!["completed", "cancelled"].includes(session.status)) return session;
  }
  return null;
}

interface PendingRequest {
  key: string;
  requestId: string;
}

function requestIdFor(
  ref: { current: PendingRequest | null },
  key: string,
): string {
  if (ref.current?.key !== key) {
    ref.current = { key, requestId: crypto.randomUUID() };
  }
  return ref.current.requestId;
}
