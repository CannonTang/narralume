import type { NarrativeDatabase } from "./database.js";
import { ConfigurationVersionConflictError } from "./provider-repository.js";

export const MODEL_TASK_TYPES = [
  "writing",
  "planning",
  "review",
  "embedding",
  "rerank",
] as const;
export type ModelTaskType = (typeof MODEL_TASK_TYPES)[number];
export type ModelMetadataSource =
  "manual" | "environment" | "catalog" | "migration";

export interface StoredModel {
  id: string;
  providerId: string;
  modelId: string;
  taskType: ModelTaskType;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  sampling: Record<string, unknown>;
  capabilities: Record<string, boolean>;
  metadataSource: ModelMetadataSource;
  metadataVerifiedAt: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ModelRow {
  id: string;
  provider_id: string;
  model_id: string;
  task_type: ModelTaskType;
  context_window: number | null;
  max_output_tokens: number | null;
  sampling_json: string | null;
  capabilities_json: string | null;
  metadata_source: ModelMetadataSource;
  metadata_verified_at: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export class SqliteModelRepository {
  constructor(private readonly database: NarrativeDatabase) {}

  upsert(
    input: Omit<StoredModel, "metadataSource" | "metadataVerifiedAt"> &
      Partial<Pick<StoredModel, "metadataSource" | "metadataVerifiedAt">>,
  ): StoredModel {
    const model: StoredModel = {
      ...input,
      metadataSource: input.metadataSource ?? "manual",
      metadataVerifiedAt: input.metadataVerifiedAt ?? null,
    };
    this.database.raw
      .prepare(
        `
        INSERT INTO models(
          id, provider_id, model_id, task_type, context_window,
          max_output_tokens, sampling_json, capabilities_json,
          metadata_source, metadata_verified_at, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          provider_id = excluded.provider_id,
          model_id = excluded.model_id,
          task_type = excluded.task_type,
          context_window = excluded.context_window,
          max_output_tokens = excluded.max_output_tokens,
          sampling_json = excluded.sampling_json,
          capabilities_json = excluded.capabilities_json,
          metadata_source = excluded.metadata_source,
          metadata_verified_at = excluded.metadata_verified_at,
          enabled = excluded.enabled,
          updated_at = excluded.updated_at
      `,
      )
      .run(
        model.id,
        model.providerId,
        model.modelId,
        model.taskType,
        model.contextWindow,
        model.maxOutputTokens,
        JSON.stringify(model.sampling),
        JSON.stringify(model.capabilities),
        model.metadataSource,
        model.metadataVerifiedAt,
        model.enabled ? 1 : 0,
        model.createdAt,
        model.updatedAt,
      );
    return model;
  }

  update(model: StoredModel, expectedUpdatedAt: string): StoredModel {
    const result = this.database.raw
      .prepare(
        `UPDATE models SET provider_id = ?, model_id = ?, task_type = ?,
           context_window = ?, max_output_tokens = ?, sampling_json = ?,
           capabilities_json = ?, metadata_source = ?, metadata_verified_at = ?,
           enabled = ?, updated_at = ? WHERE id = ? AND updated_at = ?`,
      )
      .run(
        model.providerId,
        model.modelId,
        model.taskType,
        model.contextWindow,
        model.maxOutputTokens,
        JSON.stringify(model.sampling),
        JSON.stringify(model.capabilities),
        model.metadataSource,
        model.metadataVerifiedAt,
        model.enabled ? 1 : 0,
        model.updatedAt,
        model.id,
        expectedUpdatedAt,
      );
    if (result.changes !== 1) {
      throw new ConfigurationVersionConflictError("model", model.id);
    }
    return this.get(model.id)!;
  }

  get(id: string): StoredModel | null {
    const row = this.database.raw
      .prepare("SELECT * FROM models WHERE id = ?")
      .get(id) as ModelRow | undefined;
    return row ? mapModel(row) : null;
  }

  list(enabledOnly = false): StoredModel[] {
    const rows = this.database.raw
      .prepare(
        enabledOnly
          ? "SELECT * FROM models WHERE enabled = 1 ORDER BY provider_id, model_id"
          : "SELECT * FROM models ORDER BY provider_id, model_id",
      )
      .all() as unknown as ModelRow[];
    return rows.map(mapModel);
  }

  listByProvider(providerId: string, enabledOnly = false): StoredModel[] {
    const rows = this.database.raw
      .prepare(
        enabledOnly
          ? "SELECT * FROM models WHERE provider_id = ? AND enabled = 1 ORDER BY model_id"
          : "SELECT * FROM models WHERE provider_id = ? ORDER BY model_id",
      )
      .all(providerId) as unknown as ModelRow[];
    return rows.map(mapModel);
  }

  listByTaskType(taskType: ModelTaskType, enabledOnly = false): StoredModel[] {
    const rows = this.database.raw
      .prepare(
        enabledOnly
          ? "SELECT * FROM models WHERE task_type = ? AND enabled = 1 ORDER BY provider_id, model_id"
          : "SELECT * FROM models WHERE task_type = ? ORDER BY provider_id, model_id",
      )
      .all(taskType) as unknown as ModelRow[];
    return rows.map(mapModel);
  }

  delete(id: string): boolean {
    return (
      this.database.raw.prepare("DELETE FROM models WHERE id = ?").run(id)
        .changes === 1
    );
  }
}

function mapModel(row: ModelRow): StoredModel {
  return {
    id: row.id,
    providerId: row.provider_id,
    modelId: row.model_id,
    taskType: row.task_type,
    contextWindow: row.context_window,
    maxOutputTokens: row.max_output_tokens,
    sampling: parseRecord(row.sampling_json),
    capabilities: parseBooleanRecord(row.capabilities_json),
    metadataSource: row.metadata_source,
    metadataVerifiedAt: row.metadata_verified_at,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseRecord(value: string | null): Record<string, unknown> {
  if (value === null) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

function parseBooleanRecord(value: string | null): Record<string, boolean> {
  const parsed = parseRecord(value);
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
    ),
  );
}
