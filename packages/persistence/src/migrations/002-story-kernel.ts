export const migration002 = {
  version: 2,
  name: "story-kernel",
  sql: `
    CREATE TABLE author_intents (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      promise TEXT,
      themes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(themes_json)),
      audience TEXT,
      tone TEXT,
      boundaries_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(boundaries_json)),
      ending_direction TEXT,
      current_focus TEXT,
      locked_fields_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(locked_fields_json)),
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE outline_nodes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES outline_nodes(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('book','volume','arc','chapter','scene','beat')),
      path TEXT NOT NULL,
      depth INTEGER NOT NULL CHECK (depth >= 0),
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      title TEXT NOT NULL,
      summary TEXT,
      goal TEXT,
      conflict TEXT,
      outcome TEXT,
      pov_entity_id TEXT,
      story_time TEXT,
      status TEXT NOT NULL CHECK (status IN ('planned','drafting','review','committed','abandoned')),
      metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, path),
      UNIQUE(project_id, parent_id, ordinal)
    ) STRICT;

    CREATE UNIQUE INDEX outline_root_project_idx
      ON outline_nodes(project_id) WHERE parent_id IS NULL;
    CREATE INDEX outline_tree_idx ON outline_nodes(project_id, path);
    CREATE INDEX outline_kind_status_idx ON outline_nodes(project_id, kind, status, ordinal);

    CREATE TABLE canon_entities (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('character','location','organization','item','rule','concept')),
      name TEXT NOT NULL,
      aliases_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(aliases_json)),
      description TEXT,
      attributes_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(attributes_json)),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, type, name)
    ) STRICT;

    CREATE INDEX canon_entities_project_type_idx ON canon_entities(project_id, type, status, name);

    CREATE VIRTUAL TABLE canon_entities_fts USING fts5(
      name,
      aliases,
      description,
      content='canon_entities',
      content_rowid='rowid',
      tokenize='trigram'
    );

    CREATE TRIGGER canon_entities_fts_insert AFTER INSERT ON canon_entities BEGIN
      INSERT INTO canon_entities_fts(rowid, name, aliases, description)
      VALUES (new.rowid, new.name, new.aliases_json, COALESCE(new.description, ''));
    END;
    CREATE TRIGGER canon_entities_fts_delete AFTER DELETE ON canon_entities BEGIN
      INSERT INTO canon_entities_fts(canon_entities_fts, rowid, name, aliases, description)
      VALUES ('delete', old.rowid, old.name, old.aliases_json, COALESCE(old.description, ''));
    END;
    CREATE TRIGGER canon_entities_fts_update AFTER UPDATE ON canon_entities BEGIN
      INSERT INTO canon_entities_fts(canon_entities_fts, rowid, name, aliases, description)
      VALUES ('delete', old.rowid, old.name, old.aliases_json, COALESCE(old.description, ''));
      INSERT INTO canon_entities_fts(rowid, name, aliases, description)
      VALUES (new.rowid, new.name, new.aliases_json, COALESCE(new.description, ''));
    END;

    CREATE TABLE canon_facts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      subject_id TEXT NOT NULL REFERENCES canon_entities(id) ON DELETE CASCADE,
      predicate TEXT NOT NULL,
      object_entity_id TEXT REFERENCES canon_entities(id) ON DELETE CASCADE,
      value_json TEXT CHECK (value_json IS NULL OR json_valid(value_json)),
      valid_from_node_id TEXT REFERENCES outline_nodes(id) ON DELETE SET NULL,
      valid_to_node_id TEXT REFERENCES outline_nodes(id) ON DELETE SET NULL,
      knowledge_scope TEXT NOT NULL CHECK (knowledge_scope IN ('omniscient','reader','character','author_secret')),
      knowledge_subject_id TEXT REFERENCES canon_entities(id) ON DELETE CASCADE,
      authority TEXT NOT NULL CHECK (authority IN ('candidate','inferred','confirmed','locked')),
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      source_type TEXT NOT NULL,
      source_id TEXT,
      supersedes_fact_id TEXT REFERENCES canon_facts(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      CHECK (
        (object_entity_id IS NOT NULL AND value_json IS NULL) OR
        (object_entity_id IS NULL AND value_json IS NOT NULL)
      ),
      CHECK (knowledge_scope != 'character' OR knowledge_subject_id IS NOT NULL)
    ) STRICT;

    CREATE INDEX canon_facts_subject_idx
      ON canon_facts(project_id, subject_id, predicate, authority, created_at DESC);
    CREATE INDEX canon_facts_object_idx ON canon_facts(project_id, object_entity_id);

    CREATE TABLE relationship_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      from_entity_id TEXT NOT NULL REFERENCES canon_entities(id) ON DELETE CASCADE,
      to_entity_id TEXT NOT NULL REFERENCES canon_entities(id) ON DELETE CASCADE,
      relation TEXT NOT NULL,
      intensity REAL,
      state_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(state_json)),
      outline_node_id TEXT REFERENCES outline_nodes(id) ON DELETE SET NULL,
      story_time TEXT,
      source_id TEXT,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX relationship_events_pair_idx
      ON relationship_events(project_id, from_entity_id, to_entity_id, created_at DESC);

    CREATE TABLE timeline_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      outline_node_id TEXT REFERENCES outline_nodes(id) ON DELETE SET NULL,
      story_time_start TEXT,
      story_time_end TEXT,
      sequence INTEGER NOT NULL,
      visibility TEXT NOT NULL CHECK (visibility IN ('omniscient','reader','author_secret')),
      source_id TEXT,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX timeline_events_order_idx
      ON timeline_events(project_id, sequence, story_time_start, created_at);

    CREATE TABLE timeline_participants (
      event_id TEXT NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
      entity_id TEXT NOT NULL REFERENCES canon_entities(id) ON DELETE CASCADE,
      role TEXT,
      PRIMARY KEY(event_id, entity_id)
    ) WITHOUT ROWID;

    CREATE TABLE causal_links (
      cause_event_id TEXT NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
      effect_event_id TEXT NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'causes',
      PRIMARY KEY(cause_event_id, effect_event_id),
      CHECK (cause_event_id != effect_event_id)
    ) WITHOUT ROWID;

    CREATE TABLE foreshadows (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('planned','planted','developing','resolved','abandoned')),
      importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
      target_from_node_id TEXT REFERENCES outline_nodes(id) ON DELETE SET NULL,
      target_to_node_id TEXT REFERENCES outline_nodes(id) ON DELETE SET NULL,
      resolution_node_id TEXT REFERENCES outline_nodes(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX foreshadows_status_idx
      ON foreshadows(project_id, status, importance DESC, updated_at DESC);

    CREATE TABLE foreshadow_dependencies (
      foreshadow_id TEXT NOT NULL REFERENCES foreshadows(id) ON DELETE CASCADE,
      depends_on_id TEXT NOT NULL REFERENCES foreshadows(id) ON DELETE CASCADE,
      PRIMARY KEY(foreshadow_id, depends_on_id),
      CHECK (foreshadow_id != depends_on_id)
    ) WITHOUT ROWID;

    CREATE TABLE foreshadow_evidence (
      foreshadow_id TEXT NOT NULL REFERENCES foreshadows(id) ON DELETE CASCADE,
      outline_node_id TEXT NOT NULL REFERENCES outline_nodes(id) ON DELETE CASCADE,
      note TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY(foreshadow_id, outline_node_id)
    ) WITHOUT ROWID;

    CREATE TABLE knowledge_records (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      knower_type TEXT NOT NULL CHECK (knower_type IN ('reader','character')),
      knower_entity_id TEXT REFERENCES canon_entities(id) ON DELETE CASCADE,
      fact_id TEXT REFERENCES canon_facts(id) ON DELETE CASCADE,
      timeline_event_id TEXT REFERENCES timeline_events(id) ON DELETE CASCADE,
      learned_at_node_id TEXT NOT NULL REFERENCES outline_nodes(id) ON DELETE CASCADE,
      belief TEXT NOT NULL CHECK (belief IN ('known','believed','suspected','false_belief')),
      source_id TEXT,
      created_at TEXT NOT NULL,
      CHECK (knower_type != 'character' OR knower_entity_id IS NOT NULL),
      CHECK ((fact_id IS NOT NULL) != (timeline_event_id IS NOT NULL))
    ) STRICT;

    CREATE INDEX knowledge_knower_idx
      ON knowledge_records(project_id, knower_type, knower_entity_id, learned_at_node_id);

    CREATE TABLE narrative_summaries (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      scope_type TEXT NOT NULL CHECK (scope_type IN ('scene','chapter','arc','volume','book','session')),
      scope_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      state_delta_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(state_delta_json)),
      source_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(project_id, scope_type, scope_id, source_hash)
    ) STRICT;

    CREATE INDEX narrative_summaries_scope_idx
      ON narrative_summaries(project_id, scope_type, scope_id, created_at DESC);

    CREATE TABLE text_segments (
      row_id INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      authority TEXT NOT NULL CHECK (authority IN ('reference','draft','candidate','confirmed','locked')),
      metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, source_type, source_id)
    ) STRICT;

    CREATE VIRTUAL TABLE text_segments_fts USING fts5(
      title,
      content,
      content='text_segments',
      content_rowid='row_id',
      tokenize='trigram'
    );

    CREATE TRIGGER text_segments_fts_insert AFTER INSERT ON text_segments BEGIN
      INSERT INTO text_segments_fts(rowid, title, content)
      VALUES (new.row_id, new.title, new.content);
    END;
    CREATE TRIGGER text_segments_fts_delete AFTER DELETE ON text_segments BEGIN
      INSERT INTO text_segments_fts(text_segments_fts, rowid, title, content)
      VALUES ('delete', old.row_id, old.title, old.content);
    END;
    CREATE TRIGGER text_segments_fts_update AFTER UPDATE ON text_segments BEGIN
      INSERT INTO text_segments_fts(text_segments_fts, rowid, title, content)
      VALUES ('delete', old.row_id, old.title, old.content);
      INSERT INTO text_segments_fts(rowid, title, content)
      VALUES (new.row_id, new.title, new.content);
    END;

    CREATE TABLE segment_entities (
      segment_id TEXT NOT NULL REFERENCES text_segments(id) ON DELETE CASCADE,
      entity_id TEXT NOT NULL REFERENCES canon_entities(id) ON DELETE CASCADE,
      weight REAL NOT NULL DEFAULT 1 CHECK (weight >= 0),
      PRIMARY KEY(segment_id, entity_id)
    ) WITHOUT ROWID;
  `,
} as const;
