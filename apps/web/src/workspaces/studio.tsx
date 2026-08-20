import "../styles/studio.css";
import "../styles/review.css";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Check,
  MessageSquarePlus,
  Plus,
  Save,
  Sparkles,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { ConfirmDialog } from "../components/confirm-dialog";
import { publishAssistantContext } from "../app/assistant-page-context";
import { Empty } from "../components/empty";
import { ErrorNote } from "../components/error-note";
import { PageBand } from "../components/page-band";
import { ProjectRequiredState } from "../components/project-required-state";
import { Skeleton } from "../components/skeleton";
import {
  appendDocumentVersion,
  ApiError,
  createChapterRun,
  createDocumentReview,
  createDocumentComment,
  createSelectionEdit,
  createStoryDocument,
  decideCanonChangeSet,
  decideEditProposal,
  decideReviewIssue,
  decideRevisionProposal,
  getCanonChangeSets,
  getProjectOverview,
  getProjectRuns,
  getRunDetail,
  getReviewWorkspace,
  getStoryBible,
  getStudioDocument,
  getStudioDocuments,
  restoreDocumentVersion,
  saveDocumentDraft,
  setStoryDocumentArchived,
  setDocumentCommentStatus,
  type CanonChangeSetView,
  type DocumentComment,
  type DocumentDraft,
  type DocumentVersion,
  type EditProposal,
  type OutlineNode,
  type ReviewRevisionProposal,
  type ReviewWorkspace,
  type ReviewWorkspaceIssue,
  type ReviewWorkspaceReport,
  type StoryDocument,
  type StudioDocumentDetail,
} from "../lib/api";
import { formatRelativeDate } from "../lib/fmt";
import {
  documentKindLabel,
  reviewCategoryLabel,
  reviewIssueActionLabel,
  reviewIssueStatusLabel,
  reviewVerdictLabel,
} from "../lib/labels";
import { projectWorkspacePath, useProjectId } from "../lib/project-route";
import { useServerEvents } from "../lib/sse";
import { rememberTask, rememberedTasks } from "../lib/task-ledger";
import { CoCreateWorkspace } from "./studio/cocreate";
import { WritingTaskPanel } from "./studio/task-panel";

type CreateDocumentInput = {
  kind: StoryDocument["kind"];
  title: string;
  outlineNodeId: string | null;
};

type FlushDraft = () => Promise<boolean>;

type StudioTool =
  | "review"
  | "revisions"
  | "canon"
  | "comments"
  | "versions"
  | "selection";

const STUDIO_TOOLS: Array<{ id: StudioTool; label: string }> = [
  { id: "review", label: "审稿" },
  { id: "revisions", label: "修订" },
  { id: "canon", label: "故事变化" },
  { id: "comments", label: "批注" },
  { id: "versions", label: "版本" },
  { id: "selection", label: "选区" },
];

function studioToolFromFocus(value: string | null): StudioTool {
  if (value === "canon") return "canon";
  if (value === "revisions") return "revisions";
  if (value === "comments") return "comments";
  if (value === "versions") return "versions";
  if (value === "selection") return "selection";
  return "review";
}

