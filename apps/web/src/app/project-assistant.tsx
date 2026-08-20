import "./project-assistant.css";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  ArrowUp,
  Archive,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Clock3,
  Cpu,
  ExternalLink,
  LoaderCircle,
  MessageSquareText,
  Pencil,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { ErrorNote } from "../components/error-note";
import {
  archiveAssistantConversation,
  configureAssistantConversation,
  controlAutopilotSession,
  controlRun,
  createAssistantConversation,
  decideAssistantActivity,
  getAssistantConversation,
  getAssistantConversations,
  listAssignments,
  listModels,
  listProviders,
  renameAssistantConversation,
  sendAssistantMessage,
  type AssistantActivityDto,
  type AssistantContext,
  type AssistantConversationDetailDto,
  type AssistantConversationDto,
  type AssistantMessageDto,
} from "../lib/api";
import { formatRelativeDate } from "../lib/fmt";
import { stopReasonLabel } from "../lib/labels";
import { projectWorkspacePath } from "../lib/project-route";
import { useServerEvents } from "../lib/sse";

const CONVERSATION_KEY_PREFIX = "narralume:assistant-conversation:";
const PROJECT_CONTEXT: AssistantContext = {
  surface: "project",
  documentId: null,
  outlineNodeId: null,
  canonSpread: null,
  selection: null,
};

interface ProjectAssistantProps {
  projectId: string;
  context: AssistantContext;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}

type TimelineEntry =
  | { type: "message"; at: string; id: string; message: AssistantMessageDto }
  | {
      type: "activity";
      at: string;
      id: string;
      activity: AssistantActivityDto;
    };

interface PendingAssistantSend {
  identity: string;
  conversationRequestId: string;
  messageRequestId: string;
  targetConversationId: string | null;
}

