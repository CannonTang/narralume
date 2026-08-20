import type { Migration } from "../database.js";

/**
 * Relationship changes are immutable events. A supersession edge keeps one
 * relationship thread stable even when its human-readable label changes.
 */
export const migration021 = {
  version: 21,
  name: "021-cross-chapter-settlement",
  sql: `
    ALTER TABLE relationship_events
      ADD COLUMN supersedes_event_id TEXT REFERENCES relationship_events(id) ON DELETE SET NULL;

    UPDATE relationship_events AS current
    SET supersedes_event_id = (
      SELECT previous.id
      FROM relationship_events AS previous
      WHERE previous.project_id = current.project_id
        AND previous.from_entity_id = current.from_entity_id
        AND previous.to_entity_id = current.to_entity_id
        AND previous.relation = current.relation
        AND (
          previous.created_at < current.created_at OR
          (previous.created_at = current.created_at AND previous.rowid < current.rowid)
        )
      ORDER BY previous.created_at DESC, previous.rowid DESC
      LIMIT 1
    );

    CREATE INDEX relationship_events_supersedes_idx
      ON relationship_events(project_id, supersedes_event_id);
  `,
} as const satisfies Migration;