export function StudioWorkspace() {
  const projectId = useProjectId();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [showRecycle, setShowRecycle] = useState(false);
  const mode = searchParams.get("mode") === "cocreate" ? "cocreate" : "manual";
  const requestedSessionId = searchParams.get("session");
  const flushDraftRef = useRef<FlushDraft | null>(null);
  const createRequestRef = useRef<{ identity: string; requestId: string } | null>(null);
  useServerEvents({
    onRunStatus: (_runId, status) => {
      if (status !== "completed" || !projectId) return;
      void queryClient.invalidateQueries({
        queryKey: ["project", projectId, "studio"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["project", projectId, "review"],
      });
    },
  }, Boolean(projectId));
  const documentsQuery = useQuery({
    queryKey: ["project", projectId, "studio", "documents"],
    queryFn: ({ signal }) => getStudioDocuments(projectId!, signal),
    enabled: Boolean(projectId),
  });
  const documents = useMemo(() => documentsQuery.data ?? [], [documentsQuery.data]);
  const recycledDocumentsQuery = useQuery({
    queryKey: ["project", projectId, "studio", "documents", "recycle"],
    queryFn: ({ signal }) => getStudioDocuments(projectId!, signal, true),
    enabled: Boolean(projectId && showRecycle),
  });
  const listedDocuments = useMemo(
    () => showRecycle
      ? (recycledDocumentsQuery.data ?? []).filter((document) => Boolean(document.archivedAt))
      : documents,
    [documents, recycledDocumentsQuery.data, showRecycle],
  );
  const reviewQuery = useQuery({
    queryKey: ["project", projectId, "review"],
    queryFn: ({ signal }) => getReviewWorkspace(projectId!, signal),
    enabled: Boolean(projectId),
  });
  const documentQuality = useMemo(
    () => currentDocumentQuality(documents, reviewQuery.data?.reports ?? []),
    [documents, reviewQuery.data?.reports],
  );
  const overviewQuery = useQuery({
    queryKey: ["project", projectId, "overview"],
    queryFn: ({ signal }) => getProjectOverview(projectId!, signal),
    enabled: Boolean(projectId),
    refetchInterval: (query) => query.state.data?.activeTask ? 3_000 : false,
  });
  const requestedDocumentId = searchParams.get("document");
  const requestedOutlineId = searchParams.get("outline");
  const selectedRunId = searchParams.get("run");
  const [dismissedRunId, setDismissedRunId] = useState<string | null>(null);
  const focusTarget = searchParams.get("focus");
  const requestedDocument = requestedDocumentId
    ? listedDocuments.find((document) => document.id === requestedDocumentId)
    : undefined;
  const outlineDocument = requestedOutlineId
    ? listedDocuments.find((document) => document.outlineNodeId === requestedOutlineId)
    : undefined;
  const requestedTargetDocumentId = requestedDocument?.id ?? outlineDocument?.id ?? null;
  const rememberedChapterTasks = useMemo(() => {
    if (!projectId) return [];
    const documentIds = new Set(documents.map((document) => document.id));
    return rememberedTasks(projectId).filter(
      (task) =>
        task.kind === "chapter" &&
        Boolean(task.documentId && documentIds.has(task.documentId)),
    );
  }, [documents, projectId]);
  const overviewTask = overviewQuery.data?.activeTask?.kind === "chapter"
    ? overviewQuery.data.activeTask
    : null;
  const overviewTaskDocumentId = overviewTask?.targetChapter?.documentId ??
    rememberedChapterTasks.find((task) => task.taskId === overviewTask?.id)?.documentId ??
    null;
  const restoreTask = selectedRunId
    ? null
    : requestedTargetDocumentId
      ? overviewTask && overviewTaskDocumentId === requestedTargetDocumentId
        ? { taskId: overviewTask.id, documentId: requestedTargetDocumentId }
        : rememberedChapterTasks.find(
            (task) => task.documentId === requestedTargetDocumentId,
          ) ?? null
      : overviewTask && overviewTaskDocumentId
        ? { taskId: overviewTask.id, documentId: overviewTaskDocumentId }
        : rememberedChapterTasks[0] ?? null;
  const restoreCandidateRunId = restoreTask?.taskId ?? null;
  const restoreRunQuery = useQuery({
    queryKey: ["project", projectId, "studio", "restore-run", restoreCandidateRunId],
    queryFn: ({ signal }) => getRunDetail(projectId!, restoreCandidateRunId!, signal),
    enabled: Boolean(projectId && restoreCandidateRunId),
    retry: false,
  });
  const canRestoreRun = restoreRunQuery.data?.run.recipe === "chapter-production" &&
    !["completed", "cancelled"].includes(restoreRunQuery.data.run.status);
  const activeDocumentId = requestedTargetDocumentId ??
    (showRecycle ? listedDocuments[0]?.id ?? null :
    (canRestoreRun ? restoreTask?.documentId : null) ??
    listedDocuments[0]?.id ??
    null);
  const restoredRunId = restoreCandidateRunId !== dismissedRunId &&
    restoreTask?.documentId === activeDocumentId &&
    canRestoreRun
    ? restoreCandidateRunId
    : null;
  const effectiveRunId = selectedRunId ?? restoredRunId;
  const updateWorkspaceParams = useCallback((updates: { document?: string | null; outline?: string | null; run?: string | null; mode?: string | null; session?: string | null }) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(updates)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    }, { replace: false });
  }, [setSearchParams]);
  useEffect(() => {
    if (requestedOutlineId && !documentsQuery.isPending && !outlineDocument) {
      queueMicrotask(() => setCreating(true));
    }
  }, [documentsQuery.isPending, outlineDocument, requestedOutlineId]);
  const storyQuery = useQuery({
    queryKey: ["project", projectId, "story-bible"],
    queryFn: ({ signal }) => getStoryBible(projectId!, signal),
    enabled: Boolean(projectId && creating),
  });
  const availableOutlineNodes = useMemo(() => {
    const used = new Set(storyQuery.data?.occupiedOutlineNodeIds ?? []);
    return (storyQuery.data?.outline ?? []).filter(
      (node) =>
        (node.kind === "chapter" || node.kind === "scene") &&
        !used.has(node.id),
    );
  }, [storyQuery.data]);
  const detailQuery = useQuery({
    queryKey: ["project", projectId, "studio", "document", activeDocumentId],
    queryFn: ({ signal }) => getStudioDocument(projectId!, activeDocumentId!, signal),
    enabled: Boolean(projectId && activeDocumentId && !showRecycle),
  });
  const archiveMutation = useMutation({
    mutationFn: ({ document, archived }: { document: StoryDocument; archived: boolean }) =>
      setStoryDocumentArchived(document, archived),
    onSuccess: () => {
      updateWorkspaceParams({ document: null, outline: null, run: null });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "studio", "documents"] });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "studio", "document"] });
    },
  });
  const createMutation = useMutation({
    mutationFn: async (input: CreateDocumentInput) => {
      const ready = await flushDraftRef.current?.();
      if (ready === false) throw new Error("当前稿件尚未同步，请先重试保存");
      const identity = JSON.stringify(input);
      if (createRequestRef.current?.identity !== identity) {
        createRequestRef.current = {
          identity,
          requestId: crypto.randomUUID(),
        };
      }
      return createStoryDocument(projectId!, {
        ...input,
        requestId: createRequestRef.current.requestId,
      });
    },
    onSuccess: (document) => {
      createRequestRef.current = null;
      setCreating(false);
      updateWorkspaceParams({ document: document.id, outline: null, run: null });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "studio", "documents"] });
    },
  });
  const registerFlush = useCallback((flush: FlushDraft | null) => {
    flushDraftRef.current = flush;
  }, []);
  if (!projectId) {
    return (
      <div className="studio">
        <ProjectRequiredState
          seal="稿"
          title="写作"
          description="选定作品后，在这里写正文、审稿修订，并管理候选稿和历史版本。"
        />
      </div>
    );
  }
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["project", projectId, "studio", "documents"] });
    void queryClient.invalidateQueries({ queryKey: ["project", projectId, "studio", "document", activeDocumentId] });
  };
  const selectDocument = async (nextDocumentId: string) => {
    if (nextDocumentId === activeDocumentId) return;
    const ready = await flushDraftRef.current?.();
    if (ready !== false) {
      setDismissedRunId(null);
      updateWorkspaceParams({ document: nextDocumentId, outline: null, run: null });
    }
  };
  const selectMode = async (nextMode: "manual" | "cocreate") => {
    if (nextMode === mode) return;
    if (mode === "manual") {
      const ready = await flushDraftRef.current?.();
      if (ready === false) return;
    }
    updateWorkspaceParams({
      mode: nextMode === "cocreate" ? "cocreate" : null,
      session: nextMode === "manual" ? null : requestedSessionId,
    });
  };
  return <div className="studio">
    <PageBand
      index="DESK · 04"
      title="写作台"
      meta={
        <div className="studio__mode-switch" role="group" aria-label="写作模式">
          <button type="button" aria-pressed={mode === "manual"} onClick={() => void selectMode("manual")}>手动稿件</button>
          <button type="button" aria-pressed={mode === "cocreate"} onClick={() => void selectMode("cocreate")}>共创沙盒</button>
        </div>
      }
    />
    {mode === "cocreate" ? <CoCreateWorkspace projectId={projectId} requestedSessionId={requestedSessionId} onSessionChange={(sessionId) => updateWorkspaceParams({ mode: "cocreate", session: sessionId })} /> : documentsQuery.isPending ? <StudioLoading /> : documentsQuery.isError ? <ErrorNote error={documentsQuery.error} title="稿目暂时无法加载" /> : <div className="studio__layout">
      <aside className="studio__docs"><header className="studio__docs-head"><p className="studio__docs-title">{showRecycle ? "回收站" : "稿目"}</p><div><button type="button" className="studio__text-button" onClick={() => { setShowRecycle((value) => !value); setCreating(false); }}>{showRecycle ? "返回稿目" : "回收站"}</button>{!showRecycle ? <button type="button" className="studio__text-button" onClick={() => setCreating((value) => !value)}><Plus size={12} />新建</button> : null}</div></header>
        {creating ? <CreateDocumentForm initialOutlineNodeId={requestedOutlineId} outlineNodes={availableOutlineNodes} outlinePending={storyQuery.isPending} pending={createMutation.isPending} error={createMutation.error ?? storyQuery.error} onCancel={() => setCreating(false)} onOpenRecycle={() => { setCreating(false); setShowRecycle(true); }} onSubmit={(input) => createMutation.mutate(input)} /> : null}
        <div className="studio__docs-list">{listedDocuments.map((document) => {
          const quality = documentQuality.get(document.id);
          return <button key={document.id} type="button" className="studio__doc-link" data-active={document.id === activeDocumentId} onClick={() => void selectDocument(document.id)}><span className="studio__doc-link-title">{document.title}</span><span className="studio__doc-link-meta">{documentKindLabel(document.kind)} · {formatRelativeDate(document.updatedAt)}{quality ? <span className="studio__quality-mark" data-quality={quality}>{quality === "pass" ? "已审" : quality === "revise" ? "待复看" : "已阻断"}</span> : null}</span></button>;
        })}</div>
        {listedDocuments.length === 0 && !creating ? <p className="studio__empty-note">{showRecycle ? "回收站还是空的。" : "还没有稿件；直接在这里创建第一章。"}</p> : null}
      </aside>
      {showRecycle ? <RecycleDesk document={listedDocuments.find((document) => document.id === activeDocumentId)} pending={archiveMutation.isPending} error={archiveMutation.error} onRestore={(document) => { setShowRecycle(false); updateWorkspaceParams({ document: null, outline: null, run: null }); archiveMutation.mutate({ document, archived: false }); }} /> : <StudioDesk key={detailQuery.data?.document.id ?? "pending"} projectId={projectId} detail={detailQuery.data} pending={Boolean(activeDocumentId) && detailQuery.isPending} error={detailQuery.error ?? archiveMutation.error} review={reviewQuery.data} reviewPending={reviewQuery.isPending} reviewError={reviewQuery.error} focusTarget={focusTarget} runId={effectiveRunId} onRunChange={(runId) => { setDismissedRunId(null); updateWorkspaceParams({ document: activeDocumentId, outline: null, run: runId }); }} onDismissRun={() => { if (effectiveRunId) setDismissedRunId(effectiveRunId); updateWorkspaceParams({ run: null }); }} onCreateDocument={() => setCreating(true)} onArchive={async (document) => { const ready = await flushDraftRef.current?.(); if (ready !== false) archiveMutation.mutate({ document, archived: true }); }} onRefresh={refresh} onFlushReady={registerFlush} />}
    </div>}
  </div>;
}

function StudioLoading() {
  return <div className="studio__layout studio__loading" aria-busy="true" aria-label="正在展开写作台">
    <aside className="studio__loading-docs"><span /><span /><span /><span /></aside>
    <main className="studio__loading-paper"><div className="studio__loading-title" /><div className="studio__loading-lines">{Array.from({ length: 9 }, (_, index) => <span key={index} />)}</div></main>
    <aside className="studio__loading-tools"><span /><span /><span /></aside>
  </div>;
}

