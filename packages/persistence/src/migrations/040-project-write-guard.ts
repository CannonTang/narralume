const projectOwnedTables = [
  "assistant_conversations",
  "assistant_long_goals",
  "author_intents",
  "autopilot_sessions",
  "canon_change_sets",
  "canon_entities",
  "canon_fact_withdrawals",
  "canon_facts",
  "context_receipts",
  "document_comments",
  "document_drafts",
  "documents",
  "edit_proposals",
  "foreshadows",
  "foundation_candidate_sets",
  "foundation_candidates",
  "imported_agent_skills",
  "knowledge_records",
  "llm_calls",
  "narrative_memories",
  "narrative_state_revisions",
  "narrative_summaries",
  "operation_log",
  "outline_nodes",
  "planning_reviews",
  "plot_predictions",
  "project_covers",
  "project_foundation_requests",
  "relationship_events",
  "review_lessons",
  "review_reports",
  "revision_proposals",
  "scene_adoptions",
  "story_compasses",
  "story_personas",
  "story_steers",
  "story_turns",
  "style_profiles",
  "text_segments",
  "timeline_events",
  "writing_skills",
  "cocreate_sessions",
] as const;

const projectReferenceGuards: Readonly<Record<string, string>> = {
  import_batches: `
    (NEW.target_project_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM projects WHERE id = NEW.target_project_id AND deleted_at IS NOT NULL
    )) OR
    (NEW.applied_project_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM projects WHERE id = NEW.applied_project_id AND deleted_at IS NOT NULL
    ))`,
  import_upload_sessions: `
    NEW.target_project_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM projects WHERE id = NEW.target_project_id AND deleted_at IS NOT NULL
    )`,
  project_backups: `
    (EXISTS (
      SELECT 1 FROM projects WHERE id = NEW.project_id AND deleted_at IS NOT NULL
    )) OR
    (NEW.restored_project_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM projects WHERE id = NEW.restored_project_id AND deleted_at IS NOT NULL
    ))`,
};

const directProjectGuards = projectOwnedTables.map(
  (table) =>
    [
      table,
      `EXISTS (
    SELECT 1 FROM projects WHERE id = NEW.project_id AND deleted_at IS NOT NULL
  )`,
    ] as const,
);

