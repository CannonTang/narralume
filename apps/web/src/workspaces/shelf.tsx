import "./shelf/shelf.css";

/* 在线体验站（VITE_TRIAL_MODE）声明数据本机边界（M5）。 */
const trialMode = import.meta.env.VITE_TRIAL_MODE === "1";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AUTOMATION_DEFAULTS } from "@narralume/contracts";
import Lenis from "lenis";
import {
  Archive,
  ArchiveRestore,
  Copy,
  Ellipsis,
  Image as ImageIcon,
  LayoutGrid,
  PenLine,
  Plus,
  Radar,
  RotateCcw,
  Rows3,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { motion, useReducedMotion, type MotionStyle } from "motion/react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type CSSProperties,
} from "react";
import { useNavigate } from "react-router";

import { useFocusTrap } from "../app/focus-trap";
import { Empty } from "../components/empty";
import { ErrorNote } from "../components/error-note";
import { IconButton } from "../components/icon-button";
import { Skeleton } from "../components/skeleton";
import {
  applyStoryImport,
  createProject,
  createProjectWithFoundation,
  deleteProject,
  duplicateProject,
  getProjects,
  getProjectsIncludingArchived,
  getRecycledProjects,
  projectCoverBlob,
  projectCoverUrl,
  purgeRecycledProject,
  restoreRecycledProject,
  updateProject,
  uploadStoryFile,
  type ImportBatchDetail,
  type ImportFormat,
  type Project,
  type ProjectCoverMutation,
  type RecycledProject,
} from "../lib/api";
import { coverHue, formatRelativeDate, shortId } from "../lib/fmt";
import { importCandidateKindLabel, projectPhaseLabel } from "../lib/labels";
import { projectWorkspacePath } from "../lib/project-route";
import { rememberTask } from "../lib/task-ledger";

/* ==========================================================================
   藏书室：作品编目与建书入口。本页是唯一允许挂 Lenis 平滑滚动的工作区。
   ========================================================================== */

function importFormatFor(filename: string): ImportFormat {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "txt" || ext === "text") return "text";
  if (ext === "docx") return "docx";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "epub") return "epub";
  if (ext === "json") return "narrative-bundle";
  return "markdown";
}

function chapterCount(project: Project): number {
  return project.committedChapters ?? project.totalChapters ?? 0;
}

