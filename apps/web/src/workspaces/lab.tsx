/* 长篇推演：语义检索、剧情预测、故事记忆与变更影响预演。 */

import "../styles/lab.css";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LONG_NOVEL_LIMITS } from "@narralume/contracts";
import { Search, Send } from "lucide-react";
import { useState } from "react";

import { ErrorNote } from "../components/error-note";
import { PageBand } from "../components/page-band";
import { ProjectRequiredState } from "../components/project-required-state";
import { Skeleton } from "../components/skeleton";
import {
  consolidateNarrativeMemory,
  decidePlotPrediction,
  generatePlotPredictions,
  getNarrativeMemories,
  getPlotPredictions,
  previewDryRun,
  rebuildNarrativeMemories,
  searchProjectMemory,
  type DryRunResult,
  type PlotPrediction,
} from "../lib/api";
import { useProjectId } from "../lib/project-route";

const AUTHORITY_LABEL: Record<string, string> = {
  reference: "参照",
  draft: "草稿",
  candidate: "候选",
  confirmed: "确认",
  locked: "锁定",
};

const PREDICTION_STATUS_LABEL: Record<string, string> = {
  candidate: "待掂",
  adopted: "已采纳",
  dismissed: "已搁置",
};

export function LabWorkspace() {
  const projectId = useProjectId();
  const queryClient = useQueryClient();

  const [searchInput, setSearchInput] = useState("");
  const [dryrunInput, setDryrunInput] = useState("");
  const [dryrunResult, setDryrunResult] = useState<DryRunResult | null>(null);
  const [flashPrediction, setFlashPrediction] = useState<string | null>(null);

  const predictionsQuery = useQuery({
    queryKey: ["project", projectId, "lab", "predictions"],
    queryFn: ({ signal }) => getPlotPredictions(projectId!, signal),
    enabled: Boolean(projectId),
  });

  const memoriesQuery = useQuery({
    queryKey: ["project", projectId, "lab", "memories"],
    queryFn: ({ signal }) => getNarrativeMemories(projectId!, false, signal),
    enabled: Boolean(projectId),
  });

  const searchMutation = useMutation({
    mutationFn: (query: string) =>
      searchProjectMemory(projectId!, { query, limit: 8 }),
  });

  const dryrunMutation = useMutation({
    mutationFn: (change: string) => previewDryRun(projectId!, change),
    onSuccess: (result) => setDryrunResult(result),
  });

  const predictionMutation = useMutation({
    mutationFn: (input: { prediction: PlotPrediction; adopted: boolean }) =>
      decidePlotPrediction(
        projectId!,
        input.prediction.id,
        input.adopted ? "adopted" : "dismissed",
      ),
    onSuccess: (prediction, input) => {
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "lab", "predictions"] });
      setFlashPrediction(
        `${input.adopted ? "已采纳" : "已搁置"} · 《${prediction.title}》`,
      );
      window.setTimeout(() => setFlashPrediction(null), 2000);
    },
  });

  const generationMutation = useMutation({
    mutationFn: (input: { direction: string; horizon: number; count: number }) =>
      generatePlotPredictions(projectId!, input),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "lab", "predictions"] }),
  });

  const memoryMutation = useMutation({
    mutationFn: (action: "rebuild" | "consolidate"): Promise<unknown> =>
      action === "rebuild"
        ? rebuildNarrativeMemories(projectId!)
        : consolidateNarrativeMemory(projectId!),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "lab", "memories"] }),
  });

  const predictions = predictionsQuery.data;
  const memories = memoriesQuery.data;

  if (!projectId) {
    return (
      <div className="lab">
        <ProjectRequiredState
          seal="演"
          title="长篇推演"
          description="选定作品后，在这里推演剧情走向、故事记忆和设定变更可能产生的影响。"
        />
      </div>
    );
  }

  return (
    <div className="lab">
      <PageBand index="LOOM · L2" title="长篇推演" meta={<span>语义检索 · 剧情预测 · 影响预演 · 故事记忆</span>} />

      <div className="lab__layout">
        <div className="lab__column">
          <LabActions
            generationPending={generationMutation.isPending}
            generationError={generationMutation.error}
            memoryPending={memoryMutation.isPending}
            memoryError={memoryMutation.error}
            onGenerate={(input) => generationMutation.mutate(input)}
            onMemory={(action) => memoryMutation.mutate(action)}
          />
          <SearchChamber
            searchInput={searchInput}
            setSearchInput={setSearchInput}
            searchMutation={searchMutation}
          />
          <DryRun
            input={dryrunInput}
            setInput={setDryrunInput}
            onSubmit={(change) => dryrunMutation.mutate(change)}
            result={dryrunResult}
            pending={dryrunMutation.isPending}
            isError={dryrunMutation.isError}
            error={dryrunMutation.error}
          />
        </div>

        <Predictions
          predictions={predictions}
          isPending={predictionsQuery.isPending}
          isError={predictionsQuery.isError}
          error={predictionsQuery.error}
          pending={predictionMutation.isPending}
          flash={flashPrediction}
          onAdopt={(p) =>
            predictionMutation.mutate({ prediction: p, adopted: true })
          }
          onDismiss={(p) =>
            predictionMutation.mutate({ prediction: p, adopted: false })
          }
          memories={memories ?? []}
          memoriesPending={memoriesQuery.isPending}
          memoriesError={memoriesQuery.error}
        />
      </div>
    </div>
  );
}