function CreateDocumentForm({ initialOutlineNodeId, outlineNodes, outlinePending, pending, error, onCancel, onOpenRecycle, onSubmit }: { initialOutlineNodeId: string | null; outlineNodes: OutlineNode[]; outlinePending: boolean; pending: boolean; error: unknown; onCancel: () => void; onOpenRecycle: () => void; onSubmit: (input: CreateDocumentInput) => void }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<StoryDocument["kind"]>("chapter");
  const [outlineNodeId, setOutlineNodeId] = useState(initialOutlineNodeId ?? "");
  const requiresOutline = kind === "chapter" || kind === "scene";
  const matchingNodes = outlineNodes.filter((node) => node.kind === kind);
  const selectedNode = matchingNodes.find((node) => node.id === outlineNodeId) ?? matchingNodes[0] ?? null;
  const resolvedTitle = title.trim() || selectedNode?.title || "";
  return <form className="studio__inline-form" onSubmit={(event) => { event.preventDefault(); if (!resolvedTitle || (requiresOutline && !selectedNode)) return; onSubmit({ kind, title: resolvedTitle, outlineNodeId: requiresOutline ? selectedNode!.id : null }); }}><label>类型<select value={kind} onChange={(event) => { setKind(event.target.value as StoryDocument["kind"]); setOutlineNodeId(""); }}><option value="chapter">章节正文</option><option value="scene">场景正文</option><option value="outline">大纲稿</option><option value="synopsis">故事梗概</option><option value="note">写作笔记</option><option value="style-sample">风格样本</option></select></label>{requiresOutline ? <label>对应大纲<select aria-label="对应大纲节点" value={selectedNode?.id ?? ""} disabled={outlinePending || matchingNodes.length === 0} onChange={(event) => setOutlineNodeId(event.target.value)}>{outlinePending ? <option value="">读取大纲…</option> : matchingNodes.length === 0 ? <option value="">没有可绑定的{kind === "chapter" ? "章节" : "场景"}</option> : matchingNodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select></label> : null}<label>标题<input value={title} placeholder={selectedNode?.title ?? "给这件稿件题名"} onChange={(event) => setTitle(event.target.value)} /></label>{requiresOutline && !outlinePending && matchingNodes.length === 0 ? <div className="studio__form-note"><p>请先在“故事”里建立对应大纲；已绑定或已归档正文的节点不会重复出现。</p><button type="button" className="btn" onClick={onOpenRecycle}>打开稿件回收站</button></div> : null}{error ? <ErrorNote error={error} title="稿件未创建" /> : null}<div className="studio__inline-form-actions"><button type="button" className="btn" onClick={onCancel}>取消</button><button type="submit" className="btn btn--primary" disabled={pending || outlinePending || !resolvedTitle || (requiresOutline && !selectedNode)}>创建</button></div></form>;
}

function RecycleDesk({ document, pending, error, onRestore }: { document: StoryDocument | undefined; pending: boolean; error: unknown; onRestore: (document: StoryDocument) => void }) {
  if (!document) return <main className="studio__desk studio__desk--empty"><Empty title="回收站是空的" description="移入回收站的章节会暂时保留在这里，可以随时恢复。" /></main>;
  return <main className="studio__desk studio__desk--empty"><div className="studio__recycle-card"><span className="mono">RECYCLE BIN</span><h2>{document.title}</h2><p>{documentKindLabel(document.kind)} · 移入回收站于 {document.archivedAt?.slice(0, 16) ?? "—"}</p><p>回收站中的稿件不会参与新的写作、审稿或导出任务；恢复后会回到稿目。</p><button type="button" className="btn btn--primary" disabled={pending} onClick={() => onRestore(document)}><ArchiveRestore size={13} />{pending ? "恢复中…" : "恢复到稿目"}</button>{error ? <ErrorNote error={error} title="稿件未恢复" /> : null}</div></main>;
}

function StudioDesk({ projectId, detail, pending, error, review, reviewPending, reviewError, focusTarget, runId, onRunChange, onDismissRun, onCreateDocument, onArchive, onRefresh, onFlushReady }: { projectId: string; detail: StudioDocumentDetail | undefined; pending: boolean; error: unknown; review: ReviewWorkspace | undefined; reviewPending: boolean; reviewError: unknown; focusTarget: string | null; runId: string | null; onRunChange: (runId: string) => void; onDismissRun: () => void; onCreateDocument: () => void; onArchive: (document: StoryDocument) => void | Promise<void>; onRefresh: () => void; onFlushReady: (flush: FlushDraft | null) => void }) {
  const initialContent = detail?.draft?.content ?? detail?.currentVersion?.content ?? "";
  const [content, setContent] = useState(initialContent);
  const [draftSavedContent, setDraftSavedContent] = useState(initialContent);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [commentBody, setCommentBody] = useState("");
  const [editInstruction, setEditInstruction] = useState("");
  const [restoreTarget, setRestoreTarget] = useState<DocumentVersion | null>(null);
  const [taskNotice, setTaskNotice] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [toolSelection, setToolSelection] = useState(() => ({
    focusTarget,
    tool: studioToolFromFocus(focusTarget),
  }));
  const activeTool = toolSelection.focusTarget === focusTarget
    ? toolSelection.tool
    : studioToolFromFocus(focusTarget);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const contentRef = useRef(content);
  const savedContentRef = useRef(draftSavedContent);
  const latestDraftRef = useRef<DocumentDraft | null>(detail?.draft ?? null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const autosaveTimerRef = useRef<number | null>(null);
  const aiRequestRef = useRef<{ identity: string; requestId: string } | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const selected =
      selection.end > selection.start
        ? content.slice(selection.start, selection.end).slice(0, 40_000)
        : null;
    publishAssistantContext({
      documentId: detail?.document.id ?? null,
      outlineNodeId: detail?.document.outlineNodeId ?? null,
      selection: selected
        ? { start: selection.start, end: selection.end, text: selected }
        : null,
    });
  }, [content, detail?.document.id, detail?.document.outlineNodeId, selection]);

  const draftMutation = useMutation({
    mutationFn: (value: string) => saveDocumentDraft(projectId, detail!.document.id, { content: value, baseVersionId: detail!.document.currentVersionId, expectedDraftUpdatedAt: latestDraftRef.current?.updatedAt ?? null }),
    onSuccess: (draft, value) => {
      latestDraftRef.current = draft;
      savedContentRef.current = value;
      setDraftSavedContent(value);
      if (detail) {
        queryClient.setQueryData<StudioDocumentDetail>(
          ["project", projectId, "studio", "document", detail.document.id],
          (current) => current ? { ...current, draft } : current,
        );
      }
    },
  });
  const mutateDraft = draftMutation.mutateAsync;
  const persistDraft = useCallback((value: string): Promise<DocumentDraft | null> => {
    const perform = () => mutateDraft(value);
    const queued = saveQueueRef.current.then(perform, perform);
    saveQueueRef.current = queued.then(() => undefined, () => undefined);
    return queued;
  }, [mutateDraft]);
  const cancelScheduledAutosave = useCallback(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }, []);
  const flushDraft = useCallback(async (): Promise<boolean> => {
    if (!detail) return true;
    cancelScheduledAutosave();
    await saveQueueRef.current;
    const value = contentRef.current;
    if (value === savedContentRef.current) return true;
    try {
      await persistDraft(value);
      return true;
    } catch {
      return false;
    }
  }, [cancelScheduledAutosave, detail, persistDraft]);
  useEffect(() => {
    if (!detail || content === draftSavedContent) return;
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void persistDraft(content).catch(() => undefined);
    }, 700);
    return cancelScheduledAutosave;
  }, [cancelScheduledAutosave, content, detail, draftSavedContent, persistDraft]);
  // 正式版本身份或服务端草稿变化（历史恢复、AI 候选采纳、其他标签页写入）时，
  // 编辑器必须重新装载新正文；本地有未保存编辑时不覆盖，留待草稿保存冲突显式暴露。
  const detailContentIdentity = detail
    ? `${detail.document.id}·${detail.document.currentVersionId ?? "none"}·${detail.draft?.contentHash ?? "none"}·${detail.draft?.updatedAt ?? "none"}`
    : null;
  const syncedIdentityRef = useRef(detailContentIdentity);
  useEffect(() => {
    if (!detail || detailContentIdentity === null) return;
    if (detailContentIdentity === syncedIdentityRef.current) return;
    syncedIdentityRef.current = detailContentIdentity;
    latestDraftRef.current = detail.draft;
    if (contentRef.current !== savedContentRef.current) return;
    cancelScheduledAutosave();
    const next = detail.draft?.content ?? detail.currentVersion?.content ?? "";
    contentRef.current = next;
    savedContentRef.current = next;
    setContent(next);
    setDraftSavedContent(next);
  }, [cancelScheduledAutosave, detail, detailContentIdentity]);
  useEffect(() => {
    onFlushReady(flushDraft);
    return () => onFlushReady(null);
  }, [flushDraft, onFlushReady]);
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (content !== draftSavedContent || draftMutation.isPending || draftMutation.isError) event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [content, draftSavedContent, draftMutation.isPending, draftMutation.isError]);
  const versionMutation = useMutation({
    mutationFn: async () => {
      cancelScheduledAutosave();
      await saveQueueRef.current;
      return appendDocumentVersion(projectId, detail!.document.id, { content, source: "manual", expectedCurrentVersionId: detail!.document.currentVersionId });
    },
    onSuccess: () => {
      latestDraftRef.current = null;
      savedContentRef.current = content;
      setDraftSavedContent(content);
      onRefresh();
    },
  });
  const restoreMutation = useMutation({
    mutationFn: (version: DocumentVersion) => restoreDocumentVersion(projectId, detail!.document.id, version.id, detail!.document.currentVersionId),
    onSuccess: () => { setRestoreTarget(null); onRefresh(); },
  });
  const commentMutation = useMutation({
    mutationFn: async () => {
      cancelScheduledAutosave();
      await saveQueueRef.current;
      const selectedContent = content;
      let version = detail!.currentVersion;
      if (!version || version.content !== selectedContent) {
        version = await appendDocumentVersion(projectId, detail!.document.id, {
          content: selectedContent,
          source: "manual:comment-checkpoint",
          expectedCurrentVersionId: detail!.document.currentVersionId,
        });
        latestDraftRef.current = null;
        savedContentRef.current = selectedContent;
        setDraftSavedContent(selectedContent);
      }
      return createDocumentComment(projectId, detail!.document.id, { versionId: version.id, startOffset: selection.start, endOffset: selection.end, quote: selectedContent.slice(selection.start, selection.end), body: commentBody.trim() });
    },
    onSuccess: () => { setCommentBody(""); onRefresh(); },
  });
  const statusMutation = useMutation({ mutationFn: (comment: DocumentComment) => setDocumentCommentStatus(comment.id, comment.status === "open" ? "resolved" : "open"), onSuccess: onRefresh });
  const editMutation = useMutation({
    mutationFn: async () => {
      cancelScheduledAutosave();
      await saveQueueRef.current;
      let baseVersionId = detail!.currentVersion?.id ?? null;
      let draftContentHash: string | null = null;
      if (!baseVersionId) {
        const version = await appendDocumentVersion(projectId, detail!.document.id, {
          content,
          source: "manual:selection-baseline",
          expectedCurrentVersionId: null,
        });
        baseVersionId = version.id;
        latestDraftRef.current = null;
        savedContentRef.current = content;
        setDraftSavedContent(content);
      } else {
        const syncedDraft = content === savedContentRef.current
          ? latestDraftRef.current
          : await persistDraft(content);
        draftContentHash = syncedDraft?.contentHash ?? null;
      }
      return createSelectionEdit(projectId, detail!.document.id, { baseVersionId, draftContentHash, selectionStart: selection.start, selectionEnd: selection.end, instruction: editInstruction.trim() });
    },
    onSuccess: () => {
      latestDraftRef.current = null;
      savedContentRef.current = content;
      setDraftSavedContent(content);
      setEditInstruction("");
      onRefresh();
    },
  });
  const proposalMutation = useMutation({ mutationFn: (input: { proposal: EditProposal; action: "accept" | "reject" }) => decideEditProposal(input.proposal.id, input.action), onSuccess: onRefresh });

  /* 单章「交给 AI」：区别于多章 AI 快速创作（自动驾驶航次）；发起一个 chapter run。 */
  const aiMutation = useMutation({
    mutationFn: () => {
      const input = {
        targetOutlineNodeId: detail!.document.outlineNodeId!,
        planningMode: "auto" as const,
        origin: {
          surface: "writing" as const,
          documentId: detail!.document.id,
        },
        maxRevisionCycles: 2,
      };
      const identity = JSON.stringify(input);
      if (aiRequestRef.current?.identity !== identity) {
        aiRequestRef.current = {
          identity,
          requestId: crypto.randomUUID(),
        };
      }
      return createChapterRun(projectId, {
        ...input,
        requestId: aiRequestRef.current.requestId,
      });
    },
    onSuccess: (created) => {
      aiRequestRef.current = null;
      rememberTask({
        projectId,
        kind: "chapter",
        taskId: created.run.id,
        label: `交给 AI：《${detail!.document.title}》`,
        createdAt: new Date().toISOString(),
        origin: { surface: "writing", documentId: detail!.document.id },
        documentId: detail!.document.id,
      });
      onRunChange(created.run.id);
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "runs"] });
    },
  });

  if (pending) return <main className="studio__desk"><Skeleton lines={8} /></main>;
  if (error) return <main className="studio__desk"><ErrorNote error={error} title="稿纸暂时无法加载" /></main>;
  if (!detail) return <main className="studio__desk studio__desk--empty"><Empty title="稿纸还未开卷" description="新建一件自由稿件，或先去故事页规划章节。" action={<div className="studio__empty-actions"><button type="button" className="btn btn--primary" onClick={onCreateDocument}><Plus size={13} />新建第一件稿件</button><Link to={projectWorkspacePath(projectId, "bible")}>去故事页规划章节</Link></div>} /></main>;
  const hasSelection = selection.end > selection.start;
  const selectionNeedsCheckpoint = detail.currentVersion?.content !== content;
  const aiReady =
    detail.document.kind === "chapter" &&
    detail.document.outlineNodeId !== null;
  const anyError = versionMutation.error ?? draftMutation.error ?? commentMutation.error ?? editMutation.error ?? proposalMutation.error ?? statusMutation.error ?? aiMutation.error;
  const activeToolLabel =
    STUDIO_TOOLS.find((tool) => tool.id === activeTool)?.label ?? "写作工具";
  const toolCount = (tool: StudioTool): number | null => {
    if (tool === "comments") return detail.comments.length;
    if (tool === "versions") return detail.versions.length;
    if (tool === "selection") return detail.proposals.length;
    return null;
  };
  return <>
    <main className="studio__desk">
      <header className="studio__desk-head"><p className="studio__desk-title">{detail.document.title}</p><span className="studio__desk-tag">{detail.versions.length} 版</span><span className="studio__desk-meta mono">{content === draftSavedContent && !draftMutation.isPending ? "草稿已同步" : draftMutation.isPending ? "草稿同步中…" : "草稿未同步"}</span><button type="button" className="studio__text-button" onClick={() => setArchiveOpen(true)}><Archive size={12} />移入回收站</button></header>
      {runId ? <WritingTaskPanel projectId={projectId} runId={runId} onRunChange={onRunChange} onDismiss={onDismissRun} onAccepted={() => { setTaskNotice("候选正文已采纳为正式版本；后续故事变化会继续在任务与故事变化中提示。"); onDismissRun(); }} onRefreshDocument={onRefresh} /> : null}
      {taskNotice ? <p className="studio__task-accepted" role="status"><Check size={13} aria-hidden="true" />{taskNotice}<button type="button" aria-label="关闭采纳提示" onClick={() => setTaskNotice(null)}>×</button></p> : null}
      <div className="studio__desk-editor">{content.length === 0 ? <div className="studio__blank-page-note"><span className="mono">OPENING · 空白稿纸</span><strong>从一个具体的画面开始</strong><p>{aiReady ? "写下一句对白、一个动作，或把本章交给下方的 AI 起草。" : "写下一句对白、一个动作，或一段尚未确定的想法。"}</p></div> : null}<textarea ref={textareaRef} className="studio__desk-textarea" aria-label="Markdown 正文编辑器" value={content} onChange={(event) => { contentRef.current = event.currentTarget.value; setContent(event.currentTarget.value); }} onSelect={(event) => setSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })} placeholder="从这里开始写。" />
        {anyError ? <ErrorNote error={anyError} title="写作台操作未完成；你的本地内容仍保留" /> : null}
        {versionMutation.isSuccess ? <p className="studio__saved-note" role="status">版本已写入</p> : null}
        <div className="studio__desk-foot"><span className="studio__desk-stat">{content.length} 字 · 选中 {selection.end - selection.start} 字</span><div className="studio__desk-actions">{aiReady ? <button type="button" className="studio__save-btn studio__save-btn--ai" disabled={aiMutation.isPending} title="发起一个单章后台任务（区别于多章 AI 快速创作）" onClick={() => aiMutation.mutate()}><Sparkles size={13} />{aiMutation.isPending ? "交稿中…" : "交给 AI"}</button> : detail.document.kind === "manuscript" ? <span className="studio__desk-hint">正文总稿用于汇总章节；<Link to={projectWorkspacePath(projectId, "bible")}>先建立章节</Link>，或<Link to={projectWorkspacePath(projectId, "autopilot")}>使用 AI 快速创作</Link></span> : detail.document.kind === "scene" ? <span className="studio__desk-hint">场景稿可使用右侧选区 AI 编辑；章节生产只对章节正文开放。</span> : <span className="studio__desk-hint">这件稿件未绑定章节大纲；<Link to={projectWorkspacePath(projectId, "bible")}>去故事页检查</Link></span>}<button type="button" className="studio__save-btn" disabled={versionMutation.isPending || !content.trim()} onClick={() => versionMutation.mutate()}><Save size={13} />{versionMutation.isPending ? "入版中…" : "保存新版本"}</button></div></div>
      </div>
    </main>
    <aside className="studio__side" aria-label="写作工具坞">
      <nav className="studio__tool-nav" role="tablist" aria-label="写作工具">
        {STUDIO_TOOLS.map((tool) => {
          const count = toolCount(tool.id);
          return (
            <button
              key={tool.id}
              type="button"
              role="tab"
              aria-selected={activeTool === tool.id}
              aria-controls="studio-tool-panel"
              onClick={() => setToolSelection({ focusTarget, tool: tool.id })}
            >
              <StudioToolIcon tool={tool.id} />
              <span>{tool.label}</span>
              {count !== null ? <small>{count}</small> : null}
            </button>
          );
        })}
      </nav>
      <section
        className="studio__tool-panel"
        id="studio-tool-panel"
        role="tabpanel"
        aria-label={`${activeToolLabel}工具`}
      >
        {activeTool === "review" ? <ReviewPanel projectId={projectId} document={detail.document} workspace={review} pending={reviewPending} error={reviewError} /> : null}
        {activeTool === "revisions" ? <RevisionProposalPanel projectId={projectId} activeDocumentId={detail.document.id} /> : null}
        {activeTool === "canon" ? <CanonChangesPanel projectId={projectId} document={detail.document} versions={detail.versions} /> : null}
        {activeTool === "comments" ? <CommentPanel comments={detail.comments} pending={statusMutation.isPending} onToggle={(comment) => statusMutation.mutate(comment)} /> : null}
        {activeTool === "versions" ? <VersionPanel versions={detail.versions} currentVersionId={detail.document.currentVersionId} pending={restoreMutation.isPending} onRestore={setRestoreTarget} /> : null}
        {activeTool === "selection" ? <>
          <section className="studio__selection-tools" aria-label="选区操作"><h3>选区工具</h3><blockquote>{hasSelection ? content.slice(selection.start, selection.end) : "在正文里选择一段文字后，可创建版本锚定批注或生成可审 diff。"}</blockquote><div className="studio__selection-grid"><div className="studio__selection-cell"><label>批注<textarea value={commentBody} onChange={(event) => setCommentBody(event.target.value)} /></label><button type="button" className="btn" disabled={!hasSelection || !commentBody.trim() || commentMutation.isPending} onClick={() => commentMutation.mutate()}><MessageSquarePlus size={12} />{selectionNeedsCheckpoint ? "保存版本并批注" : "创建批注"}</button></div><div className="studio__selection-cell"><label>AI 编辑指令<textarea value={editInstruction} onChange={(event) => setEditInstruction(event.target.value)} /></label><button type="button" className="btn btn--primary" disabled={!hasSelection || !editInstruction.trim() || editMutation.isPending} onClick={() => editMutation.mutate()}><Sparkles size={12} />{editMutation.isPending ? "正在生成提案…" : "生成编辑提案"}</button>{editMutation.data ? <p className="studio__saved-note" role="status">AI 编辑任务已开始；可以离开此页，完成后提案会回到这里。 <Link to={`${projectWorkspacePath(projectId, "runs")}?run=${encodeURIComponent(editMutation.data.run.id)}`}>查看运行进度</Link></p> : null}</div></div></section>
          <ProposalPanel proposals={detail.proposals} pending={proposalMutation.isPending} onDecide={(proposal, action) => proposalMutation.mutate({ proposal, action })} />
        </> : null}
      </section>
    </aside>
    {restoreTarget ? <ConfirmDialog title="恢复历史版本" confirmLabel="恢复为新版本" pending={restoreMutation.isPending} onCancel={() => setRestoreTarget(null)} onConfirm={() => restoreMutation.mutate(restoreTarget)}><p>不会改写旧版本；系统会把所选内容追加为一个新的不可变版本。当前本地草稿会保留到服务端，若发生 409 请重新加载后再决定。</p>{restoreMutation.isError ? <ErrorNote error={restoreMutation.error} title="版本未恢复" /> : null}</ConfirmDialog> : null}
    {archiveOpen ? <ConfirmDialog title="移入回收站" confirmLabel="移入回收站" danger onCancel={() => setArchiveOpen(false)} onConfirm={() => { setArchiveOpen(false); if (detail) void onArchive(detail.document); }}><p>稿件会从当前稿目隐藏，但正文、版本、批注和审稿记录都会保留。之后可以在回收站恢复。</p></ConfirmDialog> : null}
  </>;
}