const childProjectGuards = [
  [
    "assistant_activities",
    `EXISTS (
      SELECT 1 FROM assistant_conversations conversation
      JOIN projects project ON project.id = conversation.project_id
      WHERE conversation.id = NEW.conversation_id AND project.deleted_at IS NOT NULL
    )`,
  ],
  [
    "assistant_messages",
    `EXISTS (
      SELECT 1 FROM assistant_conversations conversation
      JOIN projects project ON project.id = conversation.project_id
      WHERE conversation.id = NEW.conversation_id AND project.deleted_at IS NOT NULL
    )`,
  ],
  [
    "autopilot_run_links",
    `EXISTS (
      SELECT 1 FROM autopilot_sessions session
      JOIN projects project ON project.id = session.project_id
      WHERE session.id = NEW.session_id AND project.deleted_at IS NOT NULL
    )`,
  ],
  [
    "canon_change_set_item_decisions",
    `EXISTS (
      SELECT 1 FROM canon_change_sets change_set
      JOIN projects project ON project.id = change_set.project_id
      WHERE change_set.id = NEW.change_set_id AND project.deleted_at IS NOT NULL
    )`,
  ],
  [
    "causal_links",
    `EXISTS (
      SELECT 1 FROM timeline_events event
      JOIN projects project ON project.id = event.project_id
      WHERE event.id = NEW.effect_event_id AND project.deleted_at IS NOT NULL
    ) OR EXISTS (
      SELECT 1 FROM timeline_events event
      JOIN projects project ON project.id = event.project_id
      WHERE event.id = NEW.cause_event_id AND project.deleted_at IS NOT NULL
    )`,
  ],
  [
    "checkpoints",
    `EXISTS (
      SELECT 1 FROM runs run
      JOIN projects project ON project.id = run.project_id
      WHERE run.id = NEW.run_id AND project.deleted_at IS NOT NULL
    )`,
  ],
  [
    "cocreate_participants",
    `EXISTS (
      SELECT 1 FROM cocreate_sessions session
      JOIN projects project ON project.id = session.project_id
      WHERE session.id = NEW.session_id AND project.deleted_at IS NOT NULL
    )`,
  ],
  [
    "document_versions",
    `EXISTS (
      SELECT 1 FROM documents document
      JOIN projects project ON project.id = document.project_id
      WHERE document.id = NEW.document_id AND project.deleted_at IS NOT NULL
    )`,
  ],
  [
    "foreshadow_dependencies",
    `EXISTS (
      SELECT 1 FROM foreshadows foreshadow
      JOIN projects project ON project.id = foreshadow.project_id
      WHERE foreshadow.id = NEW.foreshadow_id AND project.deleted_at IS NOT NULL
    )`,
  ],
  [
    "foreshadow_evidence",
    `EXISTS (
      SELECT 1 FROM foreshadows foreshadow
      JOIN projects project ON project.id = foreshadow.project_id
      WHERE foreshadow.id = NEW.foreshadow_id AND project.deleted_at IS NOT NULL
    )`,
  ],
  [
    "import_analysis_artifacts",
    `EXISTS (
      SELECT 1 FROM import_batches batch
      JOIN projects project ON project.id = COALESCE(batch.target_project_id, batch.applied_project_id)
      WHERE batch.id = NEW.batch_id AND project.deleted_at IS NOT NULL
    )`,
  ],
  [
    "import_candidates",
    `EXISTS (
      SELECT 1 FROM import_batches batch
      JOIN projects project ON project.id = COALESCE(batch.target_project_id, batch.applied_project_id)
      WHERE batch.id = NEW.batch_id AND project.deleted_at IS NOT NULL
    )`,
  ],
  [
    "import_upload_chunks",
    `EXISTS (
      SELECT 1 FROM import_upload_sessions session
      JOIN projects project ON project.id = session.target_project_id
      WHERE session.id = NEW.session_id AND project.deleted_at IS NOT NULL
    )`,
  ],
  [
    "model_assignment_snapshots",
    `EXISTS (
      SELECT 1 FROM runs run
      JOIN projects project ON project.id = run.project_id
      WHERE run.id = NEW.run_id AND project.deleted_at IS NOT NULL
    )`,
  ],
  [
    "review_issue_actions",
    `EXISTS (
      SELECT 1 FROM review_issues issue
      JOIN review_reports report ON report.id = issue.report_id
      JOIN projects project ON project.id = report.project_id
      WHERE issue.id = NEW.issue_id AND project.deleted_at IS NOT NULL
    )`,
  ],
  [
    "review_issues",
    `EXISTS (
      SELECT 1 FROM review_reports report
      JOIN projects project ON project.id = report.project_id
      WHERE report.id = NEW.report_id AND project.deleted_at IS NOT NULL
    )`,
  ],
  [
    "run_artifacts",
    `EXISTS (
      SELECT 1 FROM runs run
      JOIN projects project ON project.id = run.project_id
      WHERE run.id = NEW.run_id AND project.deleted_at IS NOT NULL
        AND run.status NOT IN ('cancelled', 'failed', 'completed')
    )`,
  ],
  [
    "run_budget_entries",
    `EXISTS (
      SELECT 1 FROM runs run
      JOIN projects project ON project.id = run.project_id
      WHERE run.id = NEW.run_id AND project.deleted_at IS NOT NULL
        AND run.status NOT IN ('cancelled', 'failed', 'completed')
    )`,
  ],
  [
    "run_events",
    `EXISTS (
      SELECT 1 FROM runs run
      JOIN projects project ON project.id = run.project_id
      WHERE run.id = NEW.run_id AND project.deleted_at IS NOT NULL
        AND run.status NOT IN ('cancelled', 'failed', 'completed')
    )`,
  ],
  [
    "run_jobs",
    `EXISTS (
      SELECT 1 FROM runs run
      JOIN projects project ON project.id = run.project_id
      WHERE run.id = NEW.run_id AND project.deleted_at IS NOT NULL
        AND run.status NOT IN ('cancelled', 'failed', 'completed')
    )`,
  ],
  [
    "run_steps",
    `EXISTS (
      SELECT 1 FROM runs run
      JOIN projects project ON project.id = run.project_id
      WHERE run.id = NEW.run_id AND project.deleted_at IS NOT NULL
        AND run.status NOT IN ('cancelled', 'failed', 'completed')
    )`,
  ],
  [
    "run_stream_attempts",
    `EXISTS (
      SELECT 1 FROM runs run
      JOIN projects project ON project.id = run.project_id
      WHERE run.id = NEW.run_id AND project.deleted_at IS NOT NULL
        AND run.status NOT IN ('cancelled', 'failed', 'completed')
    )`,
  ],
  [
    "segment_embeddings",
    `EXISTS (
      SELECT 1 FROM text_segments segment
      JOIN projects project ON project.id = segment.project_id
      WHERE segment.id = NEW.segment_id AND project.deleted_at IS NOT NULL
    )`,
  ],
  [
    "segment_entities",
    `EXISTS (
      SELECT 1 FROM text_segments segment
      JOIN projects project ON project.id = segment.project_id
      WHERE segment.id = NEW.segment_id AND project.deleted_at IS NOT NULL
    )`,
  ],
  [
    "story_branches",
    `EXISTS (
      SELECT 1 FROM cocreate_sessions session
      JOIN projects project ON project.id = session.project_id
      WHERE session.id = NEW.session_id AND project.deleted_at IS NOT NULL
    )`,
  ],
  [
    "timeline_participants",
    `EXISTS (
      SELECT 1 FROM timeline_events event
      JOIN projects project ON project.id = event.project_id
      WHERE event.id = NEW.event_id AND project.deleted_at IS NOT NULL
    )`,
  ],
  [
    "tool_calls",
    `EXISTS (
      SELECT 1 FROM runs run
      JOIN projects project ON project.id = run.project_id
      WHERE run.id = NEW.run_id AND project.deleted_at IS NOT NULL
        AND run.status NOT IN ('cancelled', 'failed', 'completed')
    )`,
  ],
  [
    "turn_swipes",
    `EXISTS (
      SELECT 1 FROM story_turns turn
      JOIN projects project ON project.id = turn.project_id
      WHERE turn.id = NEW.turn_id AND project.deleted_at IS NOT NULL
    )`,
  ],
  [
    "writing_skill_references",
    `EXISTS (
      SELECT 1 FROM writing_skills skill
      JOIN projects project ON project.id = skill.project_id
      WHERE skill.id = NEW.skill_id AND project.deleted_at IS NOT NULL
    )`,
  ],
] as const;

