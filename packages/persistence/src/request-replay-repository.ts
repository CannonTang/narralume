import type { NarrativeDatabase } from "./database.js";

export interface RequestReplay<T = unknown> {
  scope: string;
  requestId: string;
  requestHash: string;
  result: T;
  createdAt: string;
}

export class SqliteRequestReplayRepository {
  constructor(private readonly database: NarrativeDatabase) {}

  get<T = unknown>(scope: string, requestId: string): RequestReplay<T> | null {
    const row = this.database.raw
      .prepare(
        "SELECT * FROM request_replays WHERE scope = ? AND request_id = ?",
      )
      .get(scope, requestId) as RequestReplayRow | undefined;
    return row ? mapReplay<T>(row) : null;
  }

  insert<T>(replay: RequestReplay<T>): RequestReplay<T> {
    this.database.raw
      .prepare(
        `INSERT INTO request_replays(
          scope, request_id, request_hash, result_json, created_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        replay.scope,
        replay.requestId,
        replay.requestHash,
        JSON.stringify(replay.result),
        replay.createdAt,
      );
    return replay;
  }
}

interface RequestReplayRow {
  scope: string;
  request_id: string;
  request_hash: string;
  result_json: string;
  created_at: string;
}

function mapReplay<T>(row: RequestReplayRow): RequestReplay<T> {
  return {
    scope: row.scope,
    requestId: row.request_id,
    requestHash: row.request_hash,
    result: JSON.parse(row.result_json) as T,
    createdAt: row.created_at,
  };
}