function StudioToolIcon({ tool }: { tool: StudioTool }) {
  const props = { size: 15, strokeWidth: 1.6, "aria-hidden": true } as const;
  switch (tool) {
    case "review":
      return <Check {...props} />;
    case "revisions":
      return <Undo2 {...props} />;
    case "canon":
      return <BookOpen {...props} />;
    case "comments":
      return <MessageSquarePlus {...props} />;
    case "versions":
      return <Save {...props} />;
    case "selection":
      return <Sparkles {...props} />;
  }
}

/* ---- 审稿（完整展开）：现状文档的最新报告 + verdict + issue 裁定 ------------ */

function ReviewPanel({ projectId, document, workspace, pending, error }: { projectId: string; document: StoryDocument; workspace: ReviewWorkspace | undefined; pending: boolean; error: unknown }) {
  const queryClient = useQueryClient();
  const [flash, setFlash] = useState<string | null>(null);
  const reviewRequestRef = useRef<{ versionId: string; requestId: string } | null>(null);
  const decideMutation = useMutation({
    mutationFn: (input: { issue: ReviewWorkspaceIssue; action: "accept" | "reject" | "false_positive" | "intentional_keep" }) =>
      decideReviewIssue(projectId, input.issue.id, { action: input.action, note: null, expectedStatus: input.issue.status }),
    onSuccess: (_data, input) => {
      setFlash(`${reviewIssueActionLabel(input.action)} · 已写入底稿`);
      window.setTimeout(() => setFlash(null), 2200);
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "review"] });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "studio"] });
    },
  });
  const reviewMutation = useMutation({
    mutationFn: () => {
      if (!document.currentVersionId) {
        throw new Error("当前稿件还没有可送审的正式版本");
      }
      if (reviewRequestRef.current?.versionId !== document.currentVersionId) {
        reviewRequestRef.current = {
          versionId: document.currentVersionId,
          requestId: crypto.randomUUID(),
        };
      }
      return createDocumentReview(projectId, document.id, {
        requestId: reviewRequestRef.current.requestId,
        documentVersionId: document.currentVersionId,
        origin: { surface: "writing", documentId: document.id },
      });
    },
    onSuccess: (created) => {
      reviewRequestRef.current = null;
      setFlash("当前版本已送审，完成后报告会自动回到这里");
      rememberTask({
        projectId,
        kind: "chapter",
        taskId: created.run.id,
        label: `审稿：《${document.title}》`,
        createdAt: new Date().toISOString(),
        origin: { surface: "writing", documentId: document.id },
        documentId: document.id,
      });
      void queryClient.invalidateQueries({
        queryKey: ["project", projectId, "runs"],
      });
    },
  });
  const reports = (workspace?.reports ?? [])
    .filter((report) => report.documentId === document.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const currentReports = reports.filter(
    (report) => report.documentVersionId === document.currentVersionId,
  );
  const latest: ReviewWorkspaceReport | null = currentReports[0] ?? null;
  if (error) return <Panel title="审稿" count={0}><ErrorNote error={error} title="审稿结果暂时无法加载" /></Panel>;
  if (pending) return <Panel title="审稿" count={0}><Skeleton lines={3} /></Panel>;
  const canReview =
    document.kind === "chapter" &&
    document.outlineNodeId !== null &&
    document.currentVersionId !== null;
  const visibleReports = reports.filter(
    (report) =>
      report.id === latest?.id ||
      report.issues.some((issue) => issue.status === "open"),
  );
  const openCount = visibleReports.flatMap((report) => report.issues).filter((issue) => issue.status === "open").length;
  return <Panel title="审稿" count={openCount}>
    <div className="studio__review-command">
      <p className="studio__section-intro">{latest ? "当前版本的审稿与过去仍未裁定的问题都会保留在这里。" : document.kind === "manuscript" ? "正文总稿不单独触发审稿；请在对应章节稿中审阅。" : "本稿尚无审稿报告；当前正文版本还没有完成审阅。"}</p>
      {canReview ? <button type="button" className="btn" disabled={reviewMutation.isPending} onClick={() => reviewMutation.mutate()}><Check size={12} aria-hidden="true" />{reviewMutation.isPending ? "送审中…" : latest ? "重新审稿" : "审稿当前版本"}</button> : null}
    </div>
    {reviewMutation.isError ? <ErrorNote error={reviewMutation.error} title="当前版本未能送审" /> : null}
    {!latest && visibleReports.length > 0 ? <p className="studio__review-stale">以下报告属于过去版本，不代表当前正文。</p> : null}
    {!latest && visibleReports.length === 0 ? <p className="studio__panel-empty">保存出正式版本后，可以从这里单独审稿，不会改写正文。</p> : null}
    {visibleReports.map((report, index) => {
      const reportOpenIssues = report.issues.filter((issue) => issue.status === "open");
      return <details key={report.id} className="studio__review-report" open={index === 0 || reportOpenIssues.length > 0}>
        <summary><strong>{report.id === latest?.id ? "当前版本" : "过去未结审稿"}</strong><span>{reviewVerdictLabel(report.verdict)} · {reportOpenIssues.length} 项待裁定 · {report.createdAt.slice(0, 16)}</span></summary>
        <div className="studio__review-report-body">
          <div className="review__report" aria-label="审稿结论">
            <div className="review__report-head"><p className="review__report-verdict" data-v={report.verdict}>{reviewVerdictLabel(report.verdict)}</p><p className="review__report-summary">{report.summary}</p></div>
            <div className="review__report-scores" aria-label="评分细项">{Object.entries(report.scores).map(([key, value]) => <span key={key}>{reviewScoreLabel(key)} · {value}</span>)}</div>
          </div>
          {report.reviewedContent ? <details className="studio__reviewed-copy"><summary>展开查看当时送审的完整正文 · {report.reviewedContent.length} 字</summary><div className="review__doc-body review__doc-body--desk" aria-label="被审正文（完整）">{markQuotes(report.reviewedContent, report.issues.flatMap((issue) => issue.evidence.map((entry) => entry.quote)).filter(Boolean))}</div></details> : null}
          {report.issues.length === 0 ? <div className="review__empty"><strong>审得很干净</strong>这份稿没有新的问题要裁定。</div> : <div className="review__issues">{report.issues.map((issue) => <IssueCard key={issue.id} issue={issue} pending={decideMutation.isPending} onDecide={(action) => decideMutation.mutate({ issue, action })} />)}</div>}
          {reportOpenIssues.length === 0 && report.issues.length > 0 ? <p className="studio__panel-empty">这份报告中的 {report.issues.length} 项都已裁定。</p> : null}
        </div>
      </details>;
    })}
    {flash ? <p className="review__flash" role="status"><Check size={13} aria-hidden="true" />{flash}</p> : null}
  </Panel>;
}

