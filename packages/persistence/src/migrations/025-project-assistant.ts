export const migration025 = {
  version: 25,
  name: "project-assistant",
  sql: `
    CREATE TABLE assistant_conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      status TEXT NOT NULL CHECK (status IN ('active','archived')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX assistant_conversations_project_updated
      ON assistant_conversations(project_id, updated_at DESC);

    CREATE TABLE assistant_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
      content TEXT NOT NULL CHECK (length(trim(content)) > 0),
      context_json TEXT CHECK (context_json IS NULL OR json_valid(context_json)),
      source_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      reply_to_message_id TEXT REFERENCES assistant_messages(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX assistant_messages_conversation_created
      ON assistant_messages(conversation_id, created_at, id);

    CREATE TABLE assistant_activities (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
      message_id TEXT REFERENCES assistant_messages(id) ON DELETE SET NULL,
      kind TEXT NOT NULL CHECK (kind IN ('tool_proposal','tool_execution')),
      tool_name TEXT NOT NULL CHECK (tool_name IN (
        'story.inspect','foundation.start','chapter.start','autopilot.start','task.control'
      )),
      status TEXT NOT NULL CHECK (status IN (
        'proposed','running','completed','failed','cancelled','rejected'
      )),
      goal TEXT NOT NULL CHECK (length(trim(goal)) > 0),
      input_json TEXT NOT NULL CHECK (json_valid(input_json)),
      result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
      error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
      source_type TEXT CHECK (source_type IS NULL OR source_type IN ('run','autopilot')),
      source_id TEXT,
      origin_json TEXT CHECK (origin_json IS NULL OR json_valid(origin_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (
        (source_type IS NULL AND source_id IS NULL) OR
        (source_type IS NOT NULL AND source_id IS NOT NULL)
      )
    ) STRICT;

    CREATE INDEX assistant_activities_conversation_created
      ON assistant_activities(conversation_id, created_at, id);
  `,
} as const;
