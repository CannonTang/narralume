import "../styles/settings.css";
import "../styles/supply.css";
import "../styles/delivery.css";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowLeft, ChevronDown, Edit3, FileCheck2, Network, Plus, Radio, Trash2, Unplug } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";

import {
  currentDriverMode,
  onDriverModeChange,
  readDriverOverride,
  resolveDriverMode,
  setDriverOverride,
  type DriverMode,
} from "../kernel/transport";

import { ConfirmDialog } from "../components/confirm-dialog";
import { ErrorNote } from "../components/error-note";
import { PageBand } from "../components/page-band";
import { Skeleton } from "../components/skeleton";
import {
  downloadLibraryDatabase,
  createModel,
  createProvider,
  createSystemBackup,
  deleteAssignment,
  deleteModel,
  deleteProvider,
  getProjects,
  getSystemBackups,
  listAssignments,
  listModels,
  listProviders,
  previewSystemBackup,
  probeProvider,
  restoreSystemBackup,
  setAssignment,
  updateModel,
  updateProvider,
  type AssignmentRole,
  type ModelConfigDto,
  type ModelTaskType,
  type ProviderProbeResult,
  type PublicProviderDto,
  type SystemBackupPreview,
  type UpsertModelRequest,
  type UpsertProviderRequest,
  type WireApi,
} from "../lib/api";
import { formatBytes, formatRelativeDate, formatTime, shortHash, shortId } from "../lib/fmt";
import {
  assignmentRoleLabel,
  metadataSourceLabel,
  probeStageLabel,
  probeStageStatusLabel,
  wireApiLabel,
} from "../lib/labels";
import { projectWorkspacePath } from "../lib/project-route";
import { ProductionTools } from "./delivery/production-tools";

/* 设置：默认生成模型与岗位继承（写作/规划/审稿在未覆盖时继承默认生成模型）、
   Provider/模型/派岗管理、高级工具（运行中心/长篇推演链接、生产资产、系统备份档）。 */

const PRIMARY_ROLES: AssignmentRole[] = ["writing", "embedding"];
const ADVANCED_ROLES: AssignmentRole[] = ["planning", "review"];
const TASK_TYPES: ModelTaskType[] = [...PRIMARY_ROLES, ...ADVANCED_ROLES];
const WIRE_APIS: WireApi[] = ["openai-chat", "openai-responses", "anthropic-messages"];
const trialMode = import.meta.env.VITE_TRIAL_MODE === "1";

const ROLE_COPY: Record<AssignmentRole, { name: string; note: string }> = {
  writing: {
    name: "默认生成模型",
    note: "写作、规划、审稿的共同基座。规划与审稿不单独指派时继承此项。没有它时，AI 链路不可用；手动创作仍然可用。",
  },
  planning: {
    name: "规划模型（可覆盖）",
    note: "不指派时继承默认生成模型；指派即覆盖规划链路。",
  },
  review: {
    name: "审稿模型（可覆盖）",
    note: "不指派时继承默认生成模型；指派即覆盖审稿链路。",
  },
  embedding: {
    name: "嵌入模型",
    note: "检索与上下文装配专用；不继承，缺省即退化提示。",
  },
  rerank: { name: "重排", note: "" },
};

type DeleteTarget =
  | { kind: "provider"; value: PublicProviderDto }
  | { kind: "model"; value: ModelConfigDto }
  | { kind: "assignment"; value: AssignmentRole };