function currentDocumentQuality(
  documents: StoryDocument[],
  reports: ReviewWorkspaceReport[],
): Map<string, ReviewWorkspaceReport["verdict"]> {
  const currentVersions = new Map(
    documents.flatMap((document) =>
      document.currentVersionId
        ? [[document.currentVersionId, document.id] as const]
        : [],
    ),
  );
  const quality = new Map<string, ReviewWorkspaceReport["verdict"]>();
  for (const report of [...reports].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )) {
    const documentId = report.documentVersionId
      ? currentVersions.get(report.documentVersionId)
      : undefined;
    if (documentId && !quality.has(documentId)) {
      quality.set(documentId, report.verdict);
    }
  }
  return quality;
}

function IssueCard({ issue, pending, onDecide }: { issue: ReviewWorkspaceIssue; pending: boolean; onDecide: (action: "accept" | "reject" | "false_positive" | "intentional_keep") => void }) {
  const decided = issue.decision !== null;
  return (
    <article className="review__issue" data-decided={decided}>
      <div className="review__issue-head">
        <span className="review__issue-badge" data-s={issue.severity}>{reviewSeverityLabel(issue.severity)}</span>
        <span className="review__issue-cat">{reviewCategoryLabel(issue.category)}</span>
        <span className="review__decision-chip" data-d={issue.decision?.action}>{decided ? reviewIssueActionLabel(issue.decision!.action) : reviewIssueStatusLabel(issue)}</span>
      </div>
      <p className="review__issue-message">{issue.message}</p>
      {issue.evidence.length > 0 ? (
        <div className="review__issue-evidence">
          {issue.evidence.map((entry, index) => (
            <span key={index}>
              「{entry.quote}」{index < issue.evidence.length - 1 ? " · " : ""}
            </span>
          ))}
        </div>
      ) : null}
      {issue.suggestedDirection ? <p className="review__issue-suggest">{issue.suggestedDirection}</p> : null}
      {!decided ? (
        <div className="review__decider" role="group" aria-label="裁定">
          <button type="button" className="review__decider-btn" disabled={pending} onClick={() => onDecide("accept")}><Check size={11} strokeWidth={2} aria-hidden="true" />接受</button>
          <button type="button" className="review__decider-btn" disabled={pending} onClick={() => onDecide("reject")}>拒绝</button>
          <button type="button" className="review__decider-btn" disabled={pending} onClick={() => onDecide("false_positive")}>误报</button>
          <button type="button" className="review__decider-btn" disabled={pending} onClick={() => onDecide("intentional_keep")}>故意保留</button>
        </div>
      ) : null}
    </article>
  );
}

