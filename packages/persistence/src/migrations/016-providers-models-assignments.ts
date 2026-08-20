export const migration016 = {
  version: 16,
  name: "providers-models-assignments",
  // Introduces the provider/model/assignment configuration model and copies
  // data forward from model_profiles / model_routing_rules. The legacy tables
  // are intentionally kept (read-only) so a rollback stays possible.
  sql: `
    CREATE TABLE providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      wire_api TEXT NOT NULL CHECK (wire_api IN ('openai-chat','openai-responses','anthropic-messages')),
      base_url TEXT NOT NULL,
      endpoint TEXT,
      credential_ref TEXT NOT NULL,
      anthropic_version TEXT,
      headers_json TEXT,
      query_params_json TEXT,
      request_start_timeout_ms INTEGER,
      stream_idle_timeout_ms INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE models (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      model_id TEXT NOT NULL,
      task_type TEXT NOT NULL CHECK (task_type IN ('writing','planning','review','embedding','rerank')),
      context_window INTEGER,
      max_output_tokens INTEGER,
      sampling_json TEXT,
      capabilities_json TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(provider_id, model_id, task_type)
    ) STRICT;

    CREATE TABLE model_assignments (
      role TEXT PRIMARY KEY CHECK (role IN ('writing','planning','review','embedding','rerank')),
      model_id TEXT NOT NULL REFERENCES models(id) ON DELETE RESTRICT,
      updated_at TEXT NOT NULL
    ) STRICT;

    INSERT INTO providers(
      id, name, wire_api, base_url, endpoint, credential_ref, anthropic_version,
      headers_json, query_params_json, request_start_timeout_ms,
      stream_idle_timeout_ms, enabled, created_at, updated_at
    )
    SELECT
      id, name, protocol, base_url, endpoint, 'env:' || api_key_env,
      anthropic_version, extra_headers_json, NULL, NULL, NULL,
      enabled, created_at, updated_at
    FROM model_profiles;

    INSERT INTO models(
      id, provider_id, model_id, task_type, context_window, max_output_tokens,
      sampling_json, capabilities_json, enabled, created_at, updated_at
    )
    SELECT
      id, id, model, 'writing', NULL, NULL, NULL,
      capabilities_json, enabled, created_at, updated_at
    FROM model_profiles;

    -- Legacy roles revision/settlement/analysis have no assignment target;
    -- they fall back to 'writing' at runtime.
    INSERT INTO model_assignments(role, model_id, updated_at)
    SELECT
      CASE role WHEN 'drafting' THEN 'writing' ELSE role END,
      primary_profile_id,
      updated_at
    FROM model_routing_rules
    WHERE role IN ('drafting', 'planning', 'review');

    INSERT INTO model_assignments(role, model_id, updated_at)
    SELECT 'writing', id, updated_at
    FROM models
    WHERE enabled = 1
      AND NOT EXISTS (
        SELECT 1 FROM model_assignments WHERE role = 'writing'
      )
    ORDER BY created_at, id
    LIMIT 1;
  `,
} as const;
