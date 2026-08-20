/* 交付：印务校样。质量门（装印规格）+ 五格式出厂 + 创作内容快照。
   系统备份档、生产资产与供给管理已迁入设置。 */

import "../styles/delivery.css";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CheckCircle2,
  Download,
  Loader2,
  Plus,
  Truck,
  XCircle,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { ConfirmDialog } from "../components/confirm-dialog";
import { ErrorNote } from "../components/error-note";
import { PageBand } from "../components/page-band";
import { ProjectRequiredState } from "../components/project-required-state";
import { Skeleton } from "../components/skeleton";
import {
  createProjectBackup,
  getProjectBackups,
  getProjectExport,
  getProjectQuality,
  restoreProjectBackup,
  type BundleCounts,
  type ExportFormat,
  type ProjectQualityReport,
  type ProjectBackup,
} from "../lib/api";
import { formatBytes, formatRelativeDate, shortHash } from "../lib/fmt";
import { exportFormatLabel } from "../lib/labels";
import { useProjectId } from "../lib/project-route";
import { projectWorkspacePath } from "../lib/project-route";

/* 五格式按「成书近 → 数据远」的顺序排 */
const EXPORT_FORMATS: ExportFormat[] = [
  "markdown",
  "text",
  "docx",
  "epub",
  "narrative-bundle",
];

const READINESS_LABEL: Record<ProjectQualityReport["readiness"], string> = {
  ready: "可交付",
  needs_attention: "建议检查",
  blocked: "有风险，仍可导出",
};

const QUALITY_METRIC_LABEL: Record<string, string> = {
  outlineNodes: "大纲节点",
  chapters: "章节",
  committedChapters: "已定稿章节",
  documents: "文档",
  versions: "正文版本",
  manuscriptCharacters: "正文字符",
  entities: "人物与事物",
  facts: "故事事实",
  candidateFacts: "待确认事实",
  unresolvedForeshadows: "未收束伏笔",
  openComments: "未解决批注",
  activeStyleProfiles: "启用风格",
  enabledSkills: "启用写作技能",
};

const ISSUE_CATEGORY_LABEL: Record<
  ProjectQualityReport["issues"][number]["category"],
  string
> = {
  structure: "结构",
  manuscript: "稿",
  canon: "典",
  continuity: "连戏",
  workflow: "流程",
};

const ISSUE_SEVERITY_LABEL: Record<
  ProjectQualityReport["issues"][number]["severity"],
  string
> = {
  info: "注",
  warning: "警",
  error: "错",
};

