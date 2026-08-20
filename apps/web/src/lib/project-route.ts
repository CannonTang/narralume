import { useParams } from "react-router";

/** 项目工作区只从 URL 读取作用域，避免刷新、深链和多标签页串项目。 */
export function useProjectId(): string | null {
  const { projectId } = useParams<{ projectId: string }>();
  return projectId ?? null;
}

export function projectWorkspacePath(projectId: string, workspace: string): string {
  return `/projects/${encodeURIComponent(projectId)}/${workspace}`;
}