export function ProjectAssistant({
  projectId,
  context,
  open,
  onOpen,
  onClose,
}: ProjectAssistantProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [usePageContext, setUsePageContext] = useState(true);
  const [conversationId, setConversationId] = useState<string | null>(() =>
    rememberedConversation(projectId),
  );
  const messageContext = usePageContext ? context : PROJECT_CONTEXT;
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const wasOpenRef = useRef(open);
  const pendingSendRef = useRef<PendingAssistantSend | null>(null);
  const defaultConversationRequestedRef = useRef(false);
  const conversationsQuery = useQuery({
    queryKey: ["assistant", projectId, "conversations"],
    queryFn: ({ signal }) => getAssistantConversations(projectId, signal),
  });

  useEffect(() => {
    const conversations = conversationsQuery.data;
    if (!conversations) return;
    const selected = conversations.find(
      (conversation) => conversation.id === conversationId,
    );
    if (selected) return;
    const next = conversations.find(
      (conversation) => conversation.status === "active",
    );
    selectConversation(projectId, next?.id ?? null, setConversationId);
  }, [conversationId, conversationsQuery.data, projectId]);

  const detailQuery = useQuery({
    queryKey: ["assistant", projectId, "conversation", conversationId],
    queryFn: ({ signal }) => getAssistantConversation(conversationId!, signal),
    enabled: Boolean(conversationId),
    refetchInterval: (query) =>
      hasLiveActivity(query.state.data) ? 1_500 : false,
  });
  const relatedRunIds = useMemo(
    () => assistantRunIds(detailQuery.data),
    [detailQuery.data],
  );
  useServerEvents({
    onRunStatus: (runId) => {
      if (relatedRunIds.has(runId))
        void invalidateAssistantDetail(queryClient, projectId, conversationId);
    },
    onRunEvent: (runId) => {
      if (relatedRunIds.has(runId))
        void invalidateAssistantDetail(queryClient, projectId, conversationId);
    },
  }, open && Boolean(conversationId));

  const createMutation = useMutation({
    mutationFn: (title?: string) =>
      createAssistantConversation(projectId, {
        requestId: createRequestId(),
        title: title ?? "项目协作",
      }),
    onSuccess: (conversation) => {
      pendingSendRef.current = null;
      queryClient.setQueryData<AssistantConversationDto[]>(
        ["assistant", projectId, "conversations"],
        (current = []) => [
          conversation,
          ...current.filter((candidate) => candidate.id !== conversation.id),
        ],
      );
      selectConversation(projectId, conversation.id, setConversationId);
      void queryClient.invalidateQueries({
        queryKey: ["assistant", projectId, "conversations"],
      });
    },
    onError: () => {
      defaultConversationRequestedRef.current = false;
    },
  });
  useEffect(() => {
    const conversations = conversationsQuery.data;
    if (
      !conversations ||
      conversations.some((conversation) => conversation.status === "active") ||
      defaultConversationRequestedRef.current
    ) {
      return;
    }
    defaultConversationRequestedRef.current = true;
    createMutation.mutate("项目协作");
  }, [conversationsQuery.data, createMutation]);

  const archiveMutation = useMutation({
    mutationFn: (targetConversationId: string) =>
      archiveAssistantConversation(targetConversationId),
    onSuccess: (conversation) => {
      const next = conversationsQuery.data?.find(
        (candidate) =>
          candidate.id !== conversation.id && candidate.status === "active",
      );
      selectConversation(projectId, next?.id ?? null, setConversationId);
      void queryClient.invalidateQueries({
        queryKey: ["assistant", projectId, "conversations"],
      });
    },
  });
  const [renamingConversation, setRenamingConversation] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const renameMutation = useMutation({
    mutationFn: (input: { conversationId: string; title: string }) =>
      renameAssistantConversation(input.conversationId, input.title),
    onSuccess: () => {
      setRenamingConversation(false);
      void queryClient.invalidateQueries({
        queryKey: ["assistant", projectId, "conversations"],
      });
    },
  });
  const configureMutation = useMutation({
    mutationFn: (input: {
      conversationId: string;
      modelId?: string | null;
      reasoningEffort?: string | null;
    }) =>
      configureAssistantConversation(input.conversationId, {
        ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
        ...(input.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: input.reasoningEffort }),
      }),
    onSuccess: (conversation) => {
      void queryClient.invalidateQueries({
        queryKey: ["assistant", projectId, "conversations"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["assistant", projectId, "conversation", conversation.id],
      });
    },
  });
  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const contextSnapshot = messageContext;
      const identity = JSON.stringify({ content, context: contextSnapshot });
      if (pendingSendRef.current?.identity !== identity) {
        pendingSendRef.current = {
          identity,
          conversationRequestId: createRequestId(),
          messageRequestId: createRequestId(),
          targetConversationId: conversationId,
        };
      }
      const pending = pendingSendRef.current;
      let targetConversationId = pending.targetConversationId;
      if (!targetConversationId) {
        const conversation = await createAssistantConversation(projectId, {
          requestId: pending.conversationRequestId,
          title: "项目协作",
        });
        targetConversationId = conversation.id;
        pending.targetConversationId = conversation.id;
        selectConversation(projectId, conversation.id, setConversationId);
      }
      return {
        conversationId: targetConversationId,
        accepted: await sendAssistantMessage(targetConversationId, {
          requestId: pending.messageRequestId,
          content,
          context: contextSnapshot,
        }),
      };
    },
    onSuccess: ({ conversationId: targetConversationId }) => {
      pendingSendRef.current = null;
      setDraft("");
      void queryClient.invalidateQueries({
        queryKey: [
          "assistant",
          projectId,
          "conversation",
          targetConversationId,
        ],
      });
      void queryClient.invalidateQueries({
        queryKey: ["assistant", projectId, "conversations"],
      });
    },
  });
  const activityMutation = useMutation({
    mutationFn: (input: {
      activityId: string;
      action: "confirm" | "reject" | "retry" | "resume" | "cancel";
    }) => decideAssistantActivity(input.activityId, input.action),
    onSettled: () =>
      invalidateAssistant(queryClient, projectId, conversationId),
  });
  /* 侧栏的低风险直连动作：run/autopilot 卡的取消直接走各自控制端点，
   *  不经 assistant activity 通道（那套只服务工具提案/长期目标）。
   *  失败章节卡的重试同理——与运行中心「重试本章」同一动作。 */
  const taskControlMutation = useMutation({
    mutationFn: async ({
      activity,
      action,
    }: {
      activity: AssistantActivityDto;
      action: "cancel" | "retry_chapter";
    }): Promise<unknown> => {
      // 返回结构随来源不同（RunSnapshot vs 会话详情），这里只关心成功与否。
      if (action === "retry_chapter") {
        return controlRun(projectId, activity.sourceId, {
          action: "retry_chapter",
          requestId: crypto.randomUUID(),
        });
      }
      if (activity.sourceType === "autopilot") {
        await controlAutopilotSession(activity.sourceId, {
          action: "cancel",
        });
        return null;
      }
      return controlRun(projectId, activity.sourceId, { action: "cancel" });
    },
    onSettled: () =>
      invalidateAssistant(queryClient, projectId, conversationId),
  });

  const entries = useMemo(
    () => timelineEntries(detailQuery.data),
    [detailQuery.data],
  );
  const activeCount =
    detailQuery.data?.activities.filter((activity) =>
      ["queued", "running", "waiting", "proposed"].includes(activity.status),
    ).length ?? 0;
  const currentConversation = conversationsQuery.data?.find(
    (conversation) => conversation.id === conversationId,
  );
  const conversationArchived = currentConversation?.status === "archived";
  const submitRename = () => {
    const title = renameDraft.trim();
    if (!conversationId || !title || title === currentConversation?.title) {
      setRenamingConversation(false);
      return;
    }
    renameMutation.mutate({ conversationId, title });
  };

  useEffect(() => {
    if (!open) return;
    const frame = timelineRef.current;
    if (!frame) return;
    frame.scrollTo({ top: frame.scrollHeight, behavior: "smooth" });
  }, [entries.length, open]);

  useEffect(() => {
    if (wasOpenRef.current && !open) triggerRef.current?.focus();
    wasOpenRef.current = open;
  }, [open]);

  const submit = (content = draft) => {
    const value = content.trim();
    if (!value || sendMutation.isPending) return;
    sendMutation.mutate(value);
  };

  return (
    <>
      {!open ? (
        <button
          ref={triggerRef}
          type="button"
          className="assistant-trigger"
          onClick={onOpen}
          aria-label="打开项目协作"
          title="项目协作（⌘J）"
        >
          <MessageSquareText size={17} strokeWidth={1.5} aria-hidden="true" />
          <span>协作</span>
          {activeCount > 0 ? (
            <span className="assistant-trigger__count mono">{activeCount}</span>
          ) : null}
        </button>
      ) : null}
      {open ? (
        <div
          className="assistant-backdrop"
          aria-hidden="true"
          onClick={onClose}
        />
      ) : null}
      {open ? (
        <aside
          className="assistant-panel"
          data-open="true"
          aria-label="项目协作"
        >
        <header className="assistant-panel__head">
          <div className="assistant-panel__identity">
            <p className="assistant-panel__eyebrow mono">PROJECT ASSISTANT</p>
            {renamingConversation ? (
              <form className="assistant-conv__rename" onSubmit={(event) => { event.preventDefault(); submitRename(); }}>
                <input
                  value={renameDraft}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setRenamingConversation(false);
                  }}
                  autoFocus
                  maxLength={200}
                  aria-label="对话新名称"
                  placeholder="给这条对话起个名字"
                />
                <button
                  type="submit"
                  className="assistant-conv__rename-save"
                  disabled={renameMutation.isPending || !renameDraft.trim()}
                >
                  {renameMutation.isPending ? "保存中…" : "保存"}
                </button>
              </form>
            ) : (
              <ConversationPicker
                conversations={conversationsQuery.data ?? []}
                loading={conversationsQuery.isPending}
                value={conversationId}
                onSelect={(next) =>
                  selectConversation(projectId, next, setConversationId)
                }
              />
            )}
          </div>
          <div className="assistant-panel__head-actions">
            <button
              type="button"
              className="assistant-panel__icon"
              aria-label="重命名当前协作对话"
              title="重命名当前协作对话"
              disabled={!conversationId}
              onClick={() => {
                setRenameDraft(currentConversation?.title ?? "");
                setRenamingConversation(true);
              }}
            >
              <Pencil size={15} strokeWidth={1.5} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="assistant-panel__icon"
              aria-label="归档当前协作对话"
              title="归档当前协作对话"
              disabled={
                !conversationId || conversationArchived || archiveMutation.isPending
              }
              onClick={() => conversationId && archiveMutation.mutate(conversationId)}
            >
              <Archive size={15} strokeWidth={1.5} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="assistant-panel__icon"
              aria-label="新建协作对话"
              title="新建协作对话"
              disabled={createMutation.isPending}
              onClick={() =>
                createMutation.mutate(
                  `协作对话 ${(conversationsQuery.data?.length ?? 0) + 1}`,
                )
              }
            >
              <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="assistant-panel__icon"
              aria-label="关闭项目协作"
              onClick={onClose}
            >
              <X size={17} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
        </header>

        <ContextRibbon
          context={messageContext}
          usingPageContext={usePageContext}
          onToggleScope={() => setUsePageContext((current) => !current)}
        />

        <div className="assistant-panel__timeline" ref={timelineRef}>
          {conversationsQuery.isError ? (
            <ErrorNote
              error={conversationsQuery.error}
              title="协作记录取不回来"
            />
          ) : detailQuery.isError ? (
            <ErrorNote error={detailQuery.error} title="协作现场取不回来" />
          ) : entries.length > 0 ? (
            <ol className="assistant-timeline" aria-live="polite">
              {entries.map((entry) => (
                <li key={`${entry.type}:${entry.id}`}>
                  {entry.type === "message" ? (
                    <MessageEntry message={entry.message} />
                  ) : (
                    <ActivityEntry
                      projectId={projectId}
                      activity={entry.activity}
                      pending={
                        activityMutation.isPending &&
                        activityMutation.variables?.activityId ===
                          activityActionId(entry.activity)
                      }
                      onDecision={(action) => {
                        const activityId = activityActionId(entry.activity);
                        if (activityId) {
                          activityMutation.mutate({ activityId, action });
                        }
                      }}
                      onCancelTask={
                        entry.activity.availableActions.includes("cancel") &&
                        (entry.activity.sourceType === "run" ||
                          entry.activity.sourceType === "autopilot")
                          ? () =>
                              taskControlMutation.mutate({
                                activity: entry.activity,
                                action: "cancel",
                              })
                          : null
                      }
                      onRetryChapter={
                        entry.activity.availableActions.includes(
                          "retry_chapter",
                        ) && entry.activity.sourceType === "run"
                          ? () =>
                              taskControlMutation.mutate({
                                activity: entry.activity,
                                action: "retry_chapter",
                              })
                          : null
                      }
                    />
                  )}
                </li>
              ))}
            </ol>
          ) :
              conversationsQuery.isPending ||
                (Boolean(conversationId) && detailQuery.isPending) ? (
            <div className="assistant-panel__loading" role="status">
              <CircleDashed size={18} strokeWidth={1.4} aria-hidden="true" />
              正在翻阅项目记录…
            </div>
          ) : (
            <AssistantWelcome onPrompt={submit} />
          )}
        </div>

        <footer className="assistant-composer">
          {sendMutation.isError ? (
            <ErrorNote error={sendMutation.error} title="这条消息没有送达" />
          ) : null}
          {activityMutation.isError ? (
            <ErrorNote
              error={activityMutation.error}
              title="这项操作没有执行"
            />
          ) : null}
          {archiveMutation.isError ? (
            <ErrorNote error={archiveMutation.error} title="对话没有归档" />
          ) : null}
          {renameMutation.isError ? (
            <ErrorNote error={renameMutation.error} title="对话没有改名" />
          ) : null}
          {configureMutation.isError ? (
            <ErrorNote
              error={configureMutation.error}
              title="模型设置没有保存"
            />
          ) : null}
          <AssistantModelControls
            conversation={currentConversation ?? null}
            disabled={!conversationId || conversationArchived}
            pending={configureMutation.isPending}
            onConfigure={(input) =>
              conversationId &&
              configureMutation.mutate({ conversationId, ...input })
            }
          />
          <label className="assistant-composer__field">
            <span className="sr-only">给项目助手的消息</span>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.ctrlKey &&
                  !event.metaKey &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder="询问作品，或明确交代一项任务…"
              rows={3}
              maxLength={100_000}
              disabled={conversationArchived}
            />
            <button
              type="button"
              className="assistant-composer__send"
              aria-label="发送消息"
              disabled={
                conversationArchived || !draft.trim() || sendMutation.isPending
              }
              onClick={() => submit()}
            >
              {sendMutation.isPending ? (
                <LoaderCircle
                  className="assistant-spin"
                  size={17}
                  strokeWidth={1.6}
                  aria-hidden="true"
                />
              ) : (
                <ArrowUp size={17} strokeWidth={1.7} aria-hidden="true" />
              )}
            </button>
          </label>
          <p className="assistant-composer__note">
            {conversationArchived ? (
              <span>这条对话已归档，只能查看历史记录</span>
            ) : (
              <>
                <span>Enter 发送 · Ctrl/⌘ Enter 换行</span>
                <span>持久操作会先等你确认</span>
              </>
            )}
          </p>
        </footer>
        </aside>
      ) : null}
    </>
  );
}