export function SettingsWorkspace() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const contextProjectId = searchParams.get("project");
  const requestedReturnPath = searchParams.get("return");
  const returnPath = safeProjectReturnPath(contextProjectId, requestedReturnPath);
  const driverMode = useDriverMode();
  const [requestedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [providerEditor, setProviderEditor] = useState<PublicProviderDto | "new" | null>(null);
  const [modelEditor, setModelEditor] = useState<ModelConfigDto | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [toolsProjectId, setToolsProjectId] = useState<string | null>(null);

  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: ({ signal }) => listProviders(signal),
    staleTime: 5_000,
  });
  const modelsQuery = useQuery({
    queryKey: ["models"],
    queryFn: ({ signal }) => listModels(undefined, signal),
    staleTime: 5_000,
  });
  const assignmentsQuery = useQuery({
    queryKey: ["assignments"],
    queryFn: ({ signal }) => listAssignments(signal),
    staleTime: 5_000,
  });
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: ({ signal }) => getProjects(signal),
  });

  const providers = useMemo(() => providersQuery.data ?? [], [providersQuery.data]);
  const allModels = useMemo(() => modelsQuery.data ?? [], [modelsQuery.data]);
  const assignments = useMemo(() => assignmentsQuery.data ?? [], [assignmentsQuery.data]);
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const preferredProjectId = toolsProjectId ?? contextProjectId;
  const toolsProject = projects.find((project) => project.id === preferredProjectId) ?? projects[0] ?? null;

  const selectedProviderId = providers.some((provider) => provider.id === requestedProviderId)
    ? requestedProviderId
    : providers[0]?.id ?? null;

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? null;
  const models = allModels.filter((model) => model.providerId === selectedProviderId);
  const currentProviderEditor = providerEditor === "new" || providerEditor === null
    ? providerEditor
    : providers.find((provider) => provider.id === providerEditor.id) ?? providerEditor;
  const currentModelEditor = modelEditor === "new" || modelEditor === null
    ? modelEditor
    : allModels.find((model) => model.id === modelEditor.id) ?? modelEditor;

  const providerMutation = useMutation({
    mutationFn: (input: { current: PublicProviderDto | null; value: UpsertProviderRequest }) =>
      input.current
        ? updateProvider(input.current.id, {
            ...input.value,
            expectedUpdatedAt: input.current.updatedAt,
          })
        : createProvider(input.value),
    onSuccess: (provider) => {
      setProviderEditor(null);
      setSelectedProviderId(provider.id);
      setNotice("模型渠道已保存，刷新后仍会从服务端恢复。");
      void queryClient.invalidateQueries({ queryKey: ["providers"] });
    },
    onError: () =>
      void queryClient.invalidateQueries({ queryKey: ["providers"] }),
  });
  const modelMutation = useMutation({
    mutationFn: (input: { current: ModelConfigDto | null; value: UpsertModelRequest }) =>
      input.current
        ? updateModel(input.current.id, {
            ...input.value,
            expectedUpdatedAt: input.current.updatedAt,
          })
        : createModel(input.value),
    onSuccess: () => {
      setModelEditor(null);
      setNotice("模型规格已保存。");
      void queryClient.invalidateQueries({ queryKey: ["models"] });
    },
    onError: () =>
      void queryClient.invalidateQueries({ queryKey: ["models"] }),
  });
  const assignMutation = useMutation({
    mutationFn: (input: { role: AssignmentRole; modelId: string }) =>
      setAssignment(input.role, input.modelId),
    onSuccess: () => {
      setNotice("岗位分配已保存。");
      void queryClient.invalidateQueries({ queryKey: ["assignments"] });
    },
  });
  const removeMutation = useMutation({
    mutationFn: async (target: DeleteTarget) => {
      if (target.kind === "provider") await deleteProvider(target.value.id);
      if (target.kind === "model") await deleteModel(target.value.id);
      if (target.kind === "assignment") await deleteAssignment(target.value);
      return target;
    },
    onSuccess: (target) => {
      setDeleteTarget(null);
      setNotice(target.kind === "assignment" ? "岗位已解除。" : "记录已删除。");
      if (target.kind === "provider") {
        setSelectedProviderId(null);
        void queryClient.invalidateQueries({ queryKey: ["providers"] });
      }
      if (target.kind === "model") void queryClient.invalidateQueries({ queryKey: ["models"] });
      void queryClient.invalidateQueries({ queryKey: ["assignments"] });
    },
  });
  const probeMutation = useMutation({
    mutationFn: (input: { providerId: string; modelId: string }) => probeProvider(input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["models"] }),
  });

  const writingAssignment = assignments.find((entry) => entry.role === "writing");
  const enabledProviderIds = new Set(
    providers.filter((provider) => provider.enabled).map((provider) => provider.id),
  );
  const assignable = (model: ModelConfigDto) => model.enabled && enabledProviderIds.has(model.providerId);
  const generationModels = allModels.filter(
    (model) => assignable(model) && ["writing", "planning", "review"].includes(model.taskType),
  );
  const assignmentSourcesPending =
    providersQuery.isPending || modelsQuery.isPending || assignmentsQuery.isPending;
  const assignmentSourcesError =
    providersQuery.error ?? modelsQuery.error ?? assignmentsQuery.error;
  const renderRole = (role: AssignmentRole) => {
    const assignment = assignments.find((entry) => entry.role === role);
    return (
      <RoleCard
        key={role}
        role={role}
        assignedModel={assignment ? allModels.find((model) => model.id === assignment.modelId) : undefined}
        assignmentModelId={assignment?.modelId}
        inheritedModel={role === "planning" || role === "review" ? allModels.find((model) => model.id === writingAssignment?.modelId) : undefined}
        inherited={role === "planning" || role === "review"}
        providers={providers}
        candidates={role === "embedding"
          ? allModels.filter((model) => assignable(model) && model.taskType === "embedding")
          : generationModels}
        pending={assignMutation.isPending && assignMutation.variables?.role === role}
        error={assignMutation.variables?.role === role ? assignMutation.error : null}
        onAssign={(modelId) => assignMutation.mutate({ role, modelId })}
        onRemove={() => setDeleteTarget({ kind: "assignment", value: role })}
      />
    );
  };

  return (
    <div className="settings">
      <PageBand
        index="SETTINGS · S1"
        title="设置"
        meta={
          <span className="settings__band-meta">
            {contextProjectId ? <Link to={returnPath}><ArrowLeft size={12} aria-hidden="true" />返回项目</Link> : null}
            <span className="mono">{providers.length} 个渠道 · {allModels.length} 个模型 · {writingAssignment ? "默认模型已设置" : "默认模型未设置"}</span>
          </span>
        }
      />
      {notice ? <p className="settings__notice" role="status" aria-live="polite">{notice}</p> : null}

      <section className="settings__section" aria-label="默认生成模型与岗位继承">
        <header className="settings__section-head">
          <div><p className="mono">GENERATION</p><h2>默认生成模型与岗位继承</h2></div>
          <p className="settings__section-note">只需选择一个默认生成模型，写作、规划和审稿就会共同使用；嵌入模型独立配置。</p>
        </header>
        <div className="settings__roles">
          {assignmentSourcesPending ? <Skeleton lines={3} /> : assignmentSourcesError ? (
            <ErrorNote error={assignmentSourcesError} title="默认模型配置暂时无法加载" />
          ) : PRIMARY_ROLES.map(renderRole)}
        </div>
        {!assignmentSourcesPending && !assignmentSourcesError ? (
          <details className="settings__advanced-roles">
            <summary>高级覆盖 · 为规划或审稿单独指定模型</summary>
            <p>通常无需设置。只有确实需要不同模型时再覆盖；解除覆盖后会立即恢复继承默认生成模型。</p>
            <div className="settings__roles">{ADVANCED_ROLES.map(renderRole)}</div>
          </details>
        ) : null}
      </section>

      <details className="settings__channel-management" aria-label="渠道与模型管理">
        <summary>
          <span className="settings__channel-summary-copy">
            <span className="mono">CHANNELS</span>
            <strong>渠道与模型管理</strong>
            <span>新增渠道、配置密钥、探测连接或维护模型规格</span>
          </span>
          <span className="settings__channel-summary-meta mono">{providers.length} 渠道 · {allModels.length} 模型</span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <p className="settings__channel-note">普通创作无需进入这里。使用本地浏览器内核时，自带 Key 仅保存在当前浏览器的 OPFS 数据库中，请求会直接发往你填写的 Base URL，不经过内置 Relay；该服务必须允许浏览器跨域访问。</p>
        <div className="supply__layout">
        <section className="supply__column" aria-label="模型渠道">
          <header className="supply__column-head">
            <span className="supply__column-eyebrow">CHANNEL</span>
            <p className="supply__column-title">模型渠道</p>
            <button type="button" className="supply__mini-action" onClick={() => setProviderEditor("new")}>
              <Plus size={12} aria-hidden="true" /> 新建
            </button>
          </header>
          <div className="supply__column-body">
            {currentProviderEditor ? (
              <ProviderForm
                key={currentProviderEditor === "new" ? "new" : currentProviderEditor.id}
                provider={currentProviderEditor === "new" ? null : currentProviderEditor}
                pending={providerMutation.isPending}
                error={providerMutation.error}
                onCancel={() => setProviderEditor(null)}
                onSubmit={(value) => providerMutation.mutate({ current: currentProviderEditor === "new" ? null : currentProviderEditor, value })}
              />
            ) : null}
            {providersQuery.isPending ? <Skeleton lines={4} /> : providersQuery.isError ? (
              <ErrorNote error={providersQuery.error} title="模型服务暂时无法加载" />
            ) : providers.length === 0 ? (
              <p className="supply__empty">尚无模型渠道；先登记一个渠道。</p>
            ) : providers.map((provider) => (
              <div key={provider.id} className="supply__provider-wrap" data-active={provider.id === selectedProviderId}>
                <button type="button" className="supply__provider" onClick={() => setSelectedProviderId(provider.id)}>
                  <span className="supply__provider-name">{provider.name}</span>
                  <span className="supply__provider-kind">{wireApiLabel(provider.wireApi)}</span>
                  <span className="supply__provider-base mono">{provider.baseUrl}</span>
                  <span className="supply__provider-foot">
                    <span className="supply__provider-status" data-on={provider.enabled}>{provider.enabled ? "启用" : "停用"}</span>
                    <span>{allModels.filter((model) => model.providerId === provider.id).length} 模</span>
                  </span>
                </button>
                <div className="supply__item-actions">
                  <button type="button" className="supply__icon-action" aria-label={`编辑模型渠道 ${provider.name}`} onClick={() => setProviderEditor(provider)}><Edit3 size={13} /></button>
                  <button type="button" className="supply__icon-action" aria-label={`删除模型渠道 ${provider.name}`} onClick={() => setDeleteTarget({ kind: "provider", value: provider })}><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="supply__column" aria-label="模型">
          <header className="supply__column-head">
            <span className="supply__column-eyebrow">Model</span>
            <p className="supply__column-title">{selectedProvider ? `${selectedProvider.name} 的模型` : "先选模型渠道"}</p>
            <button type="button" className="supply__mini-action" disabled={!selectedProvider} onClick={() => setModelEditor("new")}>
              <Plus size={12} aria-hidden="true" /> 新建
            </button>
          </header>
          <div className="supply__column-body">
            {currentModelEditor && selectedProvider ? (
              <ModelForm
                key={currentModelEditor === "new" ? `new-${selectedProvider.id}` : currentModelEditor.id}
                providerId={selectedProvider.id}
                model={currentModelEditor === "new" ? null : currentModelEditor}
                pending={modelMutation.isPending}
                error={modelMutation.error}
                onCancel={() => setModelEditor(null)}
                onSubmit={(value) => modelMutation.mutate({ current: currentModelEditor === "new" ? null : currentModelEditor, value })}
              />
            ) : null}
            {!selectedProvider ? <p className="supply__empty">从左侧选一个模型渠道。</p> : modelsQuery.isPending ? (
              <Skeleton lines={4} />
            ) : modelsQuery.isError ? <ErrorNote error={modelsQuery.error} title="模型列表暂时无法加载" /> : models.length === 0 ? (
              <p className="supply__empty">尚无模型；先登记上游模型。上下文与输出上限未知时可以留空。</p>
            ) : models.map((model) => (
              <ModelCard
                key={model.id}
                model={model}
                onEdit={() => setModelEditor(model)}
                onDelete={() => setDeleteTarget({ kind: "model", value: model })}
                onProbe={() => probeMutation.mutate({ providerId: model.providerId, modelId: model.id })}
                probePending={probeMutation.isPending && probeMutation.variables?.modelId === model.id}
                probeData={probeMutation.data?.modelId === model.id ? probeMutation.data : undefined}
                probeError={probeMutation.variables?.modelId === model.id ? probeMutation.error : null}
              />
            ))}
          </div>
        </section>
        </div>
      </details>

      <section className="settings__section" aria-label="高级工具">
        <header className="settings__section-head">
          <div><p className="mono">ADVANCED</p><h2>高级工具</h2></div>
          <p className="settings__section-note">
            {trialMode
              ? "运行账本、长篇推演与生产资产（风格 / Writing Skill / 导入管理）。"
              : "运行账本、长篇推演、生产资产（风格 / Writing Skill / 导入管理）与系统备份档。"}
          </p>
        </header>
        <div className="settings__tools-links">
          {projectsQuery.isPending ? (
            <Skeleton lines={2} />
          ) : projectsQuery.isError ? (
            <ErrorNote error={projectsQuery.error} title="项目清单暂时无法加载" />
          ) : toolsProject ? (
            <>
              <Link className="settings__tool-link" to={projectWorkspacePath(toolsProject.id, "runs")}>运行中心 · {toolsProject.title}</Link>
              <Link className="settings__tool-link" to={projectWorkspacePath(toolsProject.id, "lab")}>长篇推演 · {toolsProject.title}</Link>
            </>
          ) : (
            <p className="supply__empty">尚无项目；高级工具的项目页链接将在有项目时出现。</p>
          )}
          {!projectsQuery.isPending && !projectsQuery.isError && projects.length > 0 ? (
            <label className="settings__project-pick">
              生产资产所属项目
              <select value={toolsProject?.id ?? ""} onChange={(event) => setToolsProjectId(event.target.value || null)}>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.title}{project.subtitle ? ` · ${project.subtitle}` : ""} · {shortId(project.id)}</option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {!projectsQuery.isPending && !projectsQuery.isError && toolsProject ? (
          <ProductionTools key={toolsProject.id} projectId={toolsProject.id} />
        ) : null}
      </section>

      <section className="settings__section" aria-label="运行驱动">
        <header className="settings__section-head">
          <div><p className="mono">DRIVER</p><h2>运行驱动</h2></div>
          <p className="settings__section-note">当前 {driverMode === "local" ? "本地内核（数据保存在此浏览器的 OPFS 中）" : driverMode === "server" ? "本地服务（Node API）" : "探测中"}；切换后刷新页面生效，清除选择则恢复自动探测。</p>
        </header>
        <DriverSwitch />
      </section>

      {trialMode ? null : <SystemBackupsSection />}

      {deleteTarget ? (
        <ConfirmDialog
          title={deleteTarget.kind === "assignment" ? "解除岗位分配" : "删除供给记录"}
          confirmLabel={deleteTarget.kind === "assignment" ? "解除" : "删除"}
          danger
          pending={removeMutation.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => removeMutation.mutate(deleteTarget)}
        >
          <p>{deleteDescription(deleteTarget)}</p>
          {removeMutation.isError ? <ErrorNote error={removeMutation.error} title="操作未完成" /> : null}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

/* ---- 运行驱动（M3：server API / 浏览器本地内核） ----------------------------- */

function useDriverMode(): DriverMode {
  const [mode, setMode] = useState(currentDriverMode());
  useEffect(() => {
    void resolveDriverMode();
    return onDriverModeChange(setMode);
  }, []);
  return mode;
}

function DriverSwitch() {
  const mode = useDriverMode();
  const override = readDriverOverride();
  const [pendingReload, setPendingReload] = useState(false);
  const [storageState, setStorageState] = useState<
    "unknown" | "granted" | "denied"
  >("unknown");
  const [storageEstimate, setStorageEstimate] = useState<{
    usage: number;
    quota: number;
  } | null>(null);
  const [lastExportAt, setLastExportAt] = useState<string | null>(() =>
    window.localStorage.getItem("narralume:local-db-last-export"),
  );
  const effective = override ?? mode;
  useEffect(() => {
    if (effective !== "local" || !navigator.storage) return;
    let active = true;
    void Promise.all([
      navigator.storage.persisted(),
      navigator.storage.estimate(),
    ]).then(([persisted, estimate]) => {
      if (!active) return;
      setStorageState(persisted ? "granted" : "denied");
      if (estimate.usage !== undefined && estimate.quota !== undefined)
        setStorageEstimate({ usage: estimate.usage, quota: estimate.quota });
    });
    return () => {
      active = false;
    };
  }, [effective]);
  const downloadMutation = useMutation({
    mutationFn: async () => {
      // 下载我的库（D6）：local 驱动从内核取 bytes；server 驱动提示用系统备份。
      const { blob, filename } = await downloadLibraryDatabase();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename ?? "narralume.sqlite";
      anchor.click();
      URL.revokeObjectURL(url);
      const exportedAt = new Date().toISOString();
      window.localStorage.setItem("narralume:local-db-last-export", exportedAt);
      setLastExportAt(exportedAt);
    },
  });
  const requestPersistence = async () => {
    if (!navigator.storage?.persist) return;
    const granted = await navigator.storage.persist();
    setStorageState(granted ? "granted" : "denied");
  };
  return (
    <div className="settings__tools-links">
      <label className="settings__project-pick">
        运行驱动
        <select
          value={override ?? "auto"}
          disabled={pendingReload}
          onChange={(event) => {
            const next = event.target.value;
            setDriverOverride(next === "auto" ? null : (next as "server" | "local"));
            setPendingReload(true);
            window.location.reload();
          }}
        >
          <option value="auto">自动探测（默认）</option>
          <option value="server">本地服务（Node API）</option>
          <option value="local">浏览器本地内核</option>
        </select>
      </label>
      <button
        type="button"
        className="settings__tool-link"
        disabled={effective !== "local" || downloadMutation.isPending}
        title={effective === "local" ? "导出浏览器库的完整 SQLite 文件（含项目、稿件与运行历史）" : "仅浏览器本地内核模式可用；本地服务模式请用下方系统备份档"}
        onClick={() => downloadMutation.mutate()}
      >
        {downloadMutation.isPending ? "导出中…" : "下载我的库（.sqlite）"}
      </button>
      {downloadMutation.isError ? (
        <ErrorNote error={downloadMutation.error} title="库导出失败" />
      ) : null}
      <p className="settings__section-note">
        当前生效：{effective === "local" ? "浏览器本地内核" : effective === "server" ? "本地服务（Node API）" : "探测中"}
        {override ? "（手动指定）" : "（自动探测）"}
      </p>
      {effective === "local" ? (
        <>
          <p className="settings__section-note">
            数据仅存于此浏览器的 OPFS 中：清站点数据即清空，导出 .sqlite 前请勿放置真实作品。
          </p>
          <p className="settings__section-note">
            持久存储：{storageState === "granted" ? "已授权" : storageState === "denied" ? "未授权（浏览器仍可能回收）" : "读取中…"}
            {storageEstimate ? ` · 已用 ${formatBytes(storageEstimate.usage)} / 估算上限 ${formatBytes(storageEstimate.quota)}` : ""}
            {lastExportAt ? ` · 最近导出 ${formatRelativeDate(lastExportAt)}` : " · 尚未导出备份"}
          </p>
          <button
            type="button"
            className="settings__tool-link"
            onClick={() => void requestPersistence()}
            disabled={storageState === "granted" || !navigator.storage?.persist}
          >
            {storageState === "granted" ? "持久存储已授权" : "请求浏览器持久存储"}
          </button>
        </>
      ) : null}
    </div>
  );
}

/* ---- 系统备份档（从交付迁入：整库备份、校档与灾备恢复） ---------------------- */

function SystemBackupsSection() {
  const queryClient = useQueryClient();
  const systemBackupsQuery = useQuery({
    queryKey: ["system-backups"],
    queryFn: ({ signal }) => getSystemBackups(signal),
    staleTime: 10_000,
  });
  const [previewBackupId, setPreviewBackupId] = useState<string | null>(null);
  const [systemRestoreTarget, setSystemRestoreTarget] = useState<SystemBackupPreview | null>(null);
  const [restoreDirectory, setRestoreDirectory] = useState("");
  const [systemRestoreResult, setSystemRestoreResult] = useState<string | null>(null);

  const backupCreateMutation = useMutation({
    mutationFn: (label: string) => createSystemBackup(label),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["system-backups"] }),
  });
  const backupPreviewMutation = useMutation({
    mutationFn: (backupId: string) => previewSystemBackup(backupId),
    onSuccess: (data) => setPreviewBackupId(data.manifest.id),
  });
  const systemRestoreMutation = useMutation({
    mutationFn: () => restoreSystemBackup(systemRestoreTarget!.manifest.id, restoreDirectory.trim(), false),
    onSuccess: (result) => {
      setSystemRestoreResult(`整库已恢复到 ${result.databasePath}；哈希 ${result.sha256}`);
      setSystemRestoreTarget(null);
      setRestoreDirectory("");
    },
  });

  const backups = useMemo(() => systemBackupsQuery.data ?? [], [systemBackupsQuery.data]);

  return (
    <section className="settings__section delivery__section--backups" aria-label="系统备份档">
      <header className="settings__section-head">
        <div>
          <p className="mono">DISASTER</p>
          <h2><Archive size={13} strokeWidth={2} aria-hidden="true" /> 系统备份档</h2>
        </div>
        <button
          type="button"
          className="delivery__backup-new"
          onClick={() => backupCreateMutation.mutate(`定期整备 ${new Date().toISOString().slice(0, 16)}`)}
          disabled={backupCreateMutation.isPending}
          aria-label="新备一份全库"
        >
          <Plus size={12} strokeWidth={2} aria-hidden="true" />
          备一份
        </button>
      </header>
      {systemBackupsQuery.isPending ? (
        <Skeleton lines={3} />
      ) : systemBackupsQuery.isError ? (
        <ErrorNote error={systemBackupsQuery.error} title="备份清单暂时无法加载" />
      ) : backups.length === 0 ? (
        <p className="delivery__empty">尚未备过。首份庋藏性备份从这里起。</p>
      ) : (
        <ol className="delivery__backups">
          {backups.map((backup) => (
            <li key={backup.id} className="delivery__backup-row">
              <span className="delivery__backup-label">{backup.label}</span>
              <span className="delivery__backup-meta mono">
                {formatBytes(backup.sizeBytes)} · 档 {backup.pageCount} 页 · 书 {backup.projectCount} 册 · {formatRelativeDate(backup.createdAt)}
              </span>
              <span className="delivery__backup-hash mono">{shortHash(backup.sha256)}</span>
              <button
                type="button"
                className="delivery__backup-preview-btn"
                onClick={() => backupPreviewMutation.mutate(backup.id)}
                disabled={backupPreviewMutation.isPending}
                aria-label={`预览备份 ${backup.label} 的完整性`}
              >
                <FileCheck2 size={12} strokeWidth={2} aria-hidden="true" />
                预览
              </button>
            </li>
          ))}
        </ol>
      )}
      {previewBackupId ? (
        <BackupPreviewPane
          backupId={previewBackupId}
          preview={backupPreviewMutation.data ?? null}
          onClose={() => setPreviewBackupId(null)}
          onRestore={(preview) => {
            setSystemRestoreTarget(preview);
            setRestoreDirectory("");
          }}
        />
      ) : null}
      {systemRestoreResult ? <p className="delivery__restore-result" role="status">{systemRestoreResult}</p> : null}
      {systemRestoreTarget ? (
        <ConfirmDialog
          title="恢复整库灾备"
          confirmLabel="恢复到目标目录"
          danger
          pending={systemRestoreMutation.isPending}
          confirmDisabled={!restoreDirectory.trim()}
          onCancel={() => setSystemRestoreTarget(null)}
          onConfirm={() => systemRestoreMutation.mutate()}
        >
          <p>校验哈希：{systemRestoreTarget.manifest.sha256}</p>
          <p>完整性：{systemRestoreTarget.integrityCheck}；外键违例：{systemRestoreTarget.foreignKeyViolations}；项目：{systemRestoreTarget.counts.projects}。本操作不会覆盖当前数据库，目标目录必须与当前数据目录不同且默认禁止覆盖。</p>
          <label className="delivery__restore-directory">服务端目标目录<input value={restoreDirectory} onChange={(event) => setRestoreDirectory(event.target.value)} placeholder="E:\\novel-restored-data" /></label>
          {!restoreDirectory.trim() ? <p className="delivery__restore-warning">填写目标目录后才能确认。</p> : null}
          {systemRestoreMutation.isError ? <ErrorNote error={systemRestoreMutation.error} title="整库未恢复" /> : null}
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

function BackupPreviewPane({
  backupId,
  preview,
  onClose,
  onRestore,
}: {
  backupId: string;
  preview: SystemBackupPreview | null;
  onClose: () => void;
  onRestore: (preview: SystemBackupPreview) => void;
}) {
  return (
    <div className="delivery__backup-preview" role="note">
      <header className="delivery__backup-preview-head">
        <p className="delivery__backup-preview-title mono">
          校档 · {backupId.slice(0, 8)}
        </p>
        <button type="button" onClick={onClose} aria-label="合上校档">
          合上
        </button>
      </header>
      {!preview ? (
        <Skeleton lines={2} />
      ) : (
        <dl className="delivery__backup-preview-body">
          <div>
            <dt>包名</dt>
            <dd className="mono">{preview.manifest.label}</dd>
          </div>
          <div>
            <dt>哈希</dt>
            <dd className="mono">{shortHash(preview.manifest.sha256)}</dd>
          </div>
          <div>
            <dt>庋藏</dt>
            <dd>
              {formatTime(preview.manifest.createdAt)}
              {" · "}
              {formatBytes(preview.manifest.sizeBytes)}
              {" · "}档{preview.manifest.pageCount}
            </dd>
          </div>
          <div>
            <dt>哈希校</dt>
            <dd data-ok={preview.hashMatches}>
              {preview.hashMatches ? "合" : "不合"}
            </dd>
          </div>
          <div>
            <dt>完整性</dt>
            <dd>{preview.integrityCheck}</dd>
          </div>
          <div>
            <dt>外键违例</dt>
            <dd data-ok={preview.foreignKeyViolations === 0}>
              {preview.foreignKeyViolations}
            </dd>
          </div>
          <div>
            <dt>册数</dt>
            <dd>
              书 {preview.counts.projects} · 稿 {preview.counts.documents} · 版{" "}
              {preview.counts.versions} · 典 {preview.counts.canonFacts} · 行{" "}
              {preview.counts.runs}
            </dd>
          </div>
        </dl>
      )}
      {preview?.valid && preview.hashMatches && preview.foreignKeyViolations === 0 ? <button type="button" className="btn btn--primary" onClick={() => onRestore(preview)}>恢复到新目录</button> : null}
    </div>
  );
}

/* ---- Provider / 模型管理（从供给迁入） --------------------------------------- */

function ProviderForm({ provider, pending, error, onCancel, onSubmit }: {
  provider: PublicProviderDto | null;
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onSubmit: (value: UpsertProviderRequest) => void;
}) {
  const [name, setName] = useState(provider?.name ?? "");
  const [wireApi, setWireApi] = useState<WireApi>(provider?.wireApi ?? "openai-chat");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [endpoint, setEndpoint] = useState(provider?.endpoint ?? "");
  const [credentialRef, setCredentialRef] = useState("");
  const [anthropicVersion, setAnthropicVersion] = useState(provider?.anthropicVersion ?? "");
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [localError, setLocalError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!provider && !credentialRef.trim()) {
      setLocalError("新建模型渠道必须填写密钥或 env:NAME 引用。");
      return;
    }
    const value: UpsertProviderRequest = {
      name: name.trim(), wireApi, baseUrl: baseUrl.trim(), endpoint: endpoint.trim() || null,
      anthropicVersion: anthropicVersion.trim() || null, headers: provider?.headers ?? {},
      queryParams: provider?.queryParams ?? {}, requestStartTimeoutMs: provider?.requestStartTimeoutMs ?? null,
      streamIdleTimeoutMs: provider?.streamIdleTimeoutMs ?? null, enabled,
      ...(credentialRef.trim() ? { credentialRef: credentialRef.trim() } : {}),
    };
    onSubmit(value);
  };
  return (
    <form className="supply__editor" onSubmit={submit}>
      <h3>{provider ? "编辑模型渠道" : "新建模型渠道"}</h3>
      <label>渠道名称<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>协议<select value={wireApi} onChange={(event) => setWireApi(event.target.value as WireApi)}>{WIRE_APIS.map((value) => <option key={value} value={value}>{wireApiLabel(value)}</option>)}</select></label>
      <label>Base URL<input required type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" /></label>
      <label>Endpoint（可选）<input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} /></label>
      <label>{provider ? "密钥（留空保持原值）" : "密钥或 env:NAME"}<input type="password" value={credentialRef} onChange={(event) => setCredentialRef(event.target.value)} autoComplete="off" /></label>
      {wireApi === "anthropic-messages" ? <label>Anthropic Version<input value={anthropicVersion} onChange={(event) => setAnthropicVersion(event.target.value)} /></label> : null}
      <label className="supply__check"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />启用</label>
      {localError ? <p className="supply__local-error" role="alert">{localError}</p> : null}
      {error ? <ErrorNote error={error} title="模型渠道未保存" /> : null}
      <div className="supply__editor-actions"><button type="button" className="btn" onClick={onCancel}>取消</button><button type="submit" className="btn btn--primary" disabled={pending}>{pending ? "保存中…" : "保存"}</button></div>
    </form>
  );
}

function ModelForm({ providerId, model, pending, error, onCancel, onSubmit }: {
  providerId: string;
  model: ModelConfigDto | null;
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onSubmit: (value: UpsertModelRequest) => void;
}) {
  const [modelId, setModelId] = useState(model?.modelId ?? "");
  const [taskType, setTaskType] = useState<ModelTaskType>(model?.taskType ?? "writing");
  const [contextWindow, setContextWindow] = useState(model?.contextWindow?.toString() ?? "");
  const [maxOutputTokens, setMaxOutputTokens] = useState(model?.maxOutputTokens?.toString() ?? "");
  const [enabled, setEnabled] = useState(model?.enabled ?? true);
  return (
    <form className="supply__editor" onSubmit={(event) => {
      event.preventDefault();
      onSubmit({
        providerId, modelId: modelId.trim(), taskType,
        contextWindow: contextWindow ? Number(contextWindow) : null,
        maxOutputTokens: maxOutputTokens ? Number(maxOutputTokens) : null,
        sampling: model?.sampling ?? {}, capabilities: model?.capabilities ?? {}, enabled,
      });
    }}>
      <h3>{model ? "编辑模型" : "新建模型"}</h3>
      <label>上游模型名<input required value={modelId} onChange={(event) => setModelId(event.target.value)} /></label>
      <label>模型类型<select value={taskType} onChange={(event) => setTaskType(event.target.value as ModelTaskType)}>{TASK_TYPES.map((value) => <option key={value} value={value}>{assignmentRoleLabel(value)}</option>)}</select><span className="supply__field-hint">生成类模型可共同用于写作、规划与审稿；这里只记录它最常用的方向。</span></label>
      <label>上下文上限<input type="number" min="1" value={contextWindow} onChange={(event) => setContextWindow(event.target.value)} placeholder="未知可留空" /></label>
      <label>输出上限<input type="number" min="1" value={maxOutputTokens} onChange={(event) => setMaxOutputTokens(event.target.value)} placeholder="未知可留空" /></label>
      <label className="supply__check"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />启用</label>
      {error ? <ErrorNote error={error} title="模型未保存" /> : null}
      <div className="supply__editor-actions"><button type="button" className="btn" onClick={onCancel}>取消</button><button type="submit" className="btn btn--primary" disabled={pending}>{pending ? "保存中…" : "保存"}</button></div>
    </form>
  );
}

function ModelCard({ model, onEdit, onDelete, onProbe, probePending, probeData, probeError }: {
  model: ModelConfigDto;
  onEdit: () => void;
  onDelete: () => void;
  onProbe: () => void;
  probePending: boolean;
  probeData: ProviderProbeResult | undefined;
  probeError: unknown;
}) {
  const lacksLimits = model.contextWindow === null || model.maxOutputTokens === null;
  return (
    <article className="supply__model" data-enabled={model.enabled} aria-label={`模型 ${model.modelId}`}>
      <div className="supply__model-head"><span className="supply__model-id">{model.modelId}</span><span className="supply__model-task">{assignmentRoleLabel(model.taskType)}</span></div>
      <div className="supply__model-meta">
        <span><strong>{model.contextWindow === null ? "未知" : model.contextWindow === 0 ? "0" : `${Math.round(model.contextWindow / 1000)}k`}</strong> 上下文</span>
        <span><strong>{model.maxOutputTokens === null ? "未知" : model.maxOutputTokens === 0 ? "0" : `${Math.round(model.maxOutputTokens / 1000)}k`}</strong> 输出</span>
        <span>{model.enabled ? "启用" : "停用"}</span><span>{metadataSourceLabel(model.metadataSource)}</span>
        {model.metadataStale ? <span className="supply__warn">规格待复核</span> : null}
      </div>
      {lacksLimits && ["writing", "planning", "review"].includes(model.taskType) ? <p className="supply__model-missing">上限尚未确认；可以正常使用，运行时会采用保守预算。</p> : null}
      <div className="supply__item-actions supply__item-actions--model">
        <button type="button" className="btn" onClick={onProbe} disabled={probePending}><Radio size={12} /> {probePending ? "探测中…" : "探测"}</button>
        <button type="button" className="btn" onClick={onEdit}><Edit3 size={12} /> 编辑</button>
        <button type="button" className="btn" onClick={onDelete}><Trash2 size={12} /> 删除</button>
      </div>
      {probeError ? <ErrorNote error={probeError} title="探测失败" /> : null}
      {probeData ? <ProbeReport result={probeData} /> : null}
    </article>
  );
}

function ProbeReport({ result }: { result: ProviderProbeResult }) {
  return (
    <div className="supply__probe"><p className="supply__probe-title">探测结果</p><div className="supply__probe-body">
      {result.stages.map((stage) => <div key={stage.stage} className="supply__probe-row">
        <span className="supply__probe-stage">{probeStageLabel(stage.stage)}</span>
        <span className="supply__probe-status" data-s={stage.status}>{probeStageStatusLabel(stage.status)}</span>
        <span className="supply__probe-latency">{stage.latencyMs} ms</span>
        <span className="supply__probe-detail">{stage.detail}</span>
      </div>)}
    </div></div>
  );
}

/* ---- 岗位卡：含继承语义的生成模型岗 ------------------------------------------- */

function RoleCard({ role, assignedModel, assignmentModelId, inheritedModel, inherited, providers, candidates, pending, error, onAssign, onRemove }: {
  role: AssignmentRole;
  assignedModel: ModelConfigDto | undefined;
  assignmentModelId: string | undefined;
  inheritedModel: ModelConfigDto | undefined;
  inherited: boolean;
  providers: PublicProviderDto[];
  candidates: ModelConfigDto[];
  pending: boolean;
  error: unknown;
  onAssign: (modelId: string) => void;
  onRemove: () => void;
}) {
  const inheritedActive = inherited && !assignmentModelId && inheritedModel;
  return (
    <div className="supply__role" role="group" aria-label={ROLE_COPY[role].name}>
      <div className="supply__role-head">
        <span className="supply__role-name">{ROLE_COPY[role].name}</span>
        <span className="supply__role-status" data-ready={Boolean(assignmentModelId) || Boolean(inheritedActive)}>
          {assignmentModelId ? "已派" : inheritedActive ? "继承默认" : "待派"}
        </span>
      </div>
      <p className="supply__role-description">{ROLE_COPY[role].note}</p>
      <div className="supply__role-model" data-unset={!assignmentModelId}>
        {assignedModel ? <><strong>{modelDisplayName(assignedModel, providers)}</strong> · {assignedModel.enabled ? "启用" : "停用"}</> : assignmentModelId ? <>配置已失效</> : inheritedActive ? <>继承默认生成模型 <strong>{modelDisplayName(inheritedModel, providers)}</strong></> : <>未被接起</>}
      </div>
      <div className="supply__role-actions">
        {candidates.map((model) => <button key={model.id} type="button" className="supply__role-assign-btn" disabled={pending || model.id === assignmentModelId} onClick={() => onAssign(model.id)}><Network size={12} /> {modelDisplayName(model, providers)}</button>)}
        {assignmentModelId ? <button type="button" className="supply__role-assign-btn" disabled={pending} onClick={onRemove}><Unplug size={12} /> 解除{inherited ? "覆盖，回继承" : ""}</button> : null}
      </div>
      {candidates.length === 0 ? <p className="supply__role-empty">没有可用于此处的已启用模型。</p> : null}
      {error ? <ErrorNote error={error} title="派岗未完成" /> : null}
    </div>
  );
}

function deleteDescription(target: DeleteTarget): string {
  if (target.kind === "assignment") {
    const base = `解除${ROLE_COPY[target.value].name}的指派`;
    return target.value === "writing"
      ? `${base}后，AI 链路不可用（手动创作仍然可用）。`
      : `${base}后该岗回落继承默认生成模型。`;
  }
  if (target.kind === "provider") return `将删除模型渠道「${target.value.name}」。若仍有模型、派岗或环境托管约束，服务端会拒绝并给出下一步。`;
  return `将删除模型「${target.value.modelId}」。若仍被岗位或运行历史引用，服务端会拒绝并给出下一步。`;
}

function modelDisplayName(model: ModelConfigDto | undefined, providers: PublicProviderDto[]): string {
  if (!model) return "未知模型";
  const channelName = providers.find((provider) => provider.id === model.providerId)?.name ?? "未知渠道";
  return `${channelName} · ${model.modelId}`;
}

function safeProjectReturnPath(projectId: string | null, requestedPath: string | null): string {
  if (!projectId) return "/shelf";
  const projectRoot = `/projects/${encodeURIComponent(projectId)}/`;
  return requestedPath?.startsWith(projectRoot)
    ? requestedPath
    : `${projectRoot}overview`;
}
