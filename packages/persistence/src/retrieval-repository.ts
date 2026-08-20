import { sha256Hex } from "@narrative-lantern/domain";

import type { NarrativeDatabase } from "./database.js";

export type SegmentAuthority =
  "reference" | "draft" | "candidate" | "confirmed" | "locked";

const ACTIVE_SEGMENT_PREDICATE = `(segment.source_type != 'narrative_memory'
  OR EXISTS (
    SELECT 1 FROM narrative_memories memory
    WHERE memory.id = segment.source_id
      AND memory.project_id = segment.project_id
      AND memory.status = 'active'
  ))`;

export interface TextSegment {
  id: string;
  projectId: string;
  sourceType: string;
  sourceId: string;
  title: string;
  content: string;
  authority: SegmentAuthority;
  metadata: Readonly<Record<string, unknown>>;
  entityIds: readonly string[];
  createdAt: string;
  updatedAt: string;
}

export interface RetrievalHit extends TextSegment {
  lexicalRank: number | null;
  vectorRank: number | null;
  entityScore: number;
  vectorScore: number;
  rerankScore: number | null;
  score: number;
  reasons: readonly ("fts" | "entity" | "vector" | "rerank")[];
}

export interface SegmentEmbeddingInput {
  segmentId: string;
  model: string;
  embedding: readonly number[];
  updatedAt: string;
}

interface SegmentRow {
  id: string;
  project_id: string;
  source_type: string;
  source_id: string;
  title: string;
  content: string;
  authority: SegmentAuthority;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  lexical_rank?: number;
  entity_score?: number;
  embedding_json?: string;
}

export class SqliteRetrievalRepository {
  constructor(private readonly database: NarrativeDatabase) {}

  upsertSegment(segment: TextSegment): TextSegment {
    return this.database.transaction(() => {
      this.database.raw
        .prepare(
          `
          INSERT INTO text_segments(
            id, project_id, source_type, source_id, title, content, authority,
            metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(project_id, source_type, source_id) DO UPDATE SET
            title = excluded.title,
            content = excluded.content,
            authority = excluded.authority,
            metadata_json = excluded.metadata_json,
            updated_at = excluded.updated_at
        `,
        )
        .run(
          segment.id,
          segment.projectId,
          segment.sourceType,
          segment.sourceId,
          segment.title,
          segment.content,
          segment.authority,
          JSON.stringify(segment.metadata),
          segment.createdAt,
          segment.updatedAt,
        );
      const stored = this.database.raw
        .prepare(
          "SELECT id FROM text_segments WHERE project_id = ? AND source_type = ? AND source_id = ?",
        )
        .get(segment.projectId, segment.sourceType, segment.sourceId) as {
        id: string;
      };
      this.database.raw
        .prepare("DELETE FROM segment_entities WHERE segment_id = ?")
        .run(stored.id);
      const link = this.database.raw.prepare(
        "INSERT INTO segment_entities(segment_id, entity_id, weight) VALUES (?, ?, ?)",
      );
      for (const entityId of new Set(segment.entityIds))
        link.run(stored.id, entityId, 1);
      const contentHash = segmentContentHash(segment.title, segment.content);
      this.database.raw
        .prepare(
          `DELETE FROM segment_embeddings
           WHERE segment_id = ? AND content_hash != ?`,
        )
        .run(stored.id, contentHash);
      return { ...segment, id: stored.id };
    });
  }

