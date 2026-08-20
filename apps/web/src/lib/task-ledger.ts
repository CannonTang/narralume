/* 任务台账：记录作者发起的后台任务（单章 run / 快速创作航次 / foundation 建书），
   供项目概览在服务端真相之外补一条「回到任务现场」的恢复入口。
   台账只存导航线索，不解析任务内部 Step；真相永远以服务端 overview 为准。 */

import { projectWorkspacePath } from "./project-route";

const LEDGER_KEY = "narralume:task-ledger";
const LEDGER_CAP = 20;

export interface TaskLedgerEntry {
  projectId: string;
  kind: "quick_creation" | "chapter" | "foundation";
  taskId: string;
  label: string;
  createdAt: string;
  origin?: Record<string, unknown> | null;
  documentId?: string | null;
}

export interface TaskNavigationContext {
  origin?: Record<string, unknown> | null;
  documentId?: string | null;
}

/** 任务现场由产品来源推导：写作任务回写作台，连续创作回快速创作；
 *  只有没有产品来源的后台任务才退到高级运行页。 */
export function taskHref(
  projectId: string,
  kind: TaskLedgerEntry["kind"] | string,
  taskId: string,
  context: TaskNavigationContext = {},
): string {
  const originDocumentId = typeof context.origin?.documentId === "string"
    ? context.origin.documentId
    : null;
  const documentId = context.documentId ?? originDocumentId;
  const surface = typeof context.origin?.surface === "string"
    ? context.origin.surface
    : null;
  const sessionId = typeof context.origin?.sessionId === "string"
    ? context.origin.sessionId
    : null;
  if (kind === "quick_creation") {
    return `${projectWorkspacePath(projectId, "autopilot")}?session=${encodeURIComponent(taskId)}`;
  }
  if (kind === "foundation") {
    return `${projectWorkspacePath(projectId, "autopilot")}?foundation=${encodeURIComponent(taskId)}`;
  }
  if (surface === "cocreate" && sessionId) {
    const params = new URLSearchParams({ mode: "cocreate", session: sessionId });
    return `${projectWorkspacePath(projectId, "studio")}?${params.toString()}`;
  }
  if (kind === "chapter" || surface === "studio" || surface === "writing") {
    const params = new URLSearchParams({ run: taskId });
    if (documentId) params.set("document", documentId);
    return `${projectWorkspacePath(projectId, "studio")}?${params.toString()}`;
  }
  if (surface === "autopilot" || surface === "project-overview" || surface === "shelf") {
    return projectWorkspacePath(projectId, "autopilot");
  }
  return `${projectWorkspacePath(projectId, "runs")}?run=${encodeURIComponent(taskId)}`;
}

function readLedger(): TaskLedgerEntry[] {
  try {
    const raw = window.localStorage.getItem(LEDGER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is TaskLedgerEntry =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as TaskLedgerEntry).projectId === "string" &&
        typeof (item as TaskLedgerEntry).taskId === "string",
    );
  } catch {
    return [];
  }
}

function writeLedger(entries: TaskLedgerEntry[]): void {
  try {
    window.localStorage.setItem(LEDGER_KEY, JSON.stringify(entries));
  } catch {
    /* 私密模式下放弃持久化 */
  }
}

/** 记录一条刚发起的任务；同一 taskId 视为同一条（幂等重试不产生重复条目）。 */
export function rememberTask(entry: TaskLedgerEntry): void {
  const rest = readLedger().filter((item) => item.taskId !== entry.taskId);
  writeLedger([entry, ...rest].slice(0, LEDGER_CAP));
}

/** 某一项目仍在台账上的任务（新→旧）。 */
export function rememberedTasks(projectId: string): TaskLedgerEntry[] {
  return readLedger().filter((item) => item.projectId === projectId);
}

/** 与服务端真相对账时把活动任务提到最前，但保留最近的终态任务，
 *  让完成结果仍能从项目概览回到原页面消费。容量上限负责清理旧记录。 */
export function reconcileTasks(projectId: string, keeperTaskIds: string[]): void {
  const keepers = new Set(keeperTaskIds);
  const entries = readLedger();
  const projectEntries = entries.filter((item) => item.projectId === projectId);
  const otherEntries = entries.filter((item) => item.projectId !== projectId);
  const active = projectEntries.filter((item) => keepers.has(item.taskId));
  const recent = projectEntries.filter((item) => !keepers.has(item.taskId));
  writeLedger([...active, ...recent, ...otherEntries].slice(0, LEDGER_CAP));
}