export function ShelfWorkspace() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();

  /* Lenis 只上书架；reduced-motion 时不启。层内滚动由 data-lenis-prevent 豁免。 */
  const lenisReady = reduceMotion !== true;
  useEffect(() => {
    if (!lenisReady) return;
    const lenis = new Lenis({ lerp: 0.11 });
    let frame = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, [lenisReady]);

  const [query, setQuery] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [view, setView] = useState<"covers" | "list">(() =>
    window.localStorage.getItem("shelf:view") === "list" ? "list" : "covers",
  );
  const [createMode, setCreateMode] = useState<"blank" | "ai" | null>(null);
  const [editTarget, setEditTarget] = useState<Project | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [recycleOpen, setRecycleOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [importBatch, setImportBatch] = useState<ImportBatchDetail | null>(
    null,
  );
  const [actionError, setActionError] = useState<unknown>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const projectsQuery = useQuery({
    queryKey: ["projects", { archived: includeArchived }],
    queryFn: ({ signal }) =>
      includeArchived
        ? getProjectsIncludingArchived(signal)
        : getProjects(signal),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["projects"] });

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const source = projectsQuery.data ?? [];
    return source
      .filter(
        (project) =>
          !needle ||
          project.title.toLowerCase().includes(needle) ||
          (project.premise ?? "").toLowerCase().includes(needle) ||
          project.id.toLowerCase().startsWith(needle),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [projectsQuery.data, query]);

  const openProject = (project: Project) => {
    setMenuFor(null);
    navigate(projectWorkspacePath(project.id, "overview"));
  };

  const archiveMutation = useMutation({
    mutationFn: (project: Project) =>
      updateProject(project.id, {
        title: project.title,
        subtitle: project.subtitle,
        premise: project.premise,
        archived: !project.archivedAt,
        expectedUpdatedAt: project.updatedAt,
      }),
    onSuccess: () => {
      setMenuFor(null);
      setActionError(null);
      void refresh();
    },
    onError: (error) => {
      setMenuFor(null);
      setActionError(error);
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: (project: Project) => duplicateProject(project.id),
    onSuccess: () => {
      setMenuFor(null);
      setActionError(null);
      void refresh();
    },
    onError: (error) => {
      setMenuFor(null);
      setActionError(error);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) =>
      uploadStoryFile(file, null, importFormatFor(file.name)),
    onSuccess: (detail) => {
      setActionError(null);
      setImportBatch(detail);
    },
    onError: (error) => setActionError(error),
  });

  const isEmpty = !projectsQuery.isPending && rows.length === 0 && !query;

  const selectView = (next: "covers" | "list") => {
    setMenuFor(null);
    setView(next);
    window.localStorage.setItem("shelf:view", next);
  };

  return (
    <div className="shelf">
      <div className="shelf__cta" role="group" aria-label="建书入口">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => setCreateMode("blank")}
        >
          <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
          新建作品
        </button>
        <button
          type="button"
          className="btn btn--outline"
          onClick={() => setCreateMode("ai")}
        >
          <Sparkles size={14} strokeWidth={1.5} aria-hidden="true" />
          AI 引导
        </button>
        <button
          type="button"
          className="btn btn--outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadMutation.isPending}
        >
          <Upload size={14} strokeWidth={1.5} aria-hidden="true" />
          {uploadMutation.isPending ? "正在传稿…" : "导入旧稿"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown,.txt,.text,.docx,.html,.htm,.epub,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) uploadMutation.mutate(file);
            event.target.value = "";
          }}
        />
      </div>

      <header className="shelf__masthead">
        <p className="shelf__ghost" aria-hidden="true">
          藏书 · STACKS
        </p>
        <h1 className="shelf__title">藏书室</h1>
        <p className="shelf__kicker mono">01 · Stacks</p>
        {trialMode ? (
          <p className="shelf__kicker" role="note">
            在线体验：数据仅存本设备浏览器，清站点数据即清空；请勿放置真实作品。
            内置模型每次最多连续创作 3 章；也可以在设置中连接自己的模型服务；需要备份时，可在「运行驱动」中下载作品库。
          </p>
        ) : null}
      </header>

      <div className="shelf__toolbar">
        <label className="shelf__search">
          <Search size={14} strokeWidth={1.5} aria-hidden="true" />
          <input
            type="search"
            aria-label="检索书目"
            placeholder="检索书名、卷首语或编号…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="shelf__archive-toggle"
          aria-pressed={includeArchived}
          onClick={() => setIncludeArchived((value) => !value)}
        >
          <Archive size={13} strokeWidth={1.5} aria-hidden="true" />
          含归档
        </button>
        <button
          type="button"
          className="shelf__archive-toggle"
          onClick={() => setRecycleOpen(true)}
        >
          <Trash2 size={13} strokeWidth={1.5} aria-hidden="true" />
          回收站
        </button>
        <div className="shelf__view-switch" role="group" aria-label="书目视图">
          <button
            type="button"
            aria-pressed={view === "covers"}
            onClick={() => selectView("covers")}
          >
            <LayoutGrid size={13} strokeWidth={1.5} aria-hidden="true" />
            封面
          </button>
          <button
            type="button"
            aria-pressed={view === "list"}
            onClick={() => selectView("list")}
          >
            <Rows3 size={13} strokeWidth={1.5} aria-hidden="true" />
            列表
          </button>
        </div>
      </div>

      {actionError !== null ? (
        <div style={{ marginTop: "1rem" }}>
          <ErrorNote error={actionError} title="操作没有写成" />
        </div>
      ) : null}

      {projectsQuery.isPending ? (
        <div className="shelf__catalog" aria-busy="true">
          <Skeleton lines={5} />
        </div>
      ) : projectsQuery.isError ? (
        <div style={{ marginTop: "2rem" }}>
          <ErrorNote error={projectsQuery.error} title="书架暂时无法加载" />
        </div>
      ) : isEmpty ? (
        <div className="shelf__empty">
          <div className="shelf__empty-panel">
            <div className="shelf__empty-mark" aria-hidden="true">
              <span>藏</span>
              <i />
              <small>NARRALUME</small>
            </div>
            <div className="shelf__empty-copy">
              <p className="shelf__empty-eyebrow mono">YOUR FIRST VOLUME</p>
              <p className="shelf__empty-line">架上尚无一册</p>
              <p className="shelf__empty-sub">
                从一张白纸开始，把灵感、正文和故事事实收进同一张书桌。
              </p>
              <div className="shelf__empty-actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => setCreateMode("blank")}
                >
                  <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
                  建立第一本书
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setCreateMode("ai")}
                >
                  <Sparkles size={14} strokeWidth={1.5} aria-hidden="true" />
                  AI 协助构思
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadMutation.isPending}
                >
                  <Upload size={14} strokeWidth={1.5} aria-hidden="true" />
                  导入已有稿件
                </button>
              </div>
              <p className="shelf__empty-hint">支持 Markdown、TXT、DOCX、EPUB 和 JSON 故事包</p>
            </div>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="shelf__catalog">
          <Empty
            title="没有相符的书目"
            description="换个关键词，或关闭「含归档」再试。"
          />
        </div>
      ) : (
        <div className="shelf__catalog">
          <div className="shelf__catalog-head">
            <span className="mono">{rows.length} 部作品</span>
            <span className="shelf__catalog-rule" aria-hidden="true" />
            <span className="mono">最近更新 · {formatRelativeDate(rows[0]!.updatedAt)}</span>
          </div>
          {view === "covers" ? <div className="shelf__bookshelf">
          {rows.map((project) => (
            <motion.article
              key={project.id}
              className="shelf-book"
              data-archived={project.archivedAt ? "true" : "false"}
              data-menu-open={menuFor === project.id ? "true" : "false"}
              {...(reduceMotion
                ? {}
                : {
                    whileHover: "shelf-book-hover",
                    variants: { "shelf-book-hover": { y: -5 } },
                    transition: { type: "spring", stiffness: 360, damping: 28 },
              })}
              style={{ "--book-hue": coverHue(project.id) } as unknown as MotionStyle}
            >
              <button
                type="button"
                className="shelf-book__open"
                aria-label={`打开《${project.title}》`}
                onClick={() => openProject(project)}
              />
              <div className="shelf-book__cover-wrap">
                <BookCover project={project} />
              </div>
              <div className="shelf-book__info">
                <div className="shelf-book__title-row">
                  <h2 className="shelf-book__title">{project.title}</h2>
                  {project.archivedAt ? <span className="shelf-book__archived-tag mono">归档</span> : null}
                </div>
                <p className="shelf-book__subtitle">{project.subtitle ?? projectPhaseLabel(project.phase)}</p>
                <p className="shelf-book__premise" data-empty={project.premise ? "false" : "true"}>
                  {project.premise ?? "卷首尚待题写。"}
                </p>
                <div className="shelf-book__meta mono">
                  <span>{chapterCount(project)} 章</span>
                  <span>{project.wordCount ?? 0} 字</span>
                  <span>{formatRelativeDate(project.updatedAt)}</span>
                </div>
              </div>
              <ProjectActions
                project={project}
                className="shelf-book"
                open={menuFor === project.id}
                onToggle={() => setMenuFor((value) => value === project.id ? null : project.id)}
                onClose={() => setMenuFor(null)}
                onAutopilot={() => navigate(projectWorkspacePath(project.id, "autopilot"))}
                onEdit={() => setEditTarget(project)}
                onDuplicate={() => duplicateMutation.mutate(project)}
                onArchive={() => archiveMutation.mutate(project)}
                onDelete={() => setDeleteTarget(project)}
              />
            </motion.article>
          ))}
          </div> : (
            <div className="shelf__list">
              <div className="shelf-list__head" aria-hidden="true">
                <span className="mono">编号</span>
                <span className="mono">书名 · 卷首语</span>
                <span className="mono">章 · 阶段 · 更新</span>
                <span />
                <span />
              </div>
              {rows.map((project, index) => (
                <motion.article
                  key={project.id}
                  className="shelf-row"
                  data-archived={project.archivedAt ? "true" : "false"}
                  data-menu-open={menuFor === project.id ? "true" : "false"}
                  {...(reduceMotion ? {} : {
                    whileHover: "shelf-row-hover",
                    variants: { "shelf-row-hover": { x: 4 } },
                    transition: { type: "spring", stiffness: 420, damping: 30 },
                  })}
                  style={{ transformStyle: "preserve-3d" }}
                >
                  <button type="button" className="shelf-row__open" aria-label={`打开《${project.title}》`} onClick={() => openProject(project)} />
                  <span className="shelf-row__no">
                    <span className="mono">NO.{String(index + 1).padStart(2, "0")}</span>
                    <span className="shelf-row__id mono">{shortId(project.id)}</span>
                  </span>
                  <span className="shelf-row__body">
                    <span className="shelf-row__title">{project.title}</span>
                    <span className="shelf-row__premise" data-empty={project.premise ? "false" : "true"}>{project.premise ?? "——卷首待题"}</span>
                  </span>
                  <span className="shelf-row__meta mono">
                    {project.archivedAt ? <span className="shelf-row__archived-tag mono">归档</span> : null}
                    <span>{chapterCount(project)} 章</span>
                    <span className="shelf-row__phase">{projectPhaseLabel(project.phase)}</span>
                    <span>{formatRelativeDate(project.updatedAt)}</span>
                  </span>
                  <ProjectActions
                    project={project}
                    className="shelf-row"
                    open={menuFor === project.id}
                    onToggle={() => setMenuFor((value) => value === project.id ? null : project.id)}
                    onClose={() => setMenuFor(null)}
                    onAutopilot={() => navigate(projectWorkspacePath(project.id, "autopilot"))}
                    onEdit={() => setEditTarget(project)}
                    onDuplicate={() => duplicateMutation.mutate(project)}
                    onArchive={() => archiveMutation.mutate(project)}
                    onDelete={() => setDeleteTarget(project)}
                  />
                  <motion.span
                    className="shelf-spine"
                    aria-hidden="true"
                    style={{ "--spine-hue": coverHue(project.id) } as MotionStyle}
                    {...(reduceMotion ? {} : {
                      variants: { "shelf-row-hover": { y: -2, rotateY: 8, rotate: -2, transformPerspective: 180 } },
                      transition: { type: "spring", stiffness: 420, damping: 24 },
                    })}
                    initial={{ rotate: -2 }}
                  >
                    <span className="shelf-spine__cap" />
                    <span className="shelf-spine__band" />
                    <span className="shelf-spine__cloth">
                      <span className="shelf-spine__emboss" />
                      <span className="shelf-spine__emboss shelf-spine__emboss--second" />
                    </span>
                  </motion.span>
                </motion.article>
              ))}
            </div>
          )}
        </div>
      )}

      {createMode ? (
        <CreateDialog
          mode={createMode}
          onClose={() => setCreateMode(null)}
          onCreated={(project) => {
            setCreateMode(null);
            void refresh();
            navigate(projectWorkspacePath(project.id, "overview"));
          }}
        />
      ) : null}
      {editTarget ? (
        <BookEditDialog
          project={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            void refresh();
          }}
        />
      ) : null}
      {deleteTarget ? (
        <DeleteDialog
          project={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null);
            void refresh();
          }}
        />
      ) : null}
      {recycleOpen ? (
        <RecycleBinDialog
          onClose={() => setRecycleOpen(false)}
          onChanged={() => void refresh()}
        />
      ) : null}
      {importBatch ? (
        <ImportDialog
          detail={importBatch}
          onClose={() => setImportBatch(null)}
          onApplied={(projectId) => {
            setImportBatch(null);
            void refresh();
            navigate(projectWorkspacePath(projectId, "overview"));
          }}
        />
      ) : null}
    </div>
  );
}