function LabActions({
  generationPending,
  generationError,
  memoryPending,
  memoryError,
  onGenerate,
  onMemory,
}: {
  generationPending: boolean;
  generationError: unknown;
  memoryPending: boolean;
  memoryError: unknown;
  onGenerate: (input: {
    direction: string;
    horizon: number;
    count: number;
  }) => void;
  onMemory: (action: "rebuild" | "consolidate") => void;
}) {
  const [direction, setDirection] = useState("");
  const [horizon, setHorizon] = useState(3);
  const [count, setCount] = useState(3);
  return (
    <section className="lab__actions">
      <header>
        <p className="lab__search-eyebrow">显式维护 · ACTIONS</p>
        <h2 className="lab__search-title">生成预测与整理记忆</h2>
      </header>
      <label className="lab__field">
        <span>希望推演的方向</span>
        <textarea
          value={direction}
          onChange={(event) => setDirection(event.target.value)}
        />
      </label>
      <div className="lab__actions-row">
        <label className="lab__field">
          <span>视野章数</span>
          <input
            type="number"
            min="1"
            max={LONG_NOVEL_LIMITS.predictionHorizon}
            value={horizon}
            onChange={(event) => setHorizon(Number(event.target.value))}
          />
        </label>
        <label className="lab__field">
          <span>候选数量</span>
          <input
            type="number"
            min="1"
            max={LONG_NOVEL_LIMITS.predictionCount}
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
          />
        </label>
        <button
          type="button"
          className="btn btn--primary"
          disabled={generationPending || !direction.trim()}
          onClick={() =>
            onGenerate({ direction: direction.trim(), horizon, count })
          }
        >
          {generationPending ? "生成中…" : "生成预测"}
        </button>
      </div>
      <div className="lab__actions-row">
        <button
          type="button"
          className="btn"
          disabled={memoryPending}
          onClick={() => onMemory("rebuild")}
        >
          重建全部记忆
        </button>
        <button
          type="button"
          className="btn"
          disabled={memoryPending}
          onClick={() => onMemory("consolidate")}
        >
          整理工作记忆
        </button>
      </div>
      {generationError ? (
        <ErrorNote error={generationError} title="预测未生成" />
      ) : null}
      {memoryError ? (
        <ErrorNote error={memoryError} title="记忆维护未完成" />
      ) : null}
    </section>
  );
}

/* ---- 左：语义检索 -------------------------------------------------------- */