export function DeliveryWorkspace() {
  const projectId = useProjectId();
  const queryClient = useQueryClient();

  const qualityQuery = useQuery({
    queryKey: ["project", projectId, "quality"],
    queryFn: ({ signal }) => getProjectQuality(projectId!, signal),
    enabled: Boolean(projectId),
    staleTime: 10_000,
  });

  const projectBackupsQuery = useQuery({
    queryKey: ["project", projectId, "backups"],
    queryFn: ({ signal }) => getProjectBackups(projectId!, signal),
    enabled: Boolean(projectId),
  });


  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(
    null,
  );
  const [projectBackupLabel, setProjectBackupLabel] = useState("");
  const [restoreTarget, setRestoreTarget] = useState<ProjectBackup | null>(null);
  const [restoredProjectId, setRestoredProjectId] = useState<string | null>(null);
  const restoreRequestRef = useRef<{ backupId: string; requestId: string } | null>(null);
  const [exportError, setExportError] = useState<unknown>(null);

  const projectBackupCreateMutation = useMutation({
    mutationFn: (label: string) => createProjectBackup(projectId!, label),
    onSuccess: () => {
      setProjectBackupLabel("");
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "backups"] });
    },
  });
  const projectRestoreMutation = useMutation({
    mutationFn: (backup: ProjectBackup) => {
      if (restoreRequestRef.current?.backupId !== backup.id) {
        restoreRequestRef.current = {
          backupId: backup.id,
          requestId: crypto.randomUUID(),
        };
      }
      return restoreProjectBackup(backup.id, restoreRequestRef.current.requestId);
    },
    onSuccess: (result) => {
      restoreRequestRef.current = null;
      setRestoreTarget(null);
      setRestoredProjectId(result.projectId);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "backups"] });
    },
  });
  const quality = qualityQuery.data ?? null;
  const gatesPassed = useMemo(
    () => quality?.gates.filter((g) => g.passed).length ?? 0,
    [quality?.gates],
  );

  if (!projectId) {
    return (
      <div className="delivery">
        <ProjectRequiredState
          seal="付"
          title="交付"
          description="选定作品后，在这里检查成书质量、导出稿件，并保存可恢复的内容快照。"
        />
      </div>
    );
  }

  const handleExport = async (format: ExportFormat) => {
    setExportingFormat(format);
    setExportError(null);
    try {
      const { blob, filename } = await getProjectExport(projectId, format);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error);
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <div className="delivery">
      <PageBand
        index="PRESS · 05"
        title="交付"
        meta={
          <span className="mono">
            装印规格 · 出厂 {EXPORT_FORMATS.length} 种
          </span>
        }
      />

      <div className="delivery__spread">
        {/* 左：装印规格（质量门）与五格式出厂 */}
        <section className="delivery__ledger">
          <div className="delivery__section delivery__section--gates">
            <header className="delivery__section-head">
              <p className="delivery__section-title">
                <CheckCircle2 size={13} strokeWidth={2} aria-hidden="true" />
                装印规格（质量门）
              </p>
              {quality ? (
                <span
                  className="delivery__readiness mono"
                  data-r={quality.readiness}
                >
                  {READINESS_LABEL[quality.readiness]} ·{" "}
                  {gatesPassed}/{quality.gates.length}
                </span>
              ) : null}
            </header>
            {quality ? <p className="delivery__quality-note">质量检查只提供提醒，不会影响下载。发现风险时，建议先查看下面未通过的项目。</p> : null}
            {qualityQuery.isPending ? (
              <Skeleton lines={5} />
            ) : qualityQuery.isError ? (
              <ErrorNote error={qualityQuery.error} title="质量检查暂时无法加载" />
            ) : quality ? (
              <div className="delivery__gates">
                {quality.gates.map((gate) => (
                  <div
                    key={gate.id}
                    className="delivery__gate"
                    data-pass={gate.passed}
                  >
                    <span className="delivery__gate-icon" aria-hidden="true">
                      {gate.passed ? (
                        <CheckCircle2 size={14} strokeWidth={2} />
                      ) : (
                        <XCircle size={14} strokeWidth={2} />
                      )}
                    </span>
                    <span className="delivery__gate-label">{gate.label}</span>
                    <span className="delivery__gate-message">
                      {gate.message}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {quality && quality.issues.length > 0 ? (
              <div className="delivery__issues">
                <p className="delivery__issues-head mono">
                  校样注 · {quality.issues.length}
                </p>
                {quality.issues.map((issue) => (
                  <div
                    key={issue.id}
                    className="delivery__issue"
                    data-s={issue.severity}
                  >
                    <span className="delivery__issue-cat mono">
                      {ISSUE_CATEGORY_LABEL[issue.category]}
                    </span>
                    <span className="delivery__issue-severity mono">
                      {ISSUE_SEVERITY_LABEL[issue.severity]}
                    </span>
                    <p className="delivery__issue-message">{issue.message}</p>
                    {issue.suggestion ? (
                      <p className="delivery__issue-hint">{issue.suggestion}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="delivery__section delivery__section--exports">
            <header className="delivery__section-head">
              <p className="delivery__section-title">
                <Truck size={13} strokeWidth={2} aria-hidden="true" />
                导出格式
              </p>
              <span className="delivery__section-meta mono">
                选择格式后立即下载；质量检查不会禁止导出
              </span>
            </header>
            <ol className="delivery__exports">
              {EXPORT_FORMATS.map((format) => (
                <li key={format} className="delivery__export">
                  <span className="delivery__export-format mono">
                    {format}
                  </span>
                  <span className="delivery__export-label">
                    {exportFormatLabel(format)}
                  </span>
                  <button
                    type="button"
                    className="delivery__export-btn"
                    onClick={() => void handleExport(format)}
                    disabled={exportingFormat !== null}
                    aria-label={`以 ${exportFormatLabel(format)} 导出当前作品`}
                  >
                    {exportingFormat === format ? (
                      <Loader2
                        size={12}
                        strokeWidth={2}
                        aria-hidden="true"
                        className="delivery__export-spin"
                      />
                    ) : (
                      <Download size={12} strokeWidth={2} aria-hidden="true" />
                    )}
                    下载
                  </button>
                </li>
              ))}
            </ol>
            {quality?.metrics ? (
              <p className="delivery__metrics mono">
                {Object.entries(quality.metrics)
                  .map(([key, value]) => `${QUALITY_METRIC_LABEL[key] ?? key} ${value.toLocaleString("zh-CN")}`)
                  .join(" · ")}
              </p>
            ) : null}
            {exportError ? <ErrorNote error={exportError} title="导出未完成" /> : null}
          </div>
        </section>

        {/* 右：备份档 */}
        <section className="delivery__rights">
          <div className="delivery__section delivery__section--backups">
            <header className="delivery__section-head"><p className="delivery__section-title"><Archive size={13} />创作内容快照</p></header>
            <p className="delivery__empty">完整包含故事设定、正文与草稿、批注、封面、审稿记录、共创会话和助手协作历史；恢复时逐项校验计数。运行任务只作历史存档，不在副本中续跑。完整灾备请使用设置里的系统备份。</p>
            <form className="delivery__project-backup-form" onSubmit={(event) => { event.preventDefault(); if (projectBackupLabel.trim()) projectBackupCreateMutation.mutate(projectBackupLabel.trim()); }}>
              <label>备份标签<input value={projectBackupLabel} onChange={(event) => setProjectBackupLabel(event.target.value)} placeholder="交付前版本" /></label>
              <button type="submit" className="btn btn--primary" disabled={projectBackupCreateMutation.isPending || !projectBackupLabel.trim()}><Plus size={12} />{projectBackupCreateMutation.isPending ? "创建中…" : "创建内容快照"}</button>
            </form>
            {projectBackupCreateMutation.isError ? <ErrorNote error={projectBackupCreateMutation.error} title="内容快照未创建" /> : null}
            {projectBackupsQuery.isPending ? <Skeleton lines={3} /> : projectBackupsQuery.isError ? <ErrorNote error={projectBackupsQuery.error} title="内容快照暂时无法加载" /> : projectBackupsQuery.data?.length ? <ol className="delivery__backups">{projectBackupsQuery.data.map((backup) => <li key={backup.id} className="delivery__backup-row"><span className="delivery__backup-label">{backup.label}</span><span className="delivery__backup-meta mono">{formatBytes(backup.sizeBytes)} · {formatRelativeDate(backup.createdAt)}</span>{backup.counts ? <span className="delivery__backup-counts mono">{summarizeBackupCounts(backup.counts)}</span> : null}<span className="delivery__backup-hash mono">{shortHash(backup.bundleHash)}</span><button type="button" className="delivery__backup-preview-btn" onClick={() => setRestoreTarget(backup)}>恢复内容副本</button></li>)}</ol> : <p className="delivery__empty">尚无内容快照。</p>}
            {restoredProjectId ? <p className="delivery__restore-result" role="status">已恢复为新项目。<Link to={projectWorkspacePath(restoredProjectId, "bible")}>打开恢复副本</Link></p> : null}
          </div>
        </section>
      </div>
      {restoreTarget ? <ConfirmDialog title="恢复创作内容快照" confirmLabel="恢复内容副本" pending={projectRestoreMutation.isPending} onCancel={() => setRestoreTarget(null)} onConfirm={() => projectRestoreMutation.mutate(restoreTarget)}><p>恢复不会覆盖当前作品；服务端会创建一个包含全部作者可见数据的新项目副本，并逐项校验导出/恢复计数。</p>{projectRestoreMutation.isError ? <ErrorNote error={projectRestoreMutation.error} title="内容未恢复" /> : null}</ConfirmDialog> : null}
    </div>
  );
}

/** 备份计数清单的紧凑展示：只列出非零项，保持墨色 mono 风格。 */
function summarizeBackupCounts(counts: BundleCounts) {
  const labels: [keyof BundleCounts, string][] = [
    ["outline", "大纲"],
    ["entities", "实体"],
    ["facts", "事实"],
    ["documents", "稿件"],
    ["versions", "版本"],
    ["drafts", "草稿"],
    ["annotations", "批注"],
    ["cover", "封面"],
    ["personas", "Persona"],
    ["cocreateSessions", "共创"],
    ["storyTurns", "回合"],
    ["reviews", "审稿"],
    ["assistantConversations", "协作"],
    ["assistantMessages", "消息"],
  ];
  const parts = labels
    .filter(([key]) => (counts[key] ?? 0) > 0)
    .map(([key, label]) => `${label} ${counts[key]}`);
  return parts.length ? parts.join(" · ") : "空项目";
}
