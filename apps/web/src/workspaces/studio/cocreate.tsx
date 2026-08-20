import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, RotateCcw, Send, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { ErrorNote } from "../../components/error-note";
import { Skeleton } from "../../components/skeleton";
import {
  adoptStoryRange,
  createCoCreateSession,
  createPersona,
  createStoryBranch,
  generateTurnSwipe,
  getCoCreateSession,
  getCoCreateSessions,
  getPersonas,
  getRunDetail,
  postStoryTurn,
  replaceCoCreateParticipants,
  revertStoryTurn,
  selectStoryBranch,
  selectTurnSwipe,
  updateCoCreateSession,
  updatePersona,
  type CoCreateSession,
  type CoCreateSessionDetail,
  type StoryPersona,
  type StoryTurn,
} from "../../lib/api";
import { projectWorkspacePath } from "../../lib/project-route";

export function CoCreateWorkspace({
  projectId,
  requestedSessionId,
  onSessionChange = () => undefined,
}: {
  projectId: string;
  requestedSessionId?: string | null;
  onSessionChange?: (sessionId: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [localSessionId, setLocalSessionId] = useState<string | null>(null);
  const requestedId = requestedSessionId === undefined
    ? localSessionId
    : requestedSessionId;
  const selectSession = useCallback((sessionId: string | null) => {
    if (requestedSessionId === undefined) setLocalSessionId(sessionId);
    onSessionChange(sessionId);
  }, [onSessionChange, requestedSessionId]);
  const personasQuery = useQuery({ queryKey: ["project", projectId, "personas"], queryFn: ({ signal }) => getPersonas(projectId, signal) });
  const sessionsQuery = useQuery({ queryKey: ["project", projectId, "cocreate", "sessions"], queryFn: ({ signal }) => getCoCreateSessions(projectId, signal) });
  const [showArchivedSessions, setShowArchivedSessions] = useState(false);
  const sessions = useMemo(() => (sessionsQuery.data ?? []).filter((session) => showArchivedSessions || session.status !== "archived"), [sessionsQuery.data, showArchivedSessions]);
  const selectedSessionId = sessions.some((session) => session.id === requestedId)
    ? requestedId
    : sessions[0]?.id ?? null;
  useEffect(() => {
    if (
      requestedSessionId === undefined ||
      sessionsQuery.isPending ||
      selectedSessionId === requestedId
    )
      return;
    onSessionChange(selectedSessionId);
  }, [
    onSessionChange,
    requestedId,
    requestedSessionId,
    selectedSessionId,
    sessionsQuery.isPending,
  ]);
  const detailQuery = useQuery({ queryKey: ["cocreate", "session", selectedSessionId], queryFn: ({ signal }) => getCoCreateSession(selectedSessionId!, signal), enabled: Boolean(selectedSessionId) });
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [watchedRuns, setWatchedRuns] = useState<WatchedRun[]>([]);
  const actionMutation = useMutation({
    mutationFn: (action: CoCreateAction) => action.work(),
    onSuccess: (value, action) => {
      if (value && typeof value === "object") {
        const object = value as { run?: { id?: string }; id?: string; session?: { id?: string }; turn?: { sessionId?: string } };
        if (object.run?.id) {
          const runId = object.run.id;
          const sessionId = object.turn?.sessionId ?? action.sessionId;
          setLastRunId(runId);
          if (sessionId) {
            setWatchedRuns((current) => current.some((item) => item.runId === runId)
              ? current
              : [...current, { runId, sessionId }]);
          }
        }
        if (object.session?.id) selectSession(object.session.id);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "cocreate"] });
      void queryClient.invalidateQueries({ queryKey: ["cocreate", "session", selectedSessionId] });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "personas"] });
    },
  });
  const run = (work: () => Promise<unknown>) => actionMutation.mutate({ work, sessionId: selectedSessionId });
  const personaUnavailable = personasQuery.isError;
  return <div className="cocreate">
    <aside className="cocreate__setup">{personasQuery.isPending ? <Skeleton lines={6} /> : personaUnavailable ? <ErrorNote error={personasQuery.error} title="角色设定暂时无法加载" /> : <><PersonaManager projectId={projectId} personas={personasQuery.data} pending={actionMutation.isPending} onSave={run} /><SessionCreator projectId={projectId} personas={personasQuery.data} pending={actionMutation.isPending} onSave={run} /></>}</aside>
    <main className="cocreate__room"><header><div><p className="mono">CO-CREATE SANDBOX</p><h2>故事房</h2></div><div className="cocreate__room-picker"><select aria-label="选择共创会话" value={selectedSessionId ?? ""} onChange={(event) => selectSession(event.target.value || null)}><option value="">选择会话</option>{sessions.map((session) => <option key={session.id} value={session.id}>{session.title}{session.status === "archived" ? "（已归档）" : ""}</option>)}</select><button type="button" className="btn" onClick={() => setShowArchivedSessions((value) => !value)}>{showArchivedSessions ? "隐藏已归档" : "查看已归档"}</button></div></header>
      {sessionsQuery.isPending || (Boolean(selectedSessionId) && detailQuery.isPending) ? <Skeleton lines={8} /> : sessionsQuery.isError ? <ErrorNote error={sessionsQuery.error} title="共创会话暂时无法加载" /> : detailQuery.isError ? <ErrorNote error={detailQuery.error} title="故事房暂时无法加载" /> : detailQuery.data ? <Room key={detailQuery.data.session.id} detail={detailQuery.data} personas={personasQuery.data ?? []} pending={actionMutation.isPending || personaUnavailable} onRun={run} /> : <p className="cocreate__empty">先创建 Persona，再建立故事房。回合、Swipe 与分支默认只存在于沙盒。</p>}
      {actionMutation.isError ? <ErrorNote error={actionMutation.error} title="共创操作未完成" /> : null}{lastRunId ? <Link className="cocreate__run-link" to={`${projectWorkspacePath(projectId, "runs")}?run=${encodeURIComponent(lastRunId)}`}>查看最近一次生成/采纳运行</Link> : null}
      {watchedRuns.map((item) => <RunCompletionWatcher key={item.runId} projectId={projectId} value={item} onSettled={() => { void queryClient.invalidateQueries({ queryKey: ["cocreate", "session", item.sessionId] }); setWatchedRuns((current) => current.filter((candidate) => candidate.runId !== item.runId)); }} />)}
    </main>
  </div>;
}

