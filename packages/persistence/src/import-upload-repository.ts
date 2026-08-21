import type { ImportFormat } from "@narralume/domain";

import type { NarrativeDatabase } from "./database.js";
import { PersistenceNotFoundError } from "./project-repository.js";

export type ImportUploadStatus =
  "uploading" | "completed" | "expired" | "discarded";

export interface ImportUploadSession {
  id: string;
  batchId: string | null;
  targetProjectId: string | null;
  filename: string;
  format: ImportFormat;
  totalBytes: number;
  chunkSize: number;
  expectedHash: string | null;
  receivedBytes: number;
  receivedChunks: number;
  status: ImportUploadStatus;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

interface UploadRow {
  id: string;
  batch_id: string | null;
  target_project_id: string | null;
  filename: string;
  format: ImportFormat;
  total_bytes: number;
  chunk_size: number;
  expected_hash: string | null;
  status: ImportUploadStatus;
  expires_at: string;
  created_at: string;
  updated_at: string;
  received_bytes: number;
  received_chunks: number;
}

export class SqliteImportUploadRepository {
  constructor(private readonly database: NarrativeDatabase) {}

  create(
    input: Omit<
      ImportUploadSession,
      "batchId" | "receivedBytes" | "receivedChunks"
    >,
  ) {
    this.database.raw
      .prepare(
        `INSERT INTO import_upload_sessions(
          id, target_project_id, filename, format, total_bytes, chunk_size,
          expected_hash, status, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.targetProjectId,
        input.filename,
        input.format,
        input.totalBytes,
        input.chunkSize,
        input.expectedHash,
        input.status,
        input.expiresAt,
        input.createdAt,
        input.updatedAt,
      );
    return this.require(input.id);
  }

  get(id: string): ImportUploadSession | null {
    const row = this.database.raw
      .prepare(
        `SELECT session.*,
          COALESCE(SUM(chunk.size_bytes), 0) AS received_bytes,
          COUNT(chunk.chunk_index) AS received_chunks
         FROM import_upload_sessions session
         LEFT JOIN import_upload_chunks chunk ON chunk.session_id = session.id
         WHERE session.id = ? GROUP BY session.id`,
      )
      .get(id) as UploadRow | undefined;
    return row ? mapUpload(row) : null;
  }

  require(id: string) {
    const session = this.get(id);
    if (!session) throw new PersistenceNotFoundError("import-upload", id);
    return session;
  }

  putChunk(
    sessionId: string,
    chunkIndex: number,
    contentBase64: string,
    sizeBytes: number,
    chunkHash: string,
    now: string,
  ) {
    this.database.raw
      .prepare(
        `INSERT INTO import_upload_chunks(
          session_id, chunk_index, content_base64, size_bytes, chunk_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id, chunk_index) DO UPDATE SET
          content_base64 = excluded.content_base64,
          size_bytes = excluded.size_bytes,
          chunk_hash = excluded.chunk_hash,
          created_at = excluded.created_at`,
      )
      .run(sessionId, chunkIndex, contentBase64, sizeBytes, chunkHash, now);
    this.database.raw
      .prepare("UPDATE import_upload_sessions SET updated_at = ? WHERE id = ?")
      .run(now, sessionId);
    return this.require(sessionId);
  }

  chunks(sessionId: string) {
    return this.database.raw
      .prepare(
        `SELECT chunk_index AS chunkIndex, content_base64 AS contentBase64,
          size_bytes AS sizeBytes, chunk_hash AS chunkHash
         FROM import_upload_chunks WHERE session_id = ? ORDER BY chunk_index`,
      )
      .all(sessionId) as unknown as Array<{
      chunkIndex: number;
      contentBase64: string;
      sizeBytes: number;
      chunkHash: string;
    }>;
  }

  complete(id: string, batchId: string, now: string) {
    this.database.raw
      .prepare(
        `UPDATE import_upload_sessions
         SET status = 'completed', batch_id = ?, updated_at = ?
         WHERE id = ? AND status = 'uploading'`,
      )
      .run(batchId, now, id);
    return this.require(id);
  }

  clearChunks(id: string) {
    return this.database.raw
      .prepare("DELETE FROM import_upload_chunks WHERE session_id = ?")
      .run(id).changes;
  }

  discard(id: string, now: string) {
    this.database.raw
      .prepare(
        "UPDATE import_upload_sessions SET status = 'discarded', updated_at = ? WHERE id = ?",
      )
      .run(now, id);
    return this.require(id);
  }

  expire(now: string) {
    return this.database.transaction(() => {
      const changes = this.database.raw
        .prepare(
          `UPDATE import_upload_sessions SET status = 'expired', updated_at = ?
           WHERE status = 'uploading' AND expires_at <= ?`,
        )
        .run(now, now).changes;
      this.database.raw
        .prepare(
          `DELETE FROM import_upload_chunks WHERE session_id IN (
             SELECT id FROM import_upload_sessions WHERE status IN ('expired','discarded')
           )`,
        )
        .run();
      return changes;
    });
  }
}

function mapUpload(row: UploadRow): ImportUploadSession {
  return {
    id: row.id,
    batchId: row.batch_id,
    targetProjectId: row.target_project_id,
    filename: row.filename,
    format: row.format,
    totalBytes: row.total_bytes,
    chunkSize: row.chunk_size,
    expectedHash: row.expected_hash,
    receivedBytes: Number(row.received_bytes),
    receivedChunks: Number(row.received_chunks),
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
