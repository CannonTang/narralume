import type { NarrativeDatabase } from "./database.js";

export interface ProjectStatistics {
  projectId: string;
  lastWritingAt: string | null;
  wordCount: number;
  committedChapters: number;
  totalChapters: number;
}

interface ProjectStatisticsRow {
  project_id: string;
  last_writing_at: string | null;
  word_count: number;
  committed_chapters: number;
  total_chapters: number;
}

const ECMASCRIPT_WHITESPACE_CODE_POINTS = [
  9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198,
  8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279,
] as const;

const NON_WHITESPACE_CONTENT_SQL = ECMASCRIPT_WHITESPACE_CODE_POINTS.reduce(
  (expression, codePoint) => `REPLACE(${expression}, CHAR(${codePoint}), '')`,
  "version.content",
);

export class SqliteProjectStatisticsRepository {
  constructor(private readonly database: NarrativeDatabase) {}

  get(projectId: string): ProjectStatistics | null {
    return this.list([projectId]).get(projectId) ?? null;
  }

  list(projectIds: readonly string[]): Map<string, ProjectStatistics> {
    if (projectIds.length === 0) return new Map();
    const placeholders = projectIds.map(() => "?").join(", ");
    const rows = this.database.raw
      .prepare(
        `WITH outline_stats AS (
           SELECT project_id,
                  COUNT(*) AS total_chapters,
                  SUM(CASE WHEN status = 'committed' THEN 1 ELSE 0 END) AS committed_chapters
           FROM outline_nodes
           WHERE kind = 'chapter' AND project_id IN (${placeholders})
           GROUP BY project_id
         ), writing_stats AS (
           SELECT document.project_id,
                  MAX(version.created_at) AS last_writing_at,
                  COALESCE(SUM(LENGTH(${NON_WHITESPACE_CONTENT_SQL})), 0) AS word_count
           FROM documents document
           JOIN document_versions version ON version.id = document.current_version_id
           WHERE document.kind = 'chapter' AND document.project_id IN (${placeholders})
           GROUP BY document.project_id
         )
         SELECT project.id AS project_id,
                writing_stats.last_writing_at,
                COALESCE(writing_stats.word_count, 0) AS word_count,
                COALESCE(outline_stats.committed_chapters, 0) AS committed_chapters,
                COALESCE(outline_stats.total_chapters, 0) AS total_chapters
         FROM projects project
         LEFT JOIN outline_stats ON outline_stats.project_id = project.id
         LEFT JOIN writing_stats ON writing_stats.project_id = project.id
         WHERE project.id IN (${placeholders})`,
      )
      .all(
        ...projectIds,
        ...projectIds,
        ...projectIds,
      ) as unknown as ProjectStatisticsRow[];
    return new Map(rows.map((row) => [row.project_id, mapStatistics(row)]));
  }
}

function mapStatistics(row: ProjectStatisticsRow): ProjectStatistics {
  return {
    projectId: row.project_id,
    lastWritingAt: row.last_writing_at,
    wordCount: row.word_count,
    committedChapters: row.committed_chapters,
    totalChapters: row.total_chapters,
  };
}