const TERMINAL_RUN_STATUSES = new Set(["failed", "cancelled", "completed"]);
interface WatchedRun { runId: string; sessionId: string }
interface CoCreateAction { work: () => Promise<unknown>; sessionId: string | null }

function RunCompletionWatcher({ projectId, value, onSettled }: { projectId: string; value: WatchedRun; onSettled: () => void }) {
  const query = useQuery({
    queryKey: ["run", value.runId],
    queryFn: ({ signal }) => getRunDetail(projectId, value.runId, signal),
    refetchInterval: (state) => state.state.data && TERMINAL_RUN_STATUSES.has(state.state.data.run.status) ? false : 1_500,
  });
  useEffect(() => {
    if (query.data && TERMINAL_RUN_STATUSES.has(query.data.run.status)) onSettled();
  }, [onSettled, query.data]);
  return null;
}

function PersonaManager({ projectId, personas, pending, onSave }: { projectId: string; personas: StoryPersona[]; pending: boolean; onSave: (work: () => Promise<unknown>) => void }) {
  const [selectedId, setSelectedId] = useState("new"); const [showRetired, setShowRetired] = useState(false); const selected = personas.find((persona) => persona.id === selectedId); const visible = personas.filter((persona) => showRetired || persona.status === "active" || persona.id === selectedId);
  return <><PersonaFields key={selectedId} projectId={projectId} personas={visible} selected={selected} pending={pending} onSave={onSave} onSelect={setSelectedId} /><button type="button" className="btn" onClick={() => setShowRetired((value) => !value)}>{showRetired ? "隐藏已退役" : "查看已退役"}</button></>;
}
function PersonaFields({ projectId, personas, selected, pending, onSave, onSelect }: { projectId: string; personas: StoryPersona[]; selected: StoryPersona | undefined; pending: boolean; onSave: (work: () => Promise<unknown>) => void; onSelect: (id: string) => void }) {
  const [kind, setKind] = useState<StoryPersona["kind"]>(selected?.kind ?? "character"); const [name, setName] = useState(selected?.name ?? ""); const [description, setDescription] = useState(selected?.description ?? ""); const [instructions, setInstructions] = useState(selected?.instructions ?? ""); const [status, setStatus] = useState<StoryPersona["status"]>(selected?.status ?? "active");
  return <form className="cocreate__card" onSubmit={(event) => { event.preventDefault(); onSave(() => selected ? updatePersona(selected.id, { kind, entityId: selected.entityId, name, description: description || null, instructions, voice: selected.voice, status, expectedVersion: selected.version }) : createPersona(projectId, { kind, entityId: null, name, description: description || null, instructions, voice: {} })); }}><header><p className="mono">PERSONA</p><h3>角色面具</h3></header><label>编辑对象<select value={selected?.id ?? "new"} onChange={(event) => onSelect(event.target.value)}><option value="new">＋ 新建 Persona</option>{personas.map((persona) => <option key={persona.id} value={persona.id}>{persona.name}{persona.status === "retired" ? "（已退役）" : ""}</option>)}</select></label><label>种类<select value={kind} onChange={(event) => setKind(event.target.value as StoryPersona["kind"])}><option value="author">作者</option><option value="narrator">叙述者</option><option value="character">角色</option></select></label><label>名称<input required value={name} onChange={(event) => setName(event.target.value)} /></label><label>描述<textarea value={description ?? ""} onChange={(event) => setDescription(event.target.value)} /></label><label>行为与声音指令<textarea required value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label>{selected ? <label>状态<select value={status} onChange={(event) => setStatus(event.target.value as StoryPersona["status"])}><option value="active">启用</option><option value="retired">退役</option></select></label> : null}<button type="submit" className="btn btn--primary" disabled={pending || !name.trim() || !instructions.trim()}>{selected ? "更新 Persona" : "创建 Persona"}</button></form>;
}

