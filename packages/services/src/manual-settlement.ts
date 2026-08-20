import type { Document } from "@narrative-lantern/domain";
import { buildManualSettlementRecipe } from "@narrative-lantern/harness";
import {
  type NarrativeDatabase,
  SqliteRunRepository,
} from "@narrative-lantern/persistence";

import { randomUuid } from "./internal/crypto.js";
import { hasWritingAssignment, withRuntimeModelPolicy } from "./run-policy.js";

/**
 * 手动章节结算：作者正式提交正文版本后自动开一个后台 Run，从该版本提取
 * 故事变化候选。它复用章节链的 settle/commit 步骤，但只产 candidate，
 * 不追加版本、不占主创作链互斥（targetOutlineNodeId 保持 null）。
 * 没有可用写作模型时静默跳过——手动写作永远不能被模型配置阻塞。
 */
export function startManualSettlementRun(input: {
  database: NarrativeDatabase;
  environment: Readonly<Record<string, string | undefined>>;
  coordinatorWake: () => void;
  projectId: string;
  document: Pick<Document, "id" | "kind" | "outlineNodeId">;
  versionId: string;
}): string | null {
  const { database, environment, projectId, document, versionId } = input;
  if (document.kind !== "chapter" || !document.outlineNodeId) return null;
  if (!hasWritingAssignment(database, environment)) return null;
  const runs = new SqliteRunRepository(database);
  /* 每个版本最多一条结算 Run；不同版本各自结算，串行或并发都安全。 */
  const duplicate = runs
    .listActiveRuns(projectId)
    .find(
      (run) =>
        run.recipe === "manual-settlement" &&
        run.policy.documentVersionId === versionId,
    );
  if (duplicate) return null;
  const runId = randomUuid();
  const recipe = buildManualSettlementRecipe(runId);
  runs.create({
    id: runId,
    projectId,
    recipe: recipe.name,
    recipeVersion: recipe.version,
    mode: "manual",
    targetOutlineNodeId: null,
    policy: withRuntimeModelPolicy(
      {
        documentId: document.id,
        documentVersionId: versionId,
        origin: { surface: "writing", documentId: document.id },
      },
      environment,
    ),
    steps: recipe.steps,
    now: new Date().toISOString(),
  });
  input.coordinatorWake();
  return runId;
}
