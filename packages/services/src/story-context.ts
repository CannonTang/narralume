import {
  canonContextSources,
  ContextCompiler,
  type ContextSource,
} from "@narrative-lantern/context";
import type { CanonAccess } from "@narrative-lantern/domain";
import {
  SqliteCanonRepository,
  SqliteContextReceiptRepository,
  SqliteRetrievalRepository,
  SqliteStoryRepository,
  type NarrativeDatabase,
} from "@narrative-lantern/persistence";

export interface StoryContextPreviewInput {
  projectId: string;
  purpose: string;
  task: string;
  query: string;
  entityIds: readonly string[];
  currentOutlineNodeId: string | null;
  access: CanonAccess;
  budget: {
    contextWindow: number;
    outputReserve: number;
    fixedInstructionReserve: number;
    toolReserve: number;
    schemaReserve: number;
    safetyReserve?: number;
  };
}

export class StoryContextPreviewService {
  private readonly story: SqliteStoryRepository;
  private readonly canon: SqliteCanonRepository;
  private readonly retrieval: SqliteRetrievalRepository;
  private readonly receipts: SqliteContextReceiptRepository;
  private readonly compiler = new ContextCompiler();

  constructor(database: NarrativeDatabase) {
    this.story = new SqliteStoryRepository(database);
    this.canon = new SqliteCanonRepository(database);
    this.retrieval = new SqliteRetrievalRepository(database);
    this.receipts = new SqliteContextReceiptRepository(database);
  }

  compile(input: StoryContextPreviewInput) {
    const sources: ContextSource[] = [
      {
        id: "task:current",
        kind: "task",
        label: "本轮任务",
        content: input.task,
        authority: "locked",
        priority: 100,
        required: true,
        compressible: false,
        sourceType: "request",
      },
    ];
    const intent = this.story.getAuthorIntent(input.projectId);
    if (intent) {
      const lines = [
        intent.promise && `创作承诺：${intent.promise}`,
        intent.themes.length && `主题：${intent.themes.join("、")}`,
        intent.audience && `读者：${intent.audience}`,
        intent.tone && `语气：${intent.tone}`,
        intent.boundaries.length && `边界：${intent.boundaries.join("；")}`,
        intent.endingDirection && `结局方向：${intent.endingDirection}`,
        intent.currentFocus && `当前焦点：${intent.currentFocus}`,
      ].filter((line): line is string => Boolean(line));
      if (lines.length) {
        sources.push({
          id: "author-intent",
          kind: "author-intent",
          label: "作者意图",
          content: lines.join("\n"),
          authority: "locked",
          priority: 95,
          required: true,
          compressible: false,
          sourceType: "author_intent",
          sourceId: input.projectId,
        });
      }
    }

    const outline = this.story.listOutline(input.projectId);
    const activeOutline = input.currentOutlineNodeId
      ? outline.filter(
          (node) =>
            node.id === input.currentOutlineNodeId ||
            input.currentOutlineNodeId?.startsWith(`${node.id}/`) ||
            outline
              .find((candidate) => candidate.id === input.currentOutlineNodeId)
              ?.path.startsWith(`${node.path}/`),
        )
      : outline;
    if (activeOutline.length) {
      const outlineText = activeOutline
        .map(
          (node) =>
            `${"  ".repeat(node.depth)}- [${node.kind}] ${node.title}${node.summary ? `：${node.summary}` : ""}`,
        )
        .join("\n");
      sources.push({
        id: "outline:active",
        kind: "outline",
        label: "相关大纲",
        content: outlineText,
        authority: "confirmed",
        priority: 85,
        sourceType: "outline",
        sourceId: input.currentOutlineNodeId ?? input.projectId,
      });
    }

    sources.push(
      ...canonContextSources(
        this.canon.listEntities(input.projectId),
        this.canon.listEffectiveFacts(input.projectId, {
          ...(input.access.includeCandidates === undefined
            ? {}
            : { includeCandidates: input.access.includeCandidates }),
        }),
        input.access,
      ),
    );

    for (const hit of this.retrieval.search(input.projectId, input.query, {
      entityIds: input.entityIds,
      limit: 8,
    })) {
      sources.push({
        id: `retrieval:${hit.id}`,
        kind: "retrieval",
        label: hit.title || `${hit.sourceType}:${hit.sourceId}`,
        content: hit.content,
        authority:
          hit.authority === "locked"
            ? "locked"
            : hit.authority === "confirmed"
              ? "confirmed"
              : "reference",
        priority: 50 + Math.round(hit.score * 100),
        sourceType: hit.sourceType,
        sourceId: hit.sourceId,
      });
    }

    const compiled = this.compiler.compile({
      projectId: input.projectId,
      purpose: input.purpose,
      budget: input.budget,
      sources,
    });
    this.receipts.insert(compiled.receipt);
    return compiled;
  }
}