function SessionCreator({ projectId, personas, pending, onSave }: { projectId: string; personas: StoryPersona[]; pending: boolean; onSave: (work: () => Promise<unknown>) => void }) {
  const [title, setTitle] = useState(""); const [speakerPolicy, setPolicy] = useState<CoCreateSession["speakerPolicy"]>("manual"); const [participantIds, setParticipantIds] = useState<string[]>([]); const [directorNote, setNote] = useState("");
  return <form className="cocreate__card" onSubmit={(event) => { event.preventDefault(); onSave(() => createCoCreateSession(projectId, { title, speakerPolicy, targetOutlineNodeId: null, authorPersonaId: personas.find((persona) => persona.kind === "author")?.id ?? null, directorNote: directorNote || null, contextTurns: 20, participantIds })); }}><header><p className="mono">NEW ROOM</p><h3>建立故事房</h3></header><label>房间名<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>发言策略<select value={speakerPolicy} onChange={(event) => setPolicy(event.target.value as CoCreateSession["speakerPolicy"])}><option value="manual">手动</option><option value="round_robin">轮询</option><option value="auto">自动</option></select></label><label>导演注<textarea value={directorNote} onChange={(event) => setNote(event.target.value)} /></label><fieldset><legend>参与者</legend>{personas.filter((persona) => persona.status === "active").map((persona) => <label key={persona.id}><input type="checkbox" checked={participantIds.includes(persona.id)} onChange={() => setParticipantIds((current) => current.includes(persona.id) ? current.filter((id) => id !== persona.id) : [...current, persona.id])} />{persona.name}</label>)}</fieldset><button type="submit" className="btn btn--primary" disabled={pending || !title.trim() || (speakerPolicy === "manual" && participantIds.length === 0)}>创建故事房</button></form>;
}