function SearchChamber({
  searchInput,
  setSearchInput,
  searchMutation,
}: {
  searchInput: string;
  setSearchInput: (v: string) => void;
  searchMutation: {
    mutate: (variable: string) => void;
    isPending: boolean;
    isError: boolean;
    error: unknown;
    data:
      | {
          id: string;
          title: string;
          content: string;
          authority: string;
          score: number;
          reasons: string[];
        }[]
      | undefined;
  };
}) {
  return (
    <div className="lab__search">
      <header>
        <p className="lab__search-eyebrow">语义检索 · SEARCH-01</p>
        <h2 className="lab__search-title">检索相关故事记忆</h2>
      </header>
      <div className="lab__search-form">
        <input
          type="search"
          className="lab__search-input"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="例如：姐姐在第 3 章消失前出现过哪些征兆？"
          aria-label="检索问题"
        />
        <button
          type="button"
          className="lab__search-btn"
          disabled={
            searchMutation.isPending || searchInput.trim() === ""
          }
          onClick={() => searchMutation.mutate(searchInput.trim())}
        >
          <Search size={14} strokeWidth={1.5} aria-hidden="true" />
          检索
        </button>
      </div>
      <div className="lab__hits" aria-label="检索结果">
        {searchMutation.isPending ? (
          <Skeleton lines={3} />
        ) : searchMutation.isError ? (
          <ErrorNote error={searchMutation.error} title="检索失败" />
        ) : searchMutation.data && searchMutation.data.length > 0 ? (
          searchMutation.data.map((hit) => (
            <article key={hit.id} className="lab__hit" data-a={hit.authority}>
              <div className="lab__hit-head">
                <span className="lab__hit-auth" data-a={hit.authority}>
                  {AUTHORITY_LABEL[hit.authority]}
                </span>
                <span className="lab__hit-title">{hit.title}</span>
                <span className="lab__hit-score mono">
                  score {Math.round(hit.score * 100)}%
                </span>
              </div>
              <p className="lab__hit-content">{hit.content.slice(0, 120)}…</p>
              <div className="lab__hit-flags">
                {hit.reasons.map((reason) => (
                  <span
                    key={reason}
                    className="lab__hit-flag"
                    data-on="true"
                  >
                    {reason}
                  </span>
                ))}
              </div>
            </article>
          ))
        ) : searchMutation.data ? (
          <p className="lab__note">
            没有找到相关的故事记忆。
          </p>
        ) : (
          <p className="lab__note">
            输入问题后，相关设定、正文和记忆会显示在这里。
          </p>
        )}
      </div>
    </div>
  );
}

/* ---- 右：剧情预测 + 故事记忆 --------------------------------------------- */