function ProjectActions({
  project,
  className,
  open,
  onToggle,
  onClose,
  onAutopilot,
  onEdit,
  onDuplicate,
  onArchive,
  onDelete,
}: {
  project: Project;
  className: "shelf-book" | "shelf-row";
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onAutopilot: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  const closeAndRestoreFocus = () => {
    onClose();
    rootRef.current?.querySelector<HTMLButtonElement>(`.${className}__menu-btn`)?.focus();
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndRestoreFocus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
      : event.key === "ArrowDown" ? (current + 1 + items.length) % items.length
      : (current - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <span
      ref={rootRef}
      className={`${className}__menu`}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <IconButton
        icon={Ellipsis}
        label={`《${project.title}》的更多操作`}
        className={`${className}__menu-btn`}
        aria-expanded={open}
        onClick={onToggle}
      />
      {open ? (
        <>
          <div className="shelf-menu-backdrop" onMouseDown={onClose} />
          <div ref={menuRef} className="shelf-menu" role="menu" data-lenis-prevent onKeyDown={handleMenuKeyDown}>
            <button type="button" role="menuitem" className="shelf-menu__item" onClick={() => { onClose(); onAutopilot(); }}>
              <Radar size={13} strokeWidth={1.5} aria-hidden="true" /> AI 快速创作
            </button>
            <button type="button" role="menuitem" className="shelf-menu__item" onClick={() => { onClose(); onEdit(); }}>
              <PenLine size={13} strokeWidth={1.5} aria-hidden="true" /> 编辑书籍与封面
            </button>
            <button type="button" role="menuitem" className="shelf-menu__item" onClick={() => { onClose(); onDuplicate(); }}>
              <Copy size={13} strokeWidth={1.5} aria-hidden="true" /> 复制
            </button>
            <button type="button" role="menuitem" className="shelf-menu__item" onClick={() => { onClose(); onArchive(); }}>
              {project.archivedAt ? <ArchiveRestore size={13} strokeWidth={1.5} aria-hidden="true" /> : <Archive size={13} strokeWidth={1.5} aria-hidden="true" />}
              {project.archivedAt ? "恢复" : "归档"}
            </button>
            <div className="shelf-menu__divider" />
            <button type="button" role="menuitem" className="shelf-menu__item shelf-menu__item--danger" onClick={() => { onClose(); onDelete(); }}>
              <Trash2 size={13} strokeWidth={1.5} aria-hidden="true" /> 移入回收站
            </button>
          </div>
        </>
      ) : null}
    </span>
  );
}

/* --- 对话框骨架 --------------------------------------------------------- */

interface ShelfDialogProps {
  eyebrow: string;
  title: string;
  note?: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}

function ShelfDialog({
  eyebrow,
  title,
  note,
  className,
  onClose,
  children,
}: ShelfDialogProps) {
  const trapRef = useFocusTrap<HTMLDivElement>(onClose);
  return (
    <div
      className="shelf-dialog-backdrop"
      data-lenis-prevent
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={trapRef}
        className={`shelf-dialog${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-lenis-prevent
      >
        <p className="shelf-dialog__eyebrow mono">{eyebrow}</p>
        <h2 className="shelf-dialog__title">{title}</h2>
        {note ? <p className="shelf-dialog__note">{note}</p> : null}
        {children}
      </div>
    </div>
  );
}

/* --- 建书（空白 / AI 引导） --------------------------------------------- */

function CreateDialog({
  mode,
  onClose,
  onCreated,
}: {
  mode: "blank" | "ai";
  onClose: () => void;
  onCreated: (project: Project) => void;
}) {
  const [title, setTitle] = useState("");
  const [premise, setPremise] = useState("");
  const aiRequestRef = useRef<{ identity: string; requestId: string } | null>(null);
  const blankRequestRef = useRef<{ identity: string; requestId: string } | null>(null);
  const mutation = useMutation({
    mutationFn: async (input: { title: string; premise: string | null }) => {
      /* 空白建书走纯项目创建（无模型也可用）；AI 引导建书一次立项并发起
         foundation 后台任务，requestId 即本次提交的幂等键。 */
      if (mode === "ai" && input.premise) {
        const request = {
          title: input.title,
          premise: input.premise,
          braindump: input.premise,
          preferences: {
            genre: null,
            audience: null,
            tone: null,
            ...AUTOMATION_DEFAULTS,
          },
          policy: { qualityPreset: "standard" as const },
        };
        const identity = JSON.stringify(request);
        if (aiRequestRef.current?.identity !== identity) {
          aiRequestRef.current = {
            identity,
            requestId: crypto.randomUUID(),
          };
        }
        const created = await createProjectWithFoundation({
          ...request,
          requestId: aiRequestRef.current.requestId,
        });
        rememberTask({
          projectId: created.project.id,
          kind: "foundation",
          taskId: created.task.run.id,
          label: `AI 建书《${created.project.title}》`,
          createdAt: new Date().toISOString(),
          origin: { surface: "autopilot" },
        });
        return created.project;
      }
      const identity = JSON.stringify(input);
      if (blankRequestRef.current?.identity !== identity) {
        blankRequestRef.current = {
          identity,
          requestId: crypto.randomUUID(),
        };
      }
      return createProject({
        ...input,
        requestId: blankRequestRef.current.requestId,
      });
    },
    onSuccess: (project) => {
      aiRequestRef.current = null;
      blankRequestRef.current = null;
      onCreated(project);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || (mode === "ai" && !premise.trim())) return;
    mutation.mutate({
      title: trimmed,
      premise: premise.trim() ? premise.trim() : null,
    });
  };

  return (
    <ShelfDialog
      eyebrow="NEW VOLUME"
      title={mode === "blank" ? "空白建书" : "AI 引导建书"}
      note={
        mode === "blank"
          ? "先立一个书名，卷首语可以后补。"
          : "写下命题或脑暴，建书后由 AI 帮你整理创作方向。"
      }
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="shelf-dialog__field">
          <label className="shelf-dialog__label mono" htmlFor="create-title">
            书名
          </label>
          <input
            id="create-title"
            className="shelf-dialog__input"
            placeholder="《潮汐灯塔》"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            autoFocus
          />
        </div>
        <div className="shelf-dialog__field">
          <label
            className="shelf-dialog__label mono"
            htmlFor="create-premise"
          >
            {mode === "blank" ? "卷首语（一句话命题，可留空）" : "命题与脑暴"}
          </label>
          {mode === "blank" ? (
            <input
              id="create-premise"
              className="shelf-dialog__input"
              placeholder="港口每年都会遗忘一个人。"
              value={premise}
              onChange={(event) => setPremise(event.target.value)}
            />
          ) : (
            <textarea
              id="create-premise"
              className="shelf-dialog__textarea"
              rows={4}
              placeholder="想到什么写什么：题材、人物、想去的方向……"
              value={premise}
              onChange={(event) => setPremise(event.target.value)}
            />
          )}
        </div>
        {mutation.isError ? (
          <div className="shelf-dialog__error">
            <ErrorNote error={mutation.error} title="这本书没有立起来" />
          </div>
        ) : null}
        <div className="shelf-dialog__actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={
              mutation.isPending ||
              !title.trim() ||
              (mode === "ai" && !premise.trim())
            }
          >
            {mutation.isPending
              ? "正在登记…"
              : mode === "blank"
                ? "创建并入藏"
                : "创建并生成候选"}
          </button>
        </div>
      </form>
    </ShelfDialog>
  );
}

/* --- 封面取景弹窗 ----------------------------------------------------------
   基于 react-easy-crop：固定 3:4 竖版取景框，拖图 + 滚轮/滑杆缩放底图。
   确认时用 canvas 按像素框裁出最终封面（所见即所得），调用方把它作为
   prepared 上传、crop 归中 {0.5, 0.5, 1}，既有渲染契约不变。 */

import Cropper, { type Area, type Point } from "react-easy-crop";

function CoverCropDialog({
  prepared,
  onConfirm,
  onClose,
}: {
  prepared: PreparedCover;
  onConfirm: (cropped: PreparedCover) => void;
  onClose: () => void;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>(onClose);
  const [point, setPoint] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [cutting, setCutting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* 按像素框裁出最终封面：croppedAreaPixels 相对原图坐标，直接 drawImage。 */
  const confirm = async () => {
    if (!area || cutting) return;
    setCutting(true);
    setError(null);
    try {
      const cropped = await cropPreparedCover(prepared, area);
      onConfirm(cropped);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "取景裁切失败，请重试。");
      setCutting(false);
    }
  };

  return (
    <div
      className="shelf-dialog-backdrop"
      data-lenis-prevent
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={trapRef}
        className="shelf-dialog shelf-dialog--crop"
        role="dialog"
        aria-modal="true"
        aria-label="调整封面取景"
        data-lenis-prevent
      >
        <p className="shelf-dialog__eyebrow mono">COVER CROP</p>
        <h2 className="shelf-dialog__title">调整封面取景</h2>
        <p className="shelf-dialog__note">
          拖动底图对位，滚轮或双指缩放；3:4 竖版框内即最终封面。
        </p>
        <div className="cover-cropper__stage cover-cropper__stage--dialog">
          <Cropper
            image={prepared.dataUrl}
            crop={point}
            zoom={zoom}
            aspect={3 / 4}
            minZoom={1}
            maxZoom={3}
            cropShape="rect"
            showGrid
            onCropChange={setPoint}
            onZoomChange={setZoom}
            onCropComplete={(_percent, pixels) => setArea(pixels)}
          />
        </div>
        {error ? (
          <div className="shelf-dialog__error">
            <ErrorNote error={error} title="没有裁出封面" />
          </div>
        ) : null}
        <div className="shelf-dialog__actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!area || cutting}
            onClick={() => void confirm()}
          >
            {cutting ? "正在裁切…" : "确认取景"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* 把原图按像素框裁成 3:4 封面，走与 readCoverFile 相同的 webp 输出。 */
function cropPreparedCover(
  source: PreparedCover,
  area: Area,
): Promise<PreparedCover> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error("封面读取失败，请重试。"));
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(area.width));
      canvas.height = Math.max(1, Math.round(area.height));
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("当前浏览器无法处理封面图片。"));
        return;
      }
      context.drawImage(
        image,
        area.x,
        area.y,
        area.width,
        area.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("封面裁切失败，请重试。"));
            return;
          }
          const reader = new FileReader();
          reader.onerror = () => reject(new Error("封面编码失败，请重试。"));
          reader.onload = () => {
            const dataUrl = String(reader.result ?? "");
            const comma = dataUrl.indexOf(",");
            if (comma < 0) {
              reject(new Error("封面编码无效。"));
              return;
            }
            resolve({
              mediaType: "image/webp",
              imageBase64: dataUrl.slice(comma + 1),
              width: canvas.width,
              height: canvas.height,
              dataUrl,
            });
          };
          reader.readAsDataURL(blob);
        },
        "image/webp",
        0.9,
      );
    };
    image.src = source.dataUrl;
  });
}

function BookCover({ project }: { project: Project }) {
  const imageUrl = projectCoverUrl(project);
  const [localUrl, setLocalUrl] = useState<string | null>(
    imageUrl && imageUrl.startsWith("blob:") ? imageUrl : null,
  );
  useEffect(() => {
    // local 驱动下封面无 HTTP URL，改取内核 bytes 缓存为 Blob URL。
    if (!project.cover || imageUrl) return;
    let cancelled = false;
    void projectCoverBlob(project)
      .then((url) => {
        if (!cancelled && url) setLocalUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project, imageUrl]);
  const crop = project.cover?.crop;
  const src = imageUrl ?? localUrl;
  return (
    <div
      className="book-cover"
      style={{ "--book-hue": coverHue(project.id) } as CSSProperties}
    >
      {src ? (
        <img
          className="book-cover__image"
          src={src}
          alt={`《${project.title}》自定义封面`}
          style={{
            objectPosition: `${(crop?.x ?? 0.5) * 100}% ${(crop?.y ?? 0.5) * 100}%`,
            transform: `scale(${crop?.zoom ?? 1})`,
            transformOrigin: `${(crop?.x ?? 0.5) * 100}% ${(crop?.y ?? 0.5) * 100}%`,
          }}
        />
      ) : (
        <div className="book-cover__default" role="img" aria-label={`《${project.title}》默认封面`}>
          <span className="book-cover__mark mono">NL · {project.phase.slice(0, 1).toUpperCase()}</span>
          <strong>{project.title}</strong>
          <span>{project.subtitle ?? "未完稿"}</span>
          <i aria-hidden="true" />
        </div>
      )}
      <span className="book-cover__edge" aria-hidden="true" />
    </div>
  );
}

interface PreparedCover {
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  imageBase64: string;
  width: number;
  height: number;
  dataUrl: string;
}

function readCoverFile(file: File): Promise<PreparedCover> {
  const mediaType = file.type as PreparedCover["mediaType"];
  if (!["image/jpeg", "image/png", "image/webp"].includes(mediaType)) {
    return Promise.reject(new Error("请选择 JPG、PNG 或 WebP 封面。"));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("封面读取失败，请换一张图片。"));
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const image = new Image();
      image.onerror = () => reject(new Error("无法识别这张封面图片。"));
      image.onload = () => {
        const maxEdge = 2400;
        const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("当前浏览器无法处理封面图片。"));
          return;
        }
        context.drawImage(image, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("封面压缩失败，请换一张图片。"));
              return;
            }
            if (blob.size > 8 * 1024 * 1024) {
              reject(new Error("封面处理后仍超过 8 MB，请换一张较小的图片。"));
              return;
            }
            const outputReader = new FileReader();
            outputReader.onerror = () => reject(new Error("封面处理失败，请重试。"));
            outputReader.onload = () => {
              const outputUrl = String(outputReader.result ?? "");
              const comma = outputUrl.indexOf(",");
              if (comma < 0) {
                reject(new Error("封面编码无效。"));
                return;
              }
              resolve({
                mediaType: "image/webp",
                imageBase64: outputUrl.slice(comma + 1),
                width,
                height,
                dataUrl: outputUrl,
              });
            };
            outputReader.readAsDataURL(blob);
          },
          "image/webp",
          0.9,
        );
      };
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

function BookEditDialog({
  project,
  onClose,
  onSaved,
}: {
  project: Project;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(project.title);
  const [subtitle, setSubtitle] = useState(project.subtitle ?? "");
  const [premise, setPremise] = useState(project.premise ?? "");
  const [prepared, setPrepared] = useState<PreparedCover | null>(null);
  const [removeCover, setRemoveCover] = useState(false);
  const [cropSource, setCropSource] = useState<PreparedCover | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const mutation = useMutation({
    mutationFn: async () => {
      // 资料与封面在同一个请求里提交，服务端事务保证要么全部生效要么全部回滚。
      // 封面取景已在上传前裁好，crop 恒为居中。
      const cover: ProjectCoverMutation | undefined = removeCover
        ? { action: "remove" }
        : prepared
          ? {
              action: "put",
              mediaType: prepared.mediaType,
              imageBase64: prepared.imageBase64,
              width: prepared.width,
              height: prepared.height,
              crop: { x: 0.5, y: 0.5, zoom: 1 },
            }
          : undefined;
      await updateProject(project.id, {
        title: title.trim(),
        subtitle: subtitle.trim() || null,
        premise: premise.trim() || null,
        archived: project.archivedAt !== null,
        expectedUpdatedAt: project.updatedAt,
        ...(cover ? { cover } : {}),
      });
    },
    onSuccess: () => onSaved(),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    mutation.mutate();
  };

  return (
    <ShelfDialog
      eyebrow="EDIT BOOK"
      title="编辑书籍与封面"
      note="书架上的封面只是识别入口；正文、圣经与版本仍在作品内部维护。"
      className="shelf-dialog--book-edit"
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="book-edit__layout">
          <div className="book-edit__preview">
            {prepared ? (
              <div className="book-cover book-cover--editing">
                <img
                  className="book-cover__image"
                  src={prepared.dataUrl}
                  alt="待保存的封面预览"
                />
              </div>
            ) : removeCover ? (
              <div className="book-cover book-cover--editing"><div className="book-cover__default"><strong>{title}</strong><span>将恢复默认封面</span><i aria-hidden="true" /></div></div>
            ) : (
              <BookCover project={{ ...project, title, subtitle: subtitle || null }} />
            )}
            <label className="btn btn--outline book-edit__upload">
              <ImageIcon size={14} strokeWidth={1.5} aria-hidden="true" />
              {readingFile ? "读取中…" : "选择封面"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  setReadingFile(true);
                  setFileError(null);
                  void readCoverFile(file)
                    .then((value) => {
                      setRemoveCover(false);
                      /* 读入后立刻弹取景窗：裁好的图才进 prepared。 */
                      setCropSource(value);
                    })
                    .catch((error: unknown) => setFileError(error instanceof Error ? error.message : "封面读取失败。"))
                    .finally(() => setReadingFile(false));
                }}
              />
            </label>
            <button type="button" className="book-edit__reset" onClick={() => { setPrepared(null); setRemoveCover(true); }}>
              <RotateCcw size={13} strokeWidth={1.5} aria-hidden="true" />
              恢复默认
            </button>
          </div>
          <div className="book-edit__fields">
            <div className="shelf-dialog__field">
              <label className="shelf-dialog__label mono" htmlFor="edit-title">书名</label>
              <input id="edit-title" className="shelf-dialog__input" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
            </div>
            <div className="shelf-dialog__field">
              <label className="shelf-dialog__label mono" htmlFor="edit-subtitle">副题</label>
              <input id="edit-subtitle" className="shelf-dialog__input" value={subtitle} onChange={(event) => setSubtitle(event.target.value)} placeholder="可留空" />
            </div>
            <div className="shelf-dialog__field">
              <label className="shelf-dialog__label mono" htmlFor="edit-premise">卷首语</label>
              <textarea id="edit-premise" className="shelf-dialog__textarea" rows={4} value={premise} onChange={(event) => setPremise(event.target.value)} placeholder="一句话说明这部作品从哪里开始。" />
            </div>
            <p className="book-edit__hint">选择封面后会弹出取景窗，拖成想要的 3:4 竖版画面再确认。</p>
          </div>
        </div>
        {fileError ? <div className="shelf-dialog__error"><ErrorNote error={fileError} title="封面没有读入" /></div> : null}
        {mutation.isError ? (
          <div className="shelf-dialog__error">
            <ErrorNote error={mutation.error} title="书籍没有保存" />
          </div>
        ) : null}
        <div className="shelf-dialog__actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={mutation.isPending || readingFile || !title.trim()}
          >
            {mutation.isPending ? "正在保存…" : "保存书籍"}
          </button>
        </div>
      </form>
      {cropSource ? (
        <CoverCropDialog
          prepared={cropSource}
          onClose={() => setCropSource(null)}
          onConfirm={(cropped) => {
            setPrepared(cropped);
            setCropSource(null);
          }}
        />
      ) : null}
    </ShelfDialog>
  );
}

/* --- 移入回收站（输入书名确认） ----------------------------------------- */

function DeleteDialog({
  project,
  onClose,
  onDeleted,
}: {
  project: Project;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      deleteProject({
        id: project.id,
        title: project.title,
        updatedAt: project.updatedAt,
      }),
    onSuccess: () => onDeleted(),
  });

  return (
    <ShelfDialog
      eyebrow="DESTROY"
      title="移入回收站"
      note={`《${project.title}》会离开书架并保留 30 天，期间可从回收站恢复。输入书名以确认。`}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (confirmation === project.title) mutation.mutate();
        }}
      >
        <div className="shelf-dialog__field">
          <label className="shelf-dialog__label mono" htmlFor="delete-confirm">
            书名确认
          </label>
          <input
            id="delete-confirm"
            className="shelf-dialog__input"
            placeholder={project.title}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoFocus
          />
        </div>
        {mutation.isError ? (
          <div className="shelf-dialog__error">
            <ErrorNote error={mutation.error} title="没有删除" />
          </div>
        ) : null}
        <div className="shelf-dialog__actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>
            再想想
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={mutation.isPending || confirmation !== project.title}
          >
            {mutation.isPending ? "正在移入…" : "移入回收站"}
          </button>
        </div>
      </form>
    </ShelfDialog>
  );
}

function RecycleBinDialog({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [purgeTarget, setPurgeTarget] = useState<RecycledProject | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const projectsQuery = useQuery({
    queryKey: ["projects", "recycle-bin"],
    queryFn: ({ signal }) => getRecycledProjects(signal),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["projects", "recycle-bin"] });
    onChanged();
  };
  const restoreMutation = useMutation({
    mutationFn: restoreRecycledProject,
    onSuccess: refresh,
  });
  const purgeMutation = useMutation({
    mutationFn: purgeRecycledProject,
    onSuccess: () => {
      setPurgeTarget(null);
      setConfirmation("");
      refresh();
    },
  });
  return (
    <ShelfDialog
      eyebrow="RECYCLE"
      title="回收站"
      note="作品保留 30 天；恢复后仍保持归档状态。永久删除不可撤销。"
      onClose={onClose}
    >
      {projectsQuery.isPending ? <Skeleton lines={4} /> : projectsQuery.isError ? <ErrorNote error={projectsQuery.error} title="回收站暂时无法加载" /> : projectsQuery.data?.length ? (
        <div className="shelf-recycle">
          {projectsQuery.data.map((project) => (
            <article key={project.id} className="shelf-recycle__item">
              <div><strong>{project.title}</strong><p>将在 {new Date(project.deleteAfter).toLocaleDateString("zh-CN")} 后自动清理</p></div>
              <div className="shelf-recycle__actions">
                <button type="button" className="btn btn--outline" disabled={restoreMutation.isPending || purgeMutation.isPending} onClick={() => restoreMutation.mutate(project)}>恢复</button>
                <button type="button" className="btn btn--outline" disabled={restoreMutation.isPending || purgeMutation.isPending} onClick={() => { setPurgeTarget(project); setConfirmation(""); }}>永久删除</button>
              </div>
            </article>
          ))}
        </div>
      ) : <Empty title="回收站为空" description="移入回收站的作品会在这里保留 30 天。" />}
      {purgeTarget ? (
        <div className="shelf-recycle__confirm">
          <p>永久删除《{purgeTarget.title}》不可撤销。输入书名确认。</p>
          <input aria-label="永久删除书名确认" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
          <div className="shelf-dialog__actions">
            <button type="button" className="btn btn--outline" onClick={() => setPurgeTarget(null)}>取消</button>
            <button type="button" className="btn btn--primary" disabled={confirmation !== purgeTarget.title || purgeMutation.isPending} onClick={() => purgeMutation.mutate(purgeTarget)}>永久删除</button>
          </div>
        </div>
      ) : null}
      {restoreMutation.isError ? <ErrorNote error={restoreMutation.error} title="作品未恢复" /> : null}
      {purgeMutation.isError ? <ErrorNote error={purgeMutation.error} title="作品未永久删除" /> : null}
    </ShelfDialog>
  );
}

/* --- 导入旧稿（预览候选 → 勾选 → 应用） ---------------------------------- */

function ImportDialog({
  detail,
  onClose,
  onApplied,
}: {
  detail: ImportBatchDetail;
  onClose: () => void;
  onApplied: (projectId: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>(() =>
    detail.candidates.map((candidate) => candidate.id),
  );
  const mutation = useMutation({
    mutationFn: (ids: string[]) => applyStoryImport(detail.batch.id, ids),
    onSuccess: ({ projectId }) => onApplied(projectId),
  });

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );

  return (
    <ShelfDialog
      eyebrow="FICHE"
      title={`盘点《${detail.batch.filename}》`}
      note={`支持 Markdown、纯文本、Word、HTML、EPUB 与本项目 JSON；盘点只预览，不改动作品。已拆出 ${detail.candidates.length} 项候选，勾选要入藏的部分。`}
      onClose={onClose}
    >
      <div className="shelf-dialog__candidates">
        {detail.candidates.map((candidate) => (
          <label key={candidate.id} className="shelf-candidate">
            <input
              type="checkbox"
              checked={selected.includes(candidate.id)}
              onChange={() => toggle(candidate.id)}
            />
            <span className="shelf-candidate__kind mono">
              {importCandidateKindLabel(candidate.kind)}
            </span>
            <span className="shelf-candidate__title">{candidate.title}</span>
          </label>
        ))}
      </div>
      {mutation.isError ? (
        <div className="shelf-dialog__error">
          <ErrorNote error={mutation.error} title="这一次没有入藏" />
        </div>
      ) : null}
      <div className="shelf-dialog__actions">
        <button type="button" className="btn btn--outline" onClick={onClose}>
          先不导
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={mutation.isPending || selected.length === 0}
          onClick={() => mutation.mutate(selected)}
        >
          {mutation.isPending ? "正在入藏…" : `入藏 ${selected.length} 项`}
        </button>
      </div>
    </ShelfDialog>
  );
}