/* ---- 修订提案：base 对照 + revised 全文 + apply/reject --------------------- */

function RevisionProposalPanel({ projectId, activeDocumentId }: { projectId: string; activeDocumentId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["project", projectId, "review"],
    queryFn: ({ signal }) => getReviewWorkspace(projectId, signal),
  });
  const mutation = useMutation({
    mutationFn: (input: { proposal: ReviewRevisionProposal; action: "apply" | "reject" }) =>
      decideRevisionProposal(projectId, input.proposal.id, input.action),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "review"] });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "studio"] });
    },
  });
  const proposals = (query.data?.proposals ?? []).filter(
    (proposal) => proposal.documentId === activeDocumentId,
  );
  if (query.isPending) return null;
  return <Panel title="修订提案" count={proposals.length}>
    {query.isError ? <ErrorNote error={query.error} title="修订提案暂时无法加载" /> : proposals.length === 0 ? (
      <p className="studio__panel-empty">当前正文没有待采纳的整篇修订。</p>
    ) : proposals.map((proposal) => (
      <article key={proposal.id} className="studio__proposal" data-status={proposal.status}>
        <strong>整篇修订 · {proposalStatusLabel(proposal.status)}</strong>
        {proposal.baseContent ? (
          <details className="studio__proposal-base"><summary>对照：原稿 {proposal.baseContent.length} 字</summary><pre>{proposal.baseContent}</pre></details>
        ) : null}
        {/* 修改差异完整展开：revised 正文一字不省。 */}
        <div className="review__doc-body review__doc-body--desk" aria-label={`修订后正文（完整） · ${proposal.revisedContent.length} 字`}>{proposal.revisedContent}</div>
        {proposal.diff && Object.keys(proposal.diff).length > 0 ? (
          <details className="studio__proposal-base"><summary>查看详细差异</summary><pre className="review__proposal-diff">{JSON.stringify(proposal.diff, null, 2)}</pre></details>
        ) : null}
        {proposal.addressedIssueIds.length > 0 ? <small>回应 {proposal.addressedIssueIds.length} 个审稿问题</small> : null}
        {proposal.status === "proposed" ? (
          <div className="studio__proposal-actions">
            <button type="button" className="btn btn--primary" disabled={mutation.isPending} onClick={() => mutation.mutate({ proposal, action: "apply" })}>应用为新版本</button>
            <button type="button" className="btn" disabled={mutation.isPending} onClick={() => mutation.mutate({ proposal, action: "reject" })}>拒绝</button>
          </div>
        ) : <small>{proposalStatusLabel(proposal.status)}{proposal.decidedAt ? ` · ${proposal.decidedAt.slice(0, 16)}` : ""}</small>}
        {mutation.isError ? <ErrorNote error={mutation.error} title="提案裁定未完成" /> : null}
      </article>
    ))}
  </Panel>;
}