function Room({ detail, personas, pending, onRun }: { detail: CoCreateSessionDetail; personas: StoryPersona[]; pending: boolean; onRun: (work: () => Promise<unknown>) => void }) {
  const [turnText, setTurnText] = useState(""); const [speakerId, setSpeakerId] = useState(""); const [branchName, setBranchName] = useState(""); const [branchFrom, setBranchFrom] = useState(""); const [adoptFrom, setAdoptFrom] = useState(""); const [adoptTo, setAdoptTo] = useState(""); const [adoptTitle, setAdoptTitle] = useState("");
  const turnRequestRef = useRef<PendingRequest | null>(null); const adoptionRequestRef = useRef<PendingRequest | null>(null);
  const activeTurns = detail.turns.filter((turn) => turn.status === "active");
  const participantIds = detail.participants.filter((participant) => participant.enabled).map((participant) => participant.personaId);
  const participantPersonaIds = new Set(detail.participants.map((participant) => participant.personaId));
  const visiblePersonas = personas.filter((persona) => persona.status === "active" || participantPersonaIds.has(persona.id));
  const speakerParticipants = detail.participants.filter((participant) => participant.enabled && participant.persona.status === "active");
  const active = detail.session.status === "active";
  return <>
    <div className="cocreate__room-controls"><span>{detail.session.status} · 分支 {detail.branches.length} · 回合 {activeTurns.length}</span>{(["active", "paused", "archived"] as const).map((status) => <button key={status} type="button" className="btn" disabled={pending || detail.session.status === status} onClick={() => onRun(() => updateCoCreateSession(detail.session.id, { status, expectedVersion: detail.session.version }))}>{status}</button>)}</div>
    <fieldset className="cocreate__participants"><legend>参与者</legend>{visiblePersonas.map((persona) => { const selected = participantIds.includes(persona.id); const retired = persona.status === "retired"; return <label key={persona.id}><input type="checkbox" disabled={pending || !active || (retired && !selected)} checked={selected} onChange={() => { const next = selected ? participantIds.filter((id) => id !== persona.id) : [...participantIds, persona.id]; onRun(() => replaceCoCreateParticipants(detail.session.id, detail.session.version, next.map((personaId) => ({ personaId, enabled: true, talkativeness: .5 })))); }} />{persona.name}{retired ? "（已退役，可移除）" : ""}</label>; })}</fieldset>
    <div className="cocreate__turns">{activeTurns.map((turn) => <TurnCard key={turn.id} turn={turn} personas={personas} pending={pending} active={active} onRun={onRun} />)}</div>
    <form className="cocreate__composer" onSubmit={(event) => { event.preventDefault(); if (!active) return; const content = turnText.trim(); const requestId = requestIdFor(turnRequestRef, JSON.stringify({ content, speakerId })); onRun(() => postStoryTurn(detail.session.id, { requestId, role: "user", personaId: null, content, generateReply: true, speakerPersonaId: speakerId || null }).then((result) => { turnRequestRef.current = null; setTurnText(""); return result; })); }}><textarea disabled={!active} value={turnText} onChange={(event) => setTurnText(event.target.value)} placeholder="写下一回合；生成回复仍留在沙盒。" /><select disabled={!active} value={speakerId} onChange={(event) => setSpeakerId(event.target.value)}><option value="">由策略选发言者</option>{speakerParticipants.map((participant) => <option key={participant.personaId} value={participant.personaId}>{participant.persona.name}</option>)}</select><button type="submit" className="btn btn--primary" disabled={pending || !active || !turnText.trim() || (detail.session.speakerPolicy === "manual" && !speakerId)}><Send size={12} />发送并生成回复</button></form>
    <section className="cocreate__branch-tools"><h3>分支</h3><select disabled={!active} value={detail.session.activeBranchId ?? ""} onChange={(event) => onRun(() => selectStoryBranch(detail.session.id, event.target.value, detail.session.version))}>{detail.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select><select disabled={!active} value={branchFrom} onChange={(event) => setBranchFrom(event.target.value)}><option value="">从回合分叉</option>{activeTurns.map((turn) => <option key={turn.id} value={turn.id}>#{turn.ordinal} {turn.content.slice(0, 24)}</option>)}</select><input disabled={!active} value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder="分支名" /><button type="button" className="btn" disabled={pending || !active || !branchFrom || !branchName.trim()} onClick={() => onRun(() => createStoryBranch(detail.session.id, branchFrom, branchName.trim(), detail.session.version))}><GitBranch size={12} />建分支</button></section>
    <section className="cocreate__adopt"><h3>范围采纳为正式场景</h3><p>只有这个动作会把沙盒内容送入正式稿件与候选正典流程。</p><select disabled={!active} value={adoptFrom} onChange={(event) => setAdoptFrom(event.target.value)}><option value="">起始回合</option>{activeTurns.map((turn) => <option key={turn.id} value={turn.id}>#{turn.ordinal}</option>)}</select><select disabled={!active} value={adoptTo} onChange={(event) => setAdoptTo(event.target.value)}><option value="">结束回合</option>{activeTurns.map((turn) => <option key={turn.id} value={turn.id}>#{turn.ordinal}</option>)}</select><input disabled={!active} value={adoptTitle} onChange={(event) => setAdoptTitle(event.target.value)} placeholder="正式场景标题" /><button type="button" className="btn btn--primary" disabled={pending || !active || !detail.session.activeBranchId || !adoptFrom || !adoptTo || !adoptTitle.trim()} onClick={() => { const input = { branchId: detail.session.activeBranchId!, fromTurnId: adoptFrom, toTurnId: adoptTo, title: adoptTitle.trim() }; const requestId = requestIdFor(adoptionRequestRef, JSON.stringify(input)); onRun(() => adoptStoryRange(detail.session.id, { requestId, ...input }).then((result) => { adoptionRequestRef.current = null; return result; })); }}>采纳范围</button></section>
  </>;
}

function TurnCard({ turn, personas, pending, active, onRun }: { turn: StoryTurn; personas: StoryPersona[]; pending: boolean; active: boolean; onRun: (work: () => Promise<unknown>) => void }) {
  const swipeRequestRef = useRef<PendingRequest | null>(null);
  const speaker = personas.find((persona) => persona.id === turn.personaId)?.name ?? turn.role;
  return <article className="cocreate__turn"><header><strong>#{turn.ordinal} · {speaker}</strong><span>{turn.status}</span></header><p>{turn.content}</p>{turn.swipes.length ? <div className="cocreate__swipes">{turn.swipes.map((swipe) => <button key={swipe.id} type="button" className="btn" data-selected={swipe.id === turn.selectedSwipeId} disabled={pending || !active || swipe.id === turn.selectedSwipeId} onClick={() => onRun(() => selectTurnSwipe(turn.id, swipe.id))}>{swipe.ordinal + 1}. {swipe.content}</button>)}</div> : null}<div className="cocreate__turn-actions">{turn.role === "assistant" ? <button type="button" className="btn" disabled={pending || !active} onClick={() => { const requestId = requestIdFor(swipeRequestRef, turn.personaId ?? "auto"); onRun(() => generateTurnSwipe(turn.id, requestId, turn.personaId).then((result) => { swipeRequestRef.current = null; return result; })); }}><Sparkles size={11} />再生 Swipe</button> : null}<button type="button" className="btn" disabled={pending || !active || turn.ordinal === 0} onClick={() => onRun(() => revertStoryTurn(turn.id))}><RotateCcw size={11} />回退到此</button></div></article>;
}

interface PendingRequest { key: string; requestId: string }
function requestIdFor(ref: { current: PendingRequest | null }, key: string): string { if (ref.current?.key !== key) ref.current = { key, requestId: crypto.randomUUID() }; return ref.current.requestId; }