  upsertEmbedding(input: SegmentEmbeddingInput): void {
    const row = this.database.raw
      .prepare("SELECT title, content FROM text_segments WHERE id = ?")
      .get(input.segmentId) as { title: string; content: string } | undefined;
    if (!row) throw new Error(`Text segment not found: ${input.segmentId}`);
    const model = input.model.trim();
    if (!model) throw new Error("Embedding model cannot be empty");
    const embedding = normalizeEmbedding(input.embedding);
    this.database.raw
      .prepare(
        `INSERT INTO segment_embeddings(
           segment_id, model, dimensions, embedding_json, content_hash, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(segment_id) DO UPDATE SET
           model = excluded.model,
           dimensions = excluded.dimensions,
           embedding_json = excluded.embedding_json,
           content_hash = excluded.content_hash,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.segmentId,
        model,
        embedding.length,
        JSON.stringify(embedding),
        segmentContentHash(row.title, row.content),
        input.updatedAt,
      );
  }

  search(
    projectId: string,
    query: string,
    options: {
      entityIds?: readonly string[];
      limit?: number;
      rerank?: boolean;
      queryEmbedding?: readonly number[];
      embeddingModel?: string;
      rerankScores?: Readonly<Record<string, number>>;
    } = {},
  ): RetrievalHit[] {
    const limit = Math.max(1, Math.min(options.limit ?? 12, 100));
    const normalized = query.trim();
    const merged = new Map<string, RetrievalHit>();
    if (normalized) {
      let rows =
        normalized.length >= 3
          ? (this.database.raw
              .prepare(
                `
              SELECT segment.*, bm25(text_segments_fts, 4.0, 1.0) AS lexical_rank
              FROM text_segments_fts
              JOIN text_segments segment ON segment.row_id = text_segments_fts.rowid
              WHERE text_segments_fts MATCH ? AND segment.project_id = ?
                AND ${ACTIVE_SEGMENT_PREDICATE}
              ORDER BY lexical_rank LIMIT ?
            `,
              )
              .all(
                ftsPhrase(normalized),
                projectId,
                limit * 2,
              ) as unknown as SegmentRow[])
          : (this.database.raw
              .prepare(
                `
              SELECT segment.*, 0.0 AS lexical_rank FROM text_segments segment
              WHERE segment.project_id = ? AND (title LIKE ? OR content LIKE ?)
                AND ${ACTIVE_SEGMENT_PREDICATE}
              ORDER BY segment.updated_at DESC LIMIT ?
            `,
              )
              .all(
                projectId,
                `%${normalized}%`,
                `%${normalized}%`,
                limit * 2,
              ) as unknown as SegmentRow[]);
      if (rows.length === 0) {
        rows = this.lexicalFallback(projectId, normalized, limit * 2);
      }
      rows.forEach((row, index) => {
        const segment = mapSegment(row, this.entityIds(row.id));
        merged.set(row.id, {
          ...segment,
          lexicalRank: row.lexical_rank ?? index,
          vectorRank: null,
          entityScore: 0,
          vectorScore: 0,
          rerankScore: null,
          score: reciprocalRank(index),
          reasons: ["fts"],
        });
      });
    }

    const entityIds = [...new Set(options.entityIds ?? [])];
    if (entityIds.length > 0) {
      const placeholders = entityIds.map(() => "?").join(",");
      const rows = this.database.raw
        .prepare(
          `
          SELECT segment.*, SUM(link.weight) AS entity_score
          FROM segment_entities link
          JOIN text_segments segment ON segment.id = link.segment_id
          WHERE segment.project_id = ? AND link.entity_id IN (${placeholders})
            AND ${ACTIVE_SEGMENT_PREDICATE}
          GROUP BY segment.id
          ORDER BY entity_score DESC, segment.updated_at DESC
          LIMIT ?
        `,
        )
        .all(projectId, ...entityIds, limit * 2) as unknown as SegmentRow[];
      rows.forEach((row, index) => {
        const current = merged.get(row.id);
        const entityScore = row.entity_score ?? 0;
        if (current) {
          current.entityScore = entityScore;
          current.score += reciprocalRank(index);
          current.reasons = addReason(current.reasons, "entity");
        } else {
          const segment = mapSegment(row, this.entityIds(row.id));
          merged.set(row.id, {
            ...segment,
            lexicalRank: null,
            vectorRank: null,
            entityScore,
            vectorScore: 0,
            rerankScore: null,
            score: reciprocalRank(index),
            reasons: ["entity"],
          });
        }
      });
    }

    if (options.queryEmbedding && options.queryEmbedding.length > 0) {
      const queryEmbedding = normalizeEmbedding(options.queryEmbedding);
      const vectorRows = this.database.raw
        .prepare(
          `SELECT segment.*, embedding.embedding_json
           FROM text_segments segment
           JOIN segment_embeddings embedding ON embedding.segment_id = segment.id
           WHERE segment.project_id = ? AND embedding.dimensions = ?
             AND (? IS NULL OR embedding.model = ?)
             AND ${ACTIVE_SEGMENT_PREDICATE}`,
        )
        .all(
          projectId,
          queryEmbedding.length,
          options.embeddingModel ?? null,
          options.embeddingModel ?? null,
        ) as unknown as SegmentRow[];
      vectorRows
        .map((row) => ({
          row,
          similarity: cosineSimilarity(
            queryEmbedding,
            parseEmbedding(row.embedding_json),
          ),
        }))
        .filter(({ similarity }) => similarity > 0.04)
        .sort((left, right) => right.similarity - left.similarity)
        .slice(0, limit * 2)
        .forEach(({ row, similarity }, index) => {
          const current = merged.get(row.id);
          if (current) {
            current.vectorRank = index;
            current.vectorScore = similarity;
            current.score += reciprocalRank(index);
            current.reasons = addReason(current.reasons, "vector");
          } else {
            const segment = mapSegment(row, this.entityIds(row.id));
            merged.set(row.id, {
              ...segment,
              lexicalRank: null,
              vectorRank: index,
              entityScore: 0,
              vectorScore: similarity,
              rerankScore: null,
              score: reciprocalRank(index),
              reasons: ["vector"],
            });
          }
        });
    }

    const ranked = [...merged.values()]
      .sort(
        (left, right) =>
          right.score - left.score || right.entityScore - left.entityScore,
      )
      .slice(0, options.rerank ? limit * 2 : limit);
    if (!options.rerank) return ranked;
    return ranked
      .map((hit) => {
        const suppliedScore = options.rerankScores?.[hit.id];
        const rerankScore =
          typeof suppliedScore === "number" && Number.isFinite(suppliedScore)
            ? suppliedScore
            : deterministicRerank(hit, normalized, entityIds);
        return {
          ...hit,
          rerankScore,
          score: hit.score + rerankScore / 100,
          reasons: addReason(hit.reasons, "rerank"),
        };
      })
      .sort(
        (left, right) =>
          (right.rerankScore ?? 0) - (left.rerankScore ?? 0) ||
          right.score - left.score,
      )
      .slice(0, limit);
  }

  private entityIds(segmentId: string): string[] {
    return (
      this.database.raw
        .prepare(
          "SELECT entity_id FROM segment_entities WHERE segment_id = ? ORDER BY entity_id",
        )
        .all(segmentId) as unknown as { entity_id: string }[]
    ).map((row) => row.entity_id);
  }

  private lexicalFallback(
    projectId: string,
    query: string,
    limit: number,
  ): SegmentRow[] {
    const terms = lexicalTerms(query);
    if (terms.length === 0) return [];
    const where = terms
      .map(() => "(title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')")
      .join(" OR ");
    const parameters = terms.flatMap((term) => {
      const pattern = `%${escapeLike(term)}%`;
      return [pattern, pattern];
    });
    const rows = this.database.raw
      .prepare(
        `SELECT segment.* FROM text_segments segment
         WHERE segment.project_id = ? AND (${where})
           AND ${ACTIVE_SEGMENT_PREDICATE}
         ORDER BY segment.updated_at DESC LIMIT ?`,
      )
      .all(
        projectId,
        ...parameters,
        Math.max(limit * 4, 20),
      ) as unknown as SegmentRow[];
    const normalizedTerms = terms.map((term) => term.toLocaleLowerCase());
    return rows
      .map((row) => {
        const haystack = `${row.title}\n${row.content}`.toLocaleLowerCase();
        const matches = normalizedTerms.filter((term) =>
          haystack.includes(term),
        ).length;
        return { ...row, lexical_rank: -matches };
      })
      .sort(
        (left, right) =>
          (left.lexical_rank ?? 0) - (right.lexical_rank ?? 0) ||
          right.updated_at.localeCompare(left.updated_at),
      )
      .slice(0, limit);
  }
}

function mapSegment(
  row: SegmentRow,
  entityIds: readonly string[],
): TextSegment {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    title: row.title,
    content: row.content,
    authority: row.authority,
    metadata: parseObject(row.metadata_json),
    entityIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function reciprocalRank(index: number): number {
  return 1 / (60 + index + 1);
}

function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number {
  if (left.length !== right.length || left.length === 0) return 0;
  return left.reduce(
    (sum, value, index) => sum + value * (right[index] ?? 0),
    0,
  );
}

function normalizeEmbedding(embedding: readonly number[]): number[] {
  if (embedding.length === 0 || embedding.length > 16_384)
    throw new Error("Embedding dimensions must be between 1 and 16384");
  if (embedding.some((value) => !Number.isFinite(value)))
    throw new Error("Embedding contains a non-finite value");
  const magnitude = Math.sqrt(
    embedding.reduce((sum, value) => sum + value ** 2, 0),
  );
  if (magnitude === 0) throw new Error("Embedding cannot be a zero vector");
  return embedding.map((value) => value / magnitude);
}

function segmentContentHash(title: string, content: string): string {
  return sha256Hex(`${title}\n${content}`);
}

function parseEmbedding(value: string | undefined): number[] {
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed)
    ? parsed.filter((entry): entry is number => typeof entry === "number")
    : [];
}

function addReason<T extends RetrievalHit["reasons"][number]>(
  reasons: readonly T[],
  reason: RetrievalHit["reasons"][number],
): RetrievalHit["reasons"] {
  return reasons.includes(reason as T) ? reasons : [...reasons, reason];
}

function deterministicRerank(
  hit: RetrievalHit,
  query: string,
  entityIds: readonly string[],
): number {
  const haystack = `${hit.title}\n${hit.content}`
    .normalize("NFKC")
    .toLocaleLowerCase();
  const terms = query
    .normalize("NFKC")
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const exact = terms.reduce(
    (score, term) => score + (haystack.includes(term) ? 1 : 0),
    0,
  );
  const entityOverlap = entityIds.filter((id) =>
    hit.entityIds.includes(id),
  ).length;
  const authority = {
    locked: 1,
    confirmed: 0.8,
    reference: 0.5,
    candidate: 0.25,
    draft: 0.1,
  }[hit.authority];
  return exact * 3 + entityOverlap * 2 + hit.vectorScore * 2 + authority;
}

function ftsPhrase(query: string): string {
  return `"${query.replaceAll('"', '""')}"`;
}

function lexicalTerms(query: string): string[] {
  const normalized = query.normalize("NFKC").trim();
  const words = normalized.split(/[\s\p{P}\p{S}]+/u).filter(Boolean);
  const terms = new Set<string>();
  for (const word of words) {
    if ([...word].length <= 4) {
      terms.add(word);
      continue;
    }
    const characters = [...word];
    for (let index = 0; index + 2 <= characters.length; index += 1)
      terms.add(characters.slice(index, index + 2).join(""));
  }
  return [...terms].slice(0, 16);
}

function escapeLike(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

function parseObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}