/* ---- 故事变化裁定（canon change set） -------------------------------------- */

function CanonChangesPanel({ projectId, document, versions }: { projectId: string; document: StoryDocument; versions: DocumentVersion[] }) {
  const queryClient = useQueryClient();
  const [forceTarget, setForceTarget] = useState<CanonChangeSetView | null>(null);
  const query = useQuery({
    queryKey: ["project", projectId, "canon-change-sets"],
    queryFn: ({ signal }) => getCanonChangeSets(projectId, signal),
  });
  const runsQuery = useQuery({
    queryKey: ["project", projectId, "runs"],
    queryFn: ({ signal }) => getProjectRuns(projectId, signal),
  });
  const storyQuery = useQuery({
    queryKey: ["project", projectId, "story-bible"],
    queryFn: ({ signal }) => getStoryBible(projectId, signal),
  });
  const mutation = useMutation({
    mutationFn: (input: { set: CanonChangeSetView; action: "apply" | "reject"; conflictPolicy?: "reject" | "force" }) =>
      decideCanonChangeSet(projectId, input.set.id, {
        action: input.action,
        expectedStatus: "candidate",
        conflictPolicy: input.conflictPolicy ?? "reject",
      }),
    onSuccess: () => {
      setForceTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "canon-change-sets"] });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "runs"] });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "overview"] });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "autopilot"] });
    },
  });
  const relatedRunIds = new Set((runsQuery.data ?? [])
    .filter((run) => document.outlineNodeId && run.targetOutlineNodeId === document.outlineNodeId)
    .map((run) => run.id));
  const versionIds = new Set(versions.map((version) => version.id));
  const sets = (query.data ?? []).filter((set) =>
    set.status === "candidate" &&
    (relatedRunIds.has(set.runId) || changeSetTouchesVersions(set.changes, versionIds)));
  const entityNames = new Map((storyQuery.data?.entities ?? []).map((entity) => [entity.id, entity.name]));
  /* 手动提交版本自动开出的结算 Run：targetOutlineNodeId 为 null，只能按
     policy.origin.documentId 认领，用来显示运行中/失败状态。 */
  const settlementRuns = (runsQuery.data ?? []).filter((run) =>
    run.recipe === "manual-settlement" && runOriginDocumentId(run.policy) === document.id);
  const activeSettlement = settlementRuns.find((run) => !TERMINAL_RUN_STATUSES.has(run.status));
  const failedSettlement = [...settlementRuns].reverse().find((run) => run.status === "failed");
  const conflict = settlementConflictDetails(mutation.error);
  if (query.isPending || runsQuery.isPending) return <Panel title="故事变化" count={0}><Skeleton lines={2} /></Panel>;
  return <Panel title="故事变化" count={sets.length}>
    {query.isError || runsQuery.isError ? <ErrorNote error={query.error ?? runsQuery.error} title="故事变化暂时无法加载" /> : <>
        {activeSettlement ? <p className="studio__settlement-status" role="status">正在从本章正文提取故事变化；完成后回到这里裁定，不会直接改人物、时间线或伏笔。</p>
          : failedSettlement ? <p className="studio__settlement-status" data-tone="failed">最近一次变化提取失败，正文和版本不受影响；<Link to={`${projectWorkspacePath(projectId, "runs")}?run=${encodeURIComponent(failedSettlement.id)}`}>查看任务详情</Link>。</p> : null}
        {sets.length === 0 && !activeSettlement ? (
          <p className="studio__panel-empty">当前正文没有待裁定的故事变化。</p>
        ) : sets.length > 0 ? <>
        <p className="studio__section-intro">只显示由当前正文带来的变化；采纳前不会改写人物、时间线或伏笔。</p>
        {sets.map((set) => {
          const items = canonChangeItems(set.changes, entityNames);
          return (
          <article key={set.id} className="studio__proposal" data-status={set.status}>
            <strong>{canonSummary(set.changes) ?? "正文带来一组新变化"}</strong>
            {items.length > 0 ? <ul className="studio__canon-items">{items.map((item, index) => <li key={`${item.label}-${index}`}><span>{item.label}</span><p>{item.text}</p></li>)}</ul> : <p className="studio__panel-empty">这组变化没有可读条目，请到技术运行中排查。</p>}
            <small>{set.createdAt.slice(0, 16)}</small>
            {set.status === "candidate" ? (
              <div className="studio__proposal-actions">
                <button type="button" className="btn btn--primary" disabled={mutation.isPending} onClick={() => mutation.mutate({ set, action: "apply" })}>采纳这些变化</button>
                {conflict?.forceAllowed && mutation.variables?.set.id === set.id ? <button type="button" className="btn" disabled={mutation.isPending} onClick={() => setForceTarget(set)}>强制采纳</button> : null}
                <button type="button" className="btn" disabled={mutation.isPending} onClick={() => mutation.mutate({ set, action: "reject" })}>暂不采纳</button>
              </div>
            ) : null}
          </article>
        );})}
        {mutation.isError ? conflict ? <div className="studio__settlement-status" data-tone="failed" role="alert"><strong>变化与当前正典冲突</strong><ul>{conflict.conflicts.map((item, index) => <li key={`${item.path}-${index}`}>{settlementConflictLabel(item.reason)} · {item.path}{item.existingIds.length > 0 ? ` · 当前记录 ${item.existingIds.join(", ")}` : ""}</li>)}</ul>{conflict.forceAllowed ? <p>这些冲突可在确认后覆盖；也可以暂不采纳整组变化。</p> : <p>这类冲突不能强制覆盖，请暂不采纳并修正文中的变化来源。</p>}</div> : <ErrorNote error={mutation.error} title="变化裁定未完成" /> : null}
      </> : null}
      </>}
    {forceTarget ? <ConfirmDialog title="强制采纳故事变化" confirmLabel="确认强制采纳" danger pending={mutation.isPending} onCancel={() => setForceTarget(null)} onConfirm={() => mutation.mutate({ set: forceTarget, action: "apply", conflictPolicy: "force" })}><p>这会覆盖冲突中已锁定或已变化的当前记录，并整组应用这些故事变化。操作成功后，等待中的章节任务会自动继续。</p></ConfirmDialog> : null}
  </Panel>;
}

interface SettlementConflictDetails {
  conflicts: Array<{ path: string; existingIds: string[]; reason: string }>;
  forceAllowed: boolean;
}

