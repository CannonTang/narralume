import {
  Activity,
  BookOpenText,
  Brain,
  Compass,
  Cpu,
  LibraryBig,
  PenLine,
  Radar,

  Truck,
  type LucideIcon,
} from "lucide-react";

/* 主导航收敛为五个创作面：书架 / 项目概览 / 故事 / 写作 / 交付。
   其余工作区（审稿、自动驾驶、运行账本、长篇推演、模型供给）暂挂「高级工具」组，
   随写作台合并与设置迁移逐步并入或退役。
   seal 是左栏顶部「当前工作区印记」的白文单字，随路由切换。 */

export interface WorkspaceDef {
  id: string;
  path: string;
  projectScoped: boolean;
  label: string;
  en: string;
  index: string;
  icon: LucideIcon;
  blurb: string;
  seal: string;
}

export const WORKSPACES: WorkspaceDef[] = [
  {
    id: "shelf",
    path: "/shelf",
    projectScoped: false,
    label: "书架",
    en: "STACKS",
    index: "01",
    icon: LibraryBig,
    blurb: "作品编目、检索与建书入口",
    seal: "藏",
  },
  {
    id: "overview",
    path: "/projects/:projectId/overview",
    projectScoped: true,
    label: "项目概览",
    en: "OVERLOOK",
    index: "02",
    icon: Compass,
    blurb: "当前进度、活动任务与下一步",
    seal: "览",
  },
  {
    id: "bible",
    path: "/projects/:projectId/bible",
    projectScoped: true,
    label: "故事",
    en: "CANON",
    index: "03",
    icon: BookOpenText,
    blurb: "意图、人物、大纲与故事事实",
    seal: "典",
  },
  {
    id: "studio",
    path: "/projects/:projectId/studio",
    projectScoped: true,
    label: "写作",
    en: "DESK",
    index: "04",
    icon: PenLine,
    blurb: "正文、版本、候选稿与审稿",
    seal: "稿",
  },
  {
    id: "delivery",
    path: "/projects/:projectId/delivery",
    projectScoped: true,
    label: "交付",
    en: "PRESS",
    index: "05",
    icon: Truck,
    blurb: "质量门、印务导出与备份",
    seal: "付",
  },
];

/** 连续创作是普通产品入口，但与五个稳定工作面分组展示。 */
export const QUICK_WORKSPACES: WorkspaceDef[] = [
  {
    id: "autopilot",
    path: "/projects/:projectId/autopilot",
    projectScoped: true,
    label: "AI 快速创作",
    en: "QUICK CREATE",
    index: "Q1",
    icon: Radar,
    blurb: "按默认链路连续完成多章，作者可随时介入",
    seal: "创",
  },
];

/* 高级工具组：只放诊断、推演与全局配置，不承载普通创作主链。 */
export const ADVANCED_WORKSPACES: WorkspaceDef[] = [
  {
    id: "runs",
    path: "/projects/:projectId/runs",
    projectScoped: true,
    label: "运行中心",
    en: "LEDGER",
    index: "L1",
    icon: Activity,
    blurb: "全部运行的期号档案",
    seal: "行",
  },
  {
    id: "lab",
    path: "/projects/:projectId/lab",
    projectScoped: true,
    label: "长篇推演",
    en: "LOOM",
    index: "L2",
    icon: Brain,
    blurb: "剧情预测、故事记忆与变更影响预演",
    seal: "演",
  },
  {
    id: "supply",
    path: "/settings",
    projectScoped: false,
    label: "设置",
    en: "SETTINGS",
    index: "S1",
    icon: Cpu,
    blurb: "默认生成模型与岗位继承（含 Provider/模型/派岗）",
    seal: "配",
  },
];

const ALL_WORKSPACES = [...WORKSPACES, ...QUICK_WORKSPACES, ...ADVANCED_WORKSPACES];

export function workspaceByPath(pathname: string): WorkspaceDef {
  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    return ADVANCED_WORKSPACES.find((item) => item.id === "supply")!;
  }
  const projectWorkspace = /^\/projects\/[^/]+\/([^/]+)/.exec(pathname)?.[1];
  const projectlessWorkspace = /^\/([^/]+)\/?$/.exec(pathname)?.[1];
  return (
    ALL_WORKSPACES.find(
      (item) => item.id === (projectWorkspace ?? projectlessWorkspace),
    ) ??
    WORKSPACES[0]!
  );
}

export function projectIdFromPath(pathname: string): string | null {
  const value = /^\/projects\/([^/]+)(?:\/|$)/.exec(pathname)?.[1];
  return value ? decodeURIComponent(value) : null;
}

export function workspacePath(item: WorkspaceDef, projectId: string | null): string {
  if (!item.projectScoped) return item.path;
  if (!projectId) return `/${item.id}`;
  return item.path.replace(":projectId", encodeURIComponent(projectId));
}