function Predictions({
  predictions,
  isPending,
  isError,
  error,
  pending,
  flash,
  onAdopt,
  onDismiss,
  memories,
  memoriesPending,
  memoriesError,
}: {
  predictions: PlotPrediction[] | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  pending: boolean;
  flash: string | null;
  onAdopt: (p: PlotPrediction) => void;
  onDismiss: (p: PlotPrediction) => void;
  memories: { layer: string; title: string; content: string }[];
  memoriesPending: boolean;
  memoriesError: unknown;
}) {
  return (
    <div className="lab__panel">
      <header className="lab__panel-head">
        <p className="lab__panel-title">剧情预测</p>
        <span className="lab__panel-count mono">
          {predictions?.length ?? 0} 条
        </span>
      </header>
      <div className="lab__panel-body">
        {isPending ? (
          <Skeleton lines={2} />
        ) : isError ? (
          <ErrorNote error={error} title="预测内容暂时无法加载" />
        ) : predictions?.length === 0 ? (
          <p className="lab__note">还没有推演落成预测。</p>
        ) : (
          <div className="lab__predictions">
            {predictions?.map((prediction) => (
              <article key={prediction.id} className="lab__prediction">
                <div className="lab__prediction-head">
                  <span className="lab__prediction-horizon">
                    +{prediction.horizon} 章后
                  </span>
                  <span className="lab__prediction-title">
                    {prediction.title}
                  </span>
                  <span className="lab__prediction-status">
                    {prediction.stale
                      ? "已失效"
                      : PREDICTION_STATUS_LABEL[prediction.status]}
                  </span>
                </div>
                <p className="lab__prediction-summary">{prediction.summary}</p>
                {prediction.status === "candidate" && !prediction.stale ? (
                  <div className="lab__prediction-foot">
                    <button
                      type="button"
                      className="lab__prediction-btn"
                      disabled={pending}
                      onClick={() => onAdopt(prediction)}
                    >
                      采纳
                    </button>
                    <button
                      type="button"
                      className="lab__prediction-btn"
                      disabled={pending}
                      onClick={() => onDismiss(prediction)}
                    >
                      搁置
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
        {flash ? (
          <p className="lab__flash" role="status">
            {flash}
          </p>
        ) : null}

        <div className="lab__memories">
          <p className="lab__memories-head">故事记忆 · {memories.length}</p>
          {memoriesPending ? (
            <Skeleton lines={2} />
          ) : memoriesError ? (
            <ErrorNote error={memoriesError} title="记忆内容暂时无法加载" />
          ) : (
            <div className="lab__memory-list">
              {memories.length === 0 ? (
                <p className="lab__note">还没有记忆进仓</p>
              ) : (
                memories.slice(0, 5).map((memory, index) => (
                  <div key={index} className="lab__memory">
                    <span className="lab__memory-layer">
                      {memory.layer.toUpperCase()}
                    </span>
                    <p className="lab__memory-title">{memory.title}</p>
                    <p className="lab__memory-content">
                      {memory.content.slice(0, 90)}…
                    </p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---- 影响预演 ------------------------------------------------------------- */

function DryRun({
  input,
  setInput,
  onSubmit,
  result,
  pending,
  isError,
  error,
}: {
  input: string;
  setInput: (v: string) => void;
  onSubmit: (change: string) => void;
  result: DryRunResult | null;
  pending: boolean;
  isError: boolean;
  error: unknown;
}) {
  return (
    <div className="lab__panel">
      <header className="lab__panel-head">
        <p className="lab__panel-title">影响预演</p>
        <span className="lab__panel-count mono">PREVIEW-01</span>
      </header>
      <div className="lab__panel-body">
        <p className="lab__note">
          在正式修改前，检查这项变更会影响哪些设定、章节和故事状态。
        </p>
        <div className="lab__dryrun">
          <textarea
            className="lab__dryrun-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="例如：把林昭改成从未真实存在的人。"
            aria-label="待预演的变更"
          />
          <button
            type="button"
            className="btn lab__dryrun-btn"
            disabled={pending || input.trim() === ""}
            onClick={() => onSubmit(input.trim())}
          >
            <Send size={13} strokeWidth={1.5} aria-hidden="true" />
            预演影响
          </button>
          {isError ? (
            <ErrorNote error={error} title="影响预演失败" />
          ) : result ? (
            <div className="lab__dryrun-result" aria-label="影响预演结果">
              <span
                className="lab__dryrun-safe"
                data-safe={result.safeToProceed}
              >
                {result.safeToProceed
                  ? "继续安全，没有发现相冲链路"
                  : "不建议继续；下面这些不是孤立的"}
              </span>
              {result.findings.map((finding) => (
                <div
                  key={finding.sourceId}
                  className="lab__finding"
                  data-severity={finding.severity}
                >
                  <strong>{finding.label}</strong>
                  <p className="lab__finding-detail">
                    {finding.kind} · {finding.impact}
                  </p>
                </div>
              ))}
              <span className="lab__dryrun-fingerprint mono">
                fingerprint {result.fingerprint.slice(0, 12)}
              </span>
            </div>
          ) : (
            <p className="lab__note">
              还没有进行影响预演。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
