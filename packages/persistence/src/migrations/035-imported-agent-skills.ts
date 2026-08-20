export const migration035 = {
  version: 35,
  name: "imported-agent-skills",
  sql: `
    CREATE TABLE imported_agent_skills (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      label TEXT NOT NULL CHECK (length(trim(label)) > 0),
      version TEXT NOT NULL CHECK (length(trim(version)) > 0),
      description TEXT NOT NULL,
      trigger_description TEXT NOT NULL,
      instructions TEXT NOT NULL,
      references_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(references_json)),
      required_context_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(required_context_json)),
      allowed_capabilities_json TEXT NOT NULL CHECK (json_valid(allowed_capabilities_json)),
      output_kind TEXT NOT NULL CHECK (output_kind IN ('answer','candidate','task_handle','long_goal')),
      checkpoint TEXT NOT NULL CHECK (checkpoint IN ('none','confirm_start','candidate_adoption')),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      source TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, label)
    ) STRICT;

    CREATE INDEX imported_agent_skills_project_idx
      ON imported_agent_skills(project_id, enabled, label);
  `,
} as const;