function settlementConflictDetails(error: unknown): SettlementConflictDetails | null {
  if (!(error instanceof ApiError) || error.code !== "settlement.conflict") return null;
  const details = error.details;
  if (!isUnknownRecord(details) || !Array.isArray(details.conflicts) || typeof details.forceAllowed !== "boolean") return null;
  const conflicts = details.conflicts.filter(isUnknownRecord).flatMap((item) =>
    typeof item.path === "string" && typeof item.reason === "string" && Array.isArray(item.existingIds)
      ? [{ path: item.path, reason: item.reason, existingIds: item.existingIds.filter((id): id is string => typeof id === "string") }]
      : [],
  );
  return { conflicts, forceAllowed: details.forceAllowed };
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function settlementConflictLabel(reason: string): string {
  return ({
    target_locked: "目标记录已锁定",
    status_changed: "目标状态已变化",
    target_not_current: "目标已不是当前记录",
    target_slot_mismatch: "目标与命题不匹配",
    target_not_found: "目标记录不存在",
    target_pair_mismatch: "关系双方与目标不匹配",
  } as Record<string, string>)[reason] ?? reason;
}

function CommentPanel({ comments, pending, onToggle }: { comments: DocumentComment[]; pending: boolean; onToggle: (comment: DocumentComment) => void }) { return <Panel title="批注" count={comments.length}>{comments.length === 0 ? <p className="studio__panel-empty">暂无批注。</p> : comments.map((comment) => <article key={comment.id} className="studio__pin"><span className="studio__pin-state" data-s={comment.status}>{comment.status === "open" ? "待处理" : "已解决"}</span><blockquote>{comment.quote}</blockquote><p>{comment.body}</p><small>正文位置 {comment.startOffset}–{comment.endOffset}</small><button type="button" className="btn" disabled={pending} onClick={() => onToggle(comment)}>{comment.status === "open" ? "标为已解决" : "重新打开"}</button></article>)}</Panel>; }
function VersionPanel({ versions, currentVersionId, pending, onRestore }: { versions: DocumentVersion[]; currentVersionId: string | null; pending: boolean; onRestore: (version: DocumentVersion) => void }) { return <Panel title="历史版本" count={versions.length}>{versions.map((version, index) => <article key={version.id} className="studio__version" data-current={version.id === currentVersionId}><span className="studio__version-no mono">v{versions.length - index}</span><span className="studio__version-meta"><strong>{versionSourceLabel(version.source)}</strong> · {version.content.length} 字 · {version.createdAt.slice(0, 16)}</span>{version.id !== currentVersionId ? <button type="button" className="btn" disabled={pending} onClick={() => onRestore(version)}><Undo2 size={11} />恢复</button> : null}</article>)}</Panel>; }
function ProposalPanel({ proposals, pending, onDecide }: { proposals: EditProposal[]; pending: boolean; onDecide: (proposal: EditProposal, action: "accept" | "reject") => void }) { return <Panel title="选区修改" count={proposals.length}>{proposals.length === 0 ? <p className="studio__panel-empty">暂无选区修改建议。</p> : proposals.map((proposal) => <article key={proposal.id} className="studio__proposal" data-status={proposal.status}><strong>{proposal.instruction}</strong><del>{proposal.originalText}</del><ins>{proposal.replacementText}</ins>{proposal.status === "proposed" ? <div className="studio__proposal-actions"><button type="button" className="btn btn--primary" disabled={pending} onClick={() => onDecide(proposal, "accept")}>接受</button><button type="button" className="btn" disabled={pending} onClick={() => onDecide(proposal, "reject")}>拒绝</button></div> : <small>{proposalStatusLabel(proposal.status)}</small>}</article>)}</Panel>; }
function Panel({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const head = <><p className="studio__panel-title">{title}</p><span className="studio__panel-count">{count}</span></>;
  return <section className="studio__panel"><header className="studio__panel-head">{head}</header><div className="studio__panel-body">{children}</div></section>;
}

function reviewScoreLabel(key: string): string {
  return ({ continuity: "连续性", pacing: "节奏", character: "人物", prose: "文句", goal: "章节目标", pov: "视角" } as Record<string, string>)[key] ?? key;
}

function reviewSeverityLabel(value: ReviewWorkspaceIssue["severity"]): string {
  return { info: "提示", minor: "轻微", major: "重要", critical: "严重" }[value];
}

function proposalStatusLabel(value: ReviewRevisionProposal["status"] | EditProposal["status"]): string {
  return ({ proposed: "待决定", accepted: "已采纳", rejected: "已拒绝", superseded: "已被新版本替代" } as Record<string, string>)[value] ?? value;
}

function versionSourceLabel(source: string): string {
  if (source === "manual") return "手动保存";
  if (source === "manual:comment-checkpoint") return "批注前保存";
  if (source === "manual:selection-baseline") return "选区修改前保存";
  if (source.startsWith("run:")) return "AI 正文";
  if (source.startsWith("revision:")) return "AI 修订";
  if (source.startsWith("restore:")) return "恢复历史内容";
  return "正文版本";
}

function changeSetTouchesVersions(value: unknown, versionIds: Set<string>): boolean {
  if (Array.isArray(value)) return value.some((item) => changeSetTouchesVersions(item, versionIds));
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (typeof record.documentVersionId === "string" && versionIds.has(record.documentVersionId)) return true;
  return Object.values(record).some((item) => changeSetTouchesVersions(item, versionIds));
}

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

/** 手动结算 Run 的 policy.origin 里记录的发起文档。 */
function runOriginDocumentId(policy: unknown): string | null {
  if (!policy || typeof policy !== "object") return null;
  const origin = (policy as Record<string, unknown>).origin;
  if (!origin || typeof origin !== "object") return null;
  const documentId = (origin as Record<string, unknown>).documentId;
  return typeof documentId === "string" ? documentId : null;
}

function canonSummary(changes: Record<string, unknown>): string | null {
  return typeof changes.summary === "string" && changes.summary.trim() ? changes.summary : null;
}

function canonChangeItems(
  changes: Record<string, unknown>,
  entityNames: Map<string, string>,
): Array<{ label: string; text: string }> {
  const rows: Array<{ label: string; text: string }> = [];
  const records = (key: string) => Array.isArray(changes[key])
    ? (changes[key] as unknown[]).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
  const text = (record: Record<string, unknown>, key: string) => typeof record[key] === "string" ? record[key] : "";
  const entity = (id: string) => entityNames.get(id) ?? "相关人物或事物";
  for (const item of records("stateDelta")) {
    rows.push({ label: "状态变化", text: `${text(item, "key")}：${text(item, "before") || "此前未记录"} → ${text(item, "after")}` });
  }
  for (const item of records("factCandidates")) {
    const value = item.value === null || item.value === undefined ? "不再成立" : String(item.value);
    rows.push({ label: "故事事实", text: `${entity(text(item, "subjectId"))} · ${text(item, "predicate")}：${value}` });
  }
  for (const item of records("timelineCandidates")) {
    rows.push({ label: "时间线", text: [text(item, "title"), text(item, "storyTime"), text(item, "description")].filter(Boolean).join(" · ") });
  }
  for (const item of records("relationshipCandidates")) {
    rows.push({ label: "人物关系", text: `${entity(text(item, "fromEntityId"))} 与 ${entity(text(item, "toEntityId"))}：${text(item, "relation")}；${text(item, "change")}` });
  }
  for (const item of records("foreshadowCandidates")) {
    const action = ({ plant: "埋下", develop: "推进", resolve: "回收" } as Record<string, string>)[text(item, "action")] ?? "更新";
    rows.push({ label: "伏笔", text: `${action}「${text(item, "title")}」` });
  }
  return rows.filter((row) => row.text.replace(/[：；·「」]/g, "").trim());
}

/* ---- 高亮：把正文中的证据句提警出框（与旧审稿室同一手势） --------------------- */

function markQuotes(content: string, quotes: string[]) {
  if (!quotes.length) return content;
  const pieces: Array<{ text: string; hot: boolean }> = [
    { text: content, hot: false },
  ];
  for (const quote of quotes) {
    const pattern = escapeRegExp(quote);
    const next: typeof pieces = [];
    for (const piece of pieces) {
      if (piece.hot) {
        next.push(piece);
        continue;
      }
      const text = piece.text;
      const regex = new RegExp(pattern, "g");
      let lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text)) !== null) {
        if (m.index > lastIndex)
          next.push({ text: text.slice(lastIndex, m.index), hot: false });
        next.push({ text: m[0], hot: true });
        lastIndex = m.index + m[0].length;
      }
      if (lastIndex < text.length)
        next.push({ text: text.slice(lastIndex), hot: false });
    }
    pieces.splice(0, pieces.length, ...next);
  }
  return pieces.map((piece, index) =>
    piece.hot ? (
      <mark key={index}>{piece.text}</mark>
    ) : (
      <span key={index}>{piece.text}</span>
    ),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