function ConversationPicker({
  conversations,
  loading,
  value,
  onSelect,
}: {
  conversations: { id: string; title: string; status: string }[];
  loading: boolean;
  value: string | null;
  onSelect: (conversationId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const active = conversations.filter((c) => c.status !== "archived");
  const archived = conversations.filter((c) => c.status === "archived");
  const current = conversations.find((c) => c.id === value);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const choose = (id: string | null) => {
    setOpen(false);
    onSelect(id);
  };

  return (
    <span ref={rootRef} className="assistant-conv">
      <button
        type="button"
        className="assistant-conv__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={loading}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="assistant-conv__label">
          {current ? current.title : "项目协作"}
        </span>
        <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {open ? (
        <div className="assistant-conv__menu" role="listbox" aria-label="协作对话">
          {active.length === 0 && archived.length === 0 ? (
            <p className="assistant-conv__empty">还没有协作对话</p>
          ) : null}
          {active.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              role="option"
              aria-selected={conversation.id === value}
              className="assistant-conv__item"
              onClick={() => choose(conversation.id)}
            >
              {conversation.title}
            </button>
          ))}
          {archived.length > 0 ? (
            <div className="assistant-conv__archived">
              <button
                type="button"
                className="assistant-conv__archived-toggle"
                aria-expanded={showArchived}
                onClick={() => setShowArchived((v) => !v)}
              >
                已归档（{archived.length}）
                <ChevronDown
                  size={13}
                  strokeWidth={1.5}
                  aria-hidden="true"
                  style={{ transform: showArchived ? "rotate(180deg)" : undefined }}
                />
              </button>
              {showArchived
                ? archived.map((conversation) => (
                    <button
                      key={conversation.id}
                      type="button"
                      role="option"
                      aria-selected={conversation.id === value}
                      className="assistant-conv__item assistant-conv__item--archived"
                      onClick={() => choose(conversation.id)}
                    >
                      {conversation.title}
                    </button>
                  ))
                : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}

const ASSISTANT_EFFORT_LABELS = {
  off: "关闭",
  low: "低",
  medium: "中",
  high: "高",
} as const;

/** composer 上方的模型胶囊：同协议换模型 + 对话级思考档。 */
function AssistantModelControls({
  conversation,
  disabled,
  pending,
  onConfigure,
}: {
  conversation: AssistantConversationDto | null;
  disabled: boolean;
  pending: boolean;
  onConfigure: (input: {
    modelId?: string | null;
    reasoningEffort?: string | null;
  }) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  /* 胶囊在关闭状态也要显示当前生效模型名，清单常驻拉取（staleTime 抑制重复）。 */
  const providersQuery = useQuery({
    queryKey: ["assistant-models", "providers"],
    queryFn: ({ signal }) => listProviders(signal),
    staleTime: 30_000,
  });
  const modelsQuery = useQuery({
    queryKey: ["assistant-models", "models"],
    queryFn: ({ signal }) => listModels(undefined, signal),
    staleTime: 30_000,
  });
  const assignmentsQuery = useQuery({
    queryKey: ["assistant-models", "assignments"],
    queryFn: ({ signal }) => listAssignments(signal),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const providers = useMemo(
    () => providersQuery.data ?? [],
    [providersQuery.data],
  );
  const models = useMemo(() => modelsQuery.data ?? [], [modelsQuery.data]);
  const providerById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers],
  );
  const modelById = useMemo(
    () => new Map(models.map((model) => [model.id, model])),
    [models],
  );
  const settings = conversation?.settings ?? {
    modelId: null,
    reasoningEffort: null,
  };
  const overrideModel = settings.modelId
    ? (modelById.get(settings.modelId) ?? null)
    : null;
  const writingAssignment = (assignmentsQuery.data ?? []).find(
    (assignment) => assignment.role === "writing",
  );
  const defaultModel = writingAssignment
    ? (modelById.get(writingAssignment.modelId) ?? null)
    : null;
  const effectiveModel = overrideModel ?? defaultModel;
  const effectiveProvider = effectiveModel
    ? (providerById.get(effectiveModel.providerId) ?? null)
    : null;
  /* 对话内只出现同协议模型：跨协议家族去设置页改默认生成模型。 */
  const candidates = useMemo(
    () =>
      effectiveProvider
        ? models.filter((model) => {
            const provider = providerById.get(model.providerId);
            return (
              model.enabled &&
              model.taskType === "writing" &&
              provider?.enabled &&
              provider.wireApi === effectiveProvider.wireApi
            );
          })
        : [],
    [models, providerById, effectiveProvider],
  );
  const grouped = useMemo(() => {
    const groups = new Map<string, typeof candidates>();
    for (const model of candidates) {
      const key = providerById.get(model.providerId)?.name ?? model.providerId;
      groups.set(key, [...(groups.get(key) ?? []), model]);
    }
    return [...groups.entries()];
  }, [candidates, providerById]);
  const effort = settings.reasoningEffort ?? "low";

  return (
    <div ref={rootRef} className="assistant-model">
      <button
        type="button"
        className="assistant-model__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="对话模型与思考档"
        disabled={disabled || pending}
        onClick={() => setOpen((value) => !value)}
      >
        <Cpu size={13} strokeWidth={1.6} aria-hidden="true" />
        <span className="assistant-model__name">
          {effectiveModel
            ? effectiveModel.modelId
            : "未配置默认模型"}
        </span>
        {overrideModel ? null : (
          <span className="assistant-model__default mono">默认</span>
        )}
        <span className="assistant-model__effort mono">
          思考·{ASSISTANT_EFFORT_LABELS[effort]}
        </span>
        <ChevronDown size={13} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {open ? (
        <div
          className="assistant-model__menu"
          role="dialog"
          aria-label="对话模型与思考档"
        >
          <p className="assistant-model__section mono">模型</p>
          <div role="listbox" aria-label="对话模型">
            <button
              type="button"
              role="option"
              aria-selected={!settings.modelId}
              className="assistant-model__item"
              onClick={() => {
                setOpen(false);
                onConfigure({ modelId: null });
              }}
            >
              跟随默认
              {defaultModel ? ` · ${defaultModel.modelId}` : "（未配置）"}
            </button>
            {grouped.map(([providerName, groupModels]) => (
              <div
                key={providerName}
                className="assistant-model__group"
                role="group"
                aria-label={providerName}
              >
                <p className="assistant-model__provider mono">{providerName}</p>
                {groupModels.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    role="option"
                    aria-selected={settings.modelId === model.id}
                    className="assistant-model__item"
                    onClick={() => {
                      setOpen(false);
                      onConfigure({ modelId: model.id });
                    }}
                  >
                    {model.modelId}
                  </button>
                ))}
              </div>
            ))}
            {open && (providersQuery.isPending || modelsQuery.isPending) ? (
              <p className="assistant-conv__empty">正在读取模型清单…</p>
            ) : candidates.length === 0 ? (
              <p className="assistant-conv__empty">
                没有与当前模型同协议的其它可用模型
              </p>
            ) : null}
          </div>
          <p className="assistant-model__section mono">思考档</p>
          <div className="assistant-model__efforts">
            {(Object.keys(ASSISTANT_EFFORT_LABELS) as Array<
              keyof typeof ASSISTANT_EFFORT_LABELS
            >).map((level) => (
              <button
                key={level}
                type="button"
                aria-pressed={effort === level}
                className="assistant-model__effort-option"
                onClick={() =>
                  onConfigure({ reasoningEffort: level as string })
                }
              >
                {effort === level ? (
                  <Check size={12} strokeWidth={1.8} aria-hidden="true" />
                ) : null}
                {ASSISTANT_EFFORT_LABELS[level]}
              </button>
            ))}
          </div>
          <p className="assistant-model__note">
            只显示与当前模型同协议（{effectiveProvider?.wireApi ?? "—"}）的模型；
            跨协议请到设置页修改默认生成模型。思考档对下一条消息生效。
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ContextRibbon({
  context,
  usingPageContext,
  onToggleScope,
}: {
  context: AssistantContext;
  usingPageContext: boolean;
  onToggleScope: () => void;
}) {
  const details = contextDetails(context);
  return (
    <div className="assistant-context" aria-label="当前协作上下文">
      <span className="assistant-context__mark" aria-hidden="true" />
      <span>{surfaceLabel(context.surface)}</span>
      {details.map((detail) => (
        <span key={detail} className="assistant-context__detail">
          {detail}
        </span>
      ))}
      <button
        type="button"
        className="assistant-context__scope"
        title={usingPageContext ? "后续消息只使用项目全局上下文" : "后续消息重新跟随当前页面"}
        onClick={onToggleScope}
      >
        {usingPageContext ? "仅看项目" : "跟随页面"}
      </button>
    </div>
  );
}

function AssistantWelcome({ onPrompt }: { onPrompt: (text: string) => void }) {
  const prompts = [
    "概括当前作品状态，并告诉我下一步最值得做什么",
    "检查当前页面涉及的设定与大纲是否一致",
    "列出正在进行或等待我处理的任务",
  ];
  return (
    <section className="assistant-welcome">
      <div className="assistant-welcome__seal" aria-hidden="true">
        <Sparkles size={19} strokeWidth={1.35} />
      </div>
      <p className="assistant-welcome__eyebrow mono">CONTEXT IN HAND</p>
      <h3>从你正在看的地方开始</h3>
      <p>
        我会读取当前作品、页面和选区。分析可以直接回答；写作和任务控制会先列成待确认动作。
      </p>
      <div className="assistant-welcome__prompts">
        {prompts.map((prompt) => (
          <button key={prompt} type="button" onClick={() => onPrompt(prompt)}>
            <span>{prompt}</span>
            <ArrowUp size={13} strokeWidth={1.5} aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}

function MessageEntry({ message }: { message: AssistantMessageDto }) {
  const isAssistant = message.role !== "user";
  return (
    <article
      className="assistant-message"
      data-role={message.role}
      aria-label={isAssistant ? "助手回复" : "你的消息"}
    >
      <header>
        <span className="mono">
          {isAssistant ? "ASSISTANT" : "AUTHOR"}
        </span>
        <time dateTime={message.createdAt}>
          {formatRelativeDate(message.createdAt)}
        </time>
      </header>
      {isAssistant ? (
        <div
          className="assistant-message__body"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
        />
      ) : (
        <p>{message.content}</p>
      )}
    </article>
  );
}

/* 助手回复走受限 Markdown：marked 解析 + DOMPurify 消毒，防 XSS。 */
function renderMarkdown(content: string): string {
  const raw = marked.parse(content, { async: false, gfm: true, breaks: true });
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [
      "p", "br", "strong", "em", "b", "i", "code", "pre", "blockquote",
      "ul", "ol", "li", "h1", "h2", "h3", "h4", "a", "hr", "del", "span",
    ],
    ALLOWED_ATTR: ["href", "title", "target", "rel"],
  });
}

function ActivityEntry({
  projectId,
  activity,
  pending,
  onDecision,
  onCancelTask,
  onRetryChapter,
}: {
  projectId: string;
  activity: AssistantActivityDto;
  pending: boolean;
  onDecision: (
    action: "confirm" | "reject" | "retry" | "resume" | "cancel",
  ) => void;
  onCancelTask: (() => void) | null;
  onRetryChapter: (() => void) | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const href = activityHref(projectId, activity);
  const proposal = activity.availableActions.includes("confirm");
  const retryable = activity.availableActions.includes("retry");
  const resumable = activity.availableActions.includes("resume");
  const cancellable = activity.availableActions.includes("cancel");
  const hasDetail =
    activity.phaseKey !== null ||
    activity.artifacts.length > 0 ||
    activity.lastError !== null ||
    activity.linkedSources.length > 0 ||
    (activity.result !== null && Object.keys(activity.result).length > 0);
  return (
    <article
      className="assistant-activity"
      data-status={activity.status}
      data-kind={activity.kind}
    >
      <div className="assistant-activity__rail" aria-hidden="true">
        <ActivityStatusIcon status={activity.status} />
      </div>
      <div className="assistant-activity__body">
        <header>
          <span className="mono">{activityKindLabel(activity.kind)}</span>
          {activity.skillLabel ? (
            <span className="assistant-activity__skill">{activity.skillLabel}</span>
          ) : null}
          <time dateTime={activity.updatedAt}>
            {formatRelativeDate(activity.updatedAt)}
          </time>
        </header>
        <h3>{activity.goal}</h3>
        <p className="assistant-activity__stage">{activity.stage}</p>
        {activity.summary ? (
          <p className="assistant-activity__summary">{activity.summary}</p>
        ) : null}
        {activity.waitingReason ? (
          <p className="assistant-activity__reason">
            <CircleAlert size={13} strokeWidth={1.5} aria-hidden="true" />
            {stopReasonLabel(activity.waitingReason)}
          </p>
        ) : null}
        {proposal ? (
          <div className="assistant-activity__decisions">
            <button
              type="button"
              className="assistant-activity__confirm"
              disabled={pending}
              onClick={() => onDecision("confirm")}
            >
              <Check size={13} strokeWidth={1.7} aria-hidden="true" />
              {pending ? "正在交办…" : "确认执行"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => onDecision("reject")}
            >
              不执行
            </button>
          </div>
        ) : retryable ? (
          <div className="assistant-activity__decisions">
            <button
              type="button"
              className="assistant-activity__confirm"
              disabled={pending}
              onClick={() => onDecision("retry")}
            >
              {pending ? "正在重试…" : "重试执行"}
            </button>
          </div>
        ) : resumable ? (
          <div className="assistant-activity__decisions">
            <button
              type="button"
              className="assistant-activity__confirm"
              disabled={pending}
              onClick={() => onDecision("resume")}
            >
              {pending ? "正在继续…" : "基于最新内容继续"}
            </button>
            {cancellable ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => onDecision("cancel")}
              >
                取消任务
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="assistant-activity__actions">
          {href ? (
            <Link className="assistant-activity__link" to={href}>
              {activity.status === "waiting" ? "前往处理" : "查看任务现场"}
              <ExternalLink size={12} strokeWidth={1.5} aria-hidden="true" />
            </Link>
          ) : null}
          {cancellable && onCancelTask ? (
            <button
              type="button"
              disabled={pending}
              onClick={onCancelTask}
              title="取消会终止尚未完成的步骤；已保存的正文和版本不会被删除"
            >
              取消任务
            </button>
          ) : null}
          {onRetryChapter ? (
            <button
              type="button"
              disabled={pending}
              onClick={onRetryChapter}
              title="为同一章节重新发起一次 AI 写作任务"
            >
              重试本章
            </button>
          ) : null}
          {hasDetail ? (
            <button
              type="button"
              className="assistant-activity__toggle"
              aria-expanded={expanded}
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? "收起工作轨迹" : "展开工作轨迹"}
            </button>
          ) : null}
        </div>
        {expanded ? (
          <ActivityTrace projectId={projectId} activity={activity} />
        ) : null}
      </div>
    </article>
  );
}

function ActivityTrace({
  projectId,
  activity,
}: {
  projectId: string;
  activity: AssistantActivityDto;
}) {
  return (
    <div className="assistant-trace">
      {activity.phaseKey ? (
        <p className="assistant-trace__row">
          <span className="assistant-trace__label">当前阶段</span>
          <span>{phaseLabel(activity.phaseKey)}</span>
        </p>
      ) : null}
      {activity.lastError ? (
        <p className="assistant-trace__row assistant-trace__row--error">
          <span className="assistant-trace__label">最后错误</span>
          <span>
            {activity.lastError.message}
            <span className="mono"> · {activity.lastError.code}</span>
          </span>
        </p>
      ) : null}
      {activity.artifacts.length > 0 ? (
        <div className="assistant-trace__row">
          <span className="assistant-trace__label">关键产物</span>
          <ul className="assistant-trace__artifacts">
            {activity.artifacts.map((artifact) => (
              <li key={`${artifact.kind}:${artifact.id}`}>
                <Link to={artifactHref(projectId, artifact)}>
                  {artifact.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {activity.linkedSources.length > 0 ? (
        <p className="assistant-trace__row">
          <span className="assistant-trace__label">关联任务</span>
          <span className="mono">
            {activity.linkedSources
              .map((source) => `${source.type === "run" ? "运行" : "会话"} ${shortId(source.id)}`)
              .join(" · ")}
          </span>
        </p>
      ) : null}
      {activity.toolCall ? (
        <p className="assistant-trace__row">
          <span className="assistant-trace__label">领域动作</span>
          <span>{toolCallLabel(activity.toolCall)}</span>
        </p>
      ) : null}
    </div>
  );
}

function phaseLabel(phaseKey: string): string {
  const labels: Record<string, string> = {
    queued: "排队等待",
    preparing: "准备上下文",
    planning: "滚动规划",
    paused: "已暂停",
    awaiting_author: "等待作者处理",
    completed: "已完成",
    cancelled: "已取消",
    failed: "需要处理失败",
    chapter: "章节推进",
    "assistant.context": "读取当前作品",
    "assistant.respond": "理解并组织回复",
    "assistant.stage": "整理结果",
    "canon.context": "读取当前故事板块",
    "canon.candidate": "整理候选修改",
    "canon.stage": "保存待采纳候选",
    "foundation.generate": "整理故事方向",
    "outline.generate": "规划后续章节",
    foundation: "整理故事方向",
    outline: "补齐章节大纲",
    writing: "连续创作章节",
    done: "已完成",
    paused_baseline: "基线变化，等待你处理",
    "context.compile": "装配本章上下文",
    "scene.plan": "规划本章",
    "draft.generate": "写作正文",
    "deterministic.check": "检查正文",
    "semantic.review": "轻量审稿",
    "revision.generate": "修订正文",
    "chapter.settle": "结算故事状态",
    "chapter.commit": "保存本章",
  };
  return labels[phaseKey] ?? phaseKey;
}

function toolCallLabel(toolCall: NonNullable<AssistantActivityDto["toolCall"]>) {
  const labels: Record<string, string> = {
    "story.inspect": "查看故事状态",
    "review.inspect": "查看审稿状态",
    "foundation.start": "整理故事方向",
    "chapter.start": "开始单章写作",
    "autopilot.start": "开始 AI 快速创作",
    "outline.plan.start": "规划后续章节",
    "canon.candidate.start": "生成 Canon 候选修改",
    "selection.edit.start": "修改选中文本",
    "long_goal.start": "启动复合创作任务",
    "task.control": "控制当前任务",
  };
  return labels[toolCall.name] ?? toolCall.name;
}

function artifactHref(
  projectId: string,
  artifact: AssistantActivityDto["artifacts"][number],
): string {
  if (artifact.kind === "canon_change_set") {
    return `${projectWorkspacePath(projectId, "bible")}?focus=${encodeURIComponent(artifact.id)}`;
  }
  if (
    artifact.kind === "edit_proposal" ||
    artifact.kind === "document_version" ||
    artifact.kind === "revision_proposal"
  ) {
    return `${projectWorkspacePath(projectId, "studio")}?focus=${encodeURIComponent(artifact.id)}`;
  }
  if (artifact.kind === "foundation_candidate_set") {
    return projectWorkspacePath(projectId, "overview");
  }
  return projectWorkspacePath(projectId, "runs");
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function timelineEntries(
  detail: AssistantConversationDetailDto | undefined,
): TimelineEntry[] {
  if (!detail) return [];
  const completedReplies = new Set(
    detail.messages.flatMap((message) =>
      message.role === "assistant" && message.sourceRunId
        ? [message.sourceRunId]
        : [],
    ),
  );
  const entries: TimelineEntry[] = [
    ...detail.messages.map(
      (message): TimelineEntry => ({
        type: "message",
        at: message.createdAt,
        id: message.id,
        message,
      }),
    ),
    ...detail.activities
      .filter(
        (activity) =>
          activity.kind !== "assistant_response" ||
          activity.status !== "completed" ||
          !completedReplies.has(activity.sourceId),
      )
      .map(
        (activity): TimelineEntry => ({
          type: "activity",
          at: activity.createdAt,
          id: activity.id,
          activity,
        }),
      ),
  ];
  return entries
    .sort(
      (left, right) =>
        left.at.localeCompare(right.at) ||
        Number(left.type === "activity") - Number(right.type === "activity") ||
        left.id.localeCompare(right.id),
    )
    .slice(-60);
}

function hasLiveActivity(detail: AssistantConversationDetailDto | undefined) {
  return Boolean(
    detail?.activities.some((activity) =>
      ["queued", "running"].includes(activity.status),
    ),
  );
}

function activityActionId(activity: AssistantActivityDto): string | null {
  return activity.kind === "tool" && activity.sourceType === "assistant_tool"
    ? activity.sourceId
    : null;
}

/* 产品决策动作出现在哪，任务现场就在哪：这类 run 卡回写作台处理候选，
   与 taskHref「现场由产品来源推导」同一套取向；没有决策动作的才退回运行中心。 */
const PRODUCT_DECISION_ACTIONS = new Set([
  "accept_plan",
  "accept_manuscript",
  "request_revision",
  "discard_manuscript",
]);

function activityHref(
  projectId: string,
  activity: AssistantActivityDto,
): string | null {
  if (activity.sourceType === "run") {
    if (
      activity.availableActions.some((action) =>
        PRODUCT_DECISION_ACTIONS.has(action),
      )
    ) {
      const params = new URLSearchParams({ run: activity.sourceId });
      const origin = activity.origin;
      if (origin?.documentId) params.set("document", origin.documentId);
      else if (origin?.outlineNodeId)
        params.set("outline", origin.outlineNodeId);
      return `${projectWorkspacePath(projectId, "studio")}?${params.toString()}`;
    }
    return `${projectWorkspacePath(projectId, "runs")}?run=${encodeURIComponent(activity.sourceId)}`;
  }
  if (activity.sourceType === "autopilot") {
    return `${projectWorkspacePath(projectId, "autopilot")}?session=${encodeURIComponent(activity.sourceId)}`;
  }
  return null;
}

function ActivityStatusIcon({
  status,
}: {
  status: AssistantActivityDto["status"];
}) {
  const props = { size: 15, strokeWidth: 1.6, "aria-hidden": true } as const;
  if (status === "completed") return <CircleCheck {...props} />;
  if (status === "failed" || status === "cancelled") {
    return <CircleAlert {...props} />;
  }
  if (status === "waiting" || status === "proposed") {
    return <Clock3 {...props} />;
  }
  if (status === "rejected") return <X {...props} />;
  return <LoaderCircle className="assistant-spin" {...props} />;
}

function activityKindLabel(kind: AssistantActivityDto["kind"]): string {
  if (kind === "tool") return "待确认动作";
  if (kind === "long_goal") return "复合任务";
  if (kind === "assistant_response") return "正在回应";
  return "项目任务";
}

function contextDetails(context: AssistantContext): string[] {
  const details: string[] = [];
  if (context.canonSpread) details.push(canonSpreadLabel(context.canonSpread));
  if (context.outlineNodeId) details.push("当前章节");
  if (context.documentId) details.push("当前稿件");
  if (context.selection && context.selection.end > context.selection.start) {
    details.push(`选中 ${context.selection.end - context.selection.start} 字`);
  }
  return details;
}

function surfaceLabel(surface: string): string {
  const labels: Record<string, string> = {
    overview: "项目概览",
    bible: "故事圣经",
    studio: "写作台",
    autopilot: "AI 快速创作",
    runs: "运行中心",
    lab: "长篇推演",
    delivery: "交付",
  };
  return labels[surface] ?? "项目全局";
}

function canonSpreadLabel(spread: NonNullable<AssistantContext["canonSpread"]>) {
  const labels: Record<typeof spread, string> = {
    intent: "作者意图",
    outline: "大纲",
    entities: "实体",
    facts: "正典事实",
    relations: "关系",
    timeline: "时间线",
    foreshadows: "伏笔",
  };
  return labels[spread];
}

function rememberedConversation(projectId: string): string | null {
  try {
    return window.localStorage.getItem(`${CONVERSATION_KEY_PREFIX}${projectId}`);
  } catch {
    return null;
  }
}

function selectConversation(
  projectId: string,
  conversationId: string | null,
  setConversationId: (value: string | null) => void,
): void {
  setConversationId(conversationId);
  try {
    const key = `${CONVERSATION_KEY_PREFIX}${projectId}`;
    if (conversationId) window.localStorage.setItem(key, conversationId);
    else window.localStorage.removeItem(key);
  } catch {
    /* 私密模式下只保持当前会话状态 */
  }
}

function createRequestId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `assistant-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function invalidateAssistant(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
  conversationId: string | null,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: ["assistant", projectId, "conversations"],
    }),
    conversationId
      ? queryClient.invalidateQueries({
          queryKey: [
            "assistant",
            projectId,
            "conversation",
            conversationId,
          ],
        })
      : Promise.resolve(),
  ]);
}

async function invalidateAssistantDetail(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
  conversationId: string | null,
): Promise<void> {
  if (!conversationId) return;
  await queryClient.invalidateQueries({
    queryKey: ["assistant", projectId, "conversation", conversationId],
  });
}

function assistantRunIds(
  detail: AssistantConversationDetailDto | undefined,
): ReadonlySet<string> {
  const runIds = new Set<string>();
  for (const message of detail?.messages ?? []) {
    if (message.sourceRunId) runIds.add(message.sourceRunId);
  }
  for (const activity of detail?.activities ?? []) {
    if (activity.sourceType === "run") runIds.add(activity.sourceId);
    const currentRunId = activity.result?.currentRunId;
    if (typeof currentRunId === "string") runIds.add(currentRunId);
  }
  return runIds;
}
