import type { ChapterStepKind, RunStepKind } from "@narrative-lantern/domain";

export interface RunStepSeed {
  id: string;
  ordinal: number;
  kind: RunStepKind;
  cycle: number;
  idempotencyKey: string;
  maxAttempts: number;
}

export interface ChapterRecipe {
  name: "chapter-production";
  version: number;
  maxRevisionCycles: number;
  steps: readonly RunStepSeed[];
}

export interface RequestedRevisionRecipe {
  name: "chapter-candidate-revision";
  version: number;
  steps: readonly RunStepSeed[];
}

export interface ManualSettlementRecipe {
  name: "manual-settlement";
  version: number;
  steps: readonly RunStepSeed[];
}

export interface DocumentReviewRecipe {
  name: "document-review";
  version: number;
  steps: readonly RunStepSeed[];
}

export function buildChapterRecipe(
  runId: string,
  maxRevisionCycles = 2,
): ChapterRecipe {
  const boundedCycles = Math.max(0, Math.min(maxRevisionCycles, 5));
  /* 模型调用步骤统一 5 次尝试（transport 层不重试，重试只归 Harness）；
     纯落库/确定性步骤保持 1-2 次。 */
  const steps: RunStepSeed[] = [];
  const append = (
    key: string,
    kind: ChapterStepKind,
    cycle: number,
    maxAttempts: number,
  ) => {
    steps.push({
      id: `${runId}:${key}`,
      ordinal: steps.length,
      kind,
      cycle,
      idempotencyKey: `${runId}/${key}`,
      maxAttempts,
    });
  };
  append("context", "context.compile", 0, 2);
  append("plan", "scene.plan", 0, 5);
  append("draft", "draft.generate", 0, 5);
  for (let cycle = 0; cycle <= boundedCycles; cycle += 1) {
    append(`check:${cycle}`, "deterministic.check", cycle, 1);
    append(`review:${cycle}`, "semantic.review", cycle, 5);
    if (cycle < boundedCycles) {
      append(`revise:${cycle}`, "revision.generate", cycle, 5);
    }
  }
  append("settle", "chapter.settle", boundedCycles, 5);
  append("commit", "chapter.commit", boundedCycles, 1);
  return {
    name: "chapter-production",
    version: 1,
    maxRevisionCycles: boundedCycles,
    steps,
  };
}

export function buildRequestedRevisionRecipe(
  runId: string,
): RequestedRevisionRecipe {
  const steps: RunStepSeed[] = [];
  const append = (
    key: string,
    kind: ChapterStepKind,
    cycle: number,
    maxAttempts: number,
  ) => {
    steps.push({
      id: `${runId}:${key}`,
      ordinal: steps.length,
      kind,
      cycle,
      idempotencyKey: `${runId}/${key}`,
      maxAttempts,
    });
  };
  append("context", "context.compile", 0, 2);
  append("revise:requested", "revision.generate", 0, 5);
  append("check:0", "deterministic.check", 0, 1);
  append("review:0", "semantic.review", 0, 5);
  append("revise:auto", "revision.generate", 0, 5);
  append("check:1", "deterministic.check", 1, 1);
  append("review:1", "semantic.review", 1, 5);
  append("settle", "chapter.settle", 1, 5);
  append("commit", "chapter.commit", 1, 1);
  return { name: "chapter-candidate-revision", version: 1, steps };
}

/* 手动结算复用章节链的 settle/commit 步骤语义：正文来自已存在的文档版本
   （policy.documentVersionId），commit 不再追加版本，只落候选变更集。 */
export function buildManualSettlementRecipe(
  runId: string,
): ManualSettlementRecipe {
  const steps: RunStepSeed[] = [];
  const append = (key: string, kind: ChapterStepKind, maxAttempts: number) => {
    steps.push({
      id: `${runId}:${key}`,
      ordinal: steps.length,
      kind,
      cycle: 0,
      idempotencyKey: `${runId}/${key}`,
      maxAttempts,
    });
  };
  append("settle", "chapter.settle", 5);
  append("commit", "chapter.commit", 1);
  return { name: "manual-settlement", version: 1, steps };
}

/** Reviews one immutable document version without generating or committing prose. */
export function buildDocumentReviewRecipe(runId: string): DocumentReviewRecipe {
  return {
    name: "document-review",
    version: 1,
    steps: [
      {
        id: `${runId}:context`,
        ordinal: 0,
        kind: "context.compile",
        cycle: 0,
        idempotencyKey: `${runId}/context`,
        maxAttempts: 2,
      },
      {
        id: `${runId}:review`,
        ordinal: 1,
        kind: "semantic.review",
        cycle: 0,
        idempotencyKey: `${runId}/review`,
        maxAttempts: 5,
      },
    ],
  };
}