function triggerSql(
  table: string,
  expression: string,
  operations: readonly ("insert" | "update")[] = ["insert", "update"],
): string {
  const base = `${table.replaceAll("_", "-")}-project-write-guard`;
  return operations
    .map(
      (operation) => `
        CREATE TRIGGER IF NOT EXISTS "${base}-${operation}"
        BEFORE ${operation.toUpperCase()} ON "${table}"
        BEGIN
          SELECT RAISE(ABORT, 'project.not_found') WHERE ${expression};
        END;
      `,
    )
    .join("\n");
}

// A supervisor must be able to mark a leased run's step failed and release its
// queue row after a project is deleted. Those bookkeeping rows are guarded by
// the Run API's active-project check and worker commit boundary instead of a
// trigger that would also block recovery itself.
const operationalRunTables = new Set([
  "checkpoints",
  "model_assignment_snapshots",
  "run_artifacts",
  "run_budget_entries",
  "run_events",
  "run_jobs",
  "run_steps",
  "run_stream_attempts",
  "tool_calls",
]);

export const migration040 = {
  version: 40,
  name: "project-write-guard",
  sql: [
    [
      ...directProjectGuards,
      ...Object.entries(projectReferenceGuards),
      ...childProjectGuards.filter(
        ([table]) => !operationalRunTables.has(table),
      ),
    ]
      .map(([table, expression]) => triggerSql(table, expression))
      .join("\n"),
    triggerSql(
      "runs",
      `EXISTS (
        SELECT 1 FROM projects WHERE id = NEW.project_id AND deleted_at IS NOT NULL
      )`,
      ["insert"],
    ),
  ].join("\n"),
};
