export const migration009 = {
  version: 9,
  name: "review-workspace",
  sql: `
    ALTER TABLE review_reports ADD COLUMN reviewed_content TEXT;
    ALTER TABLE review_reports ADD COLUMN reviewed_content_hash TEXT;

    CREATE TABLE review_issue_actions (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES review_issues(id) ON DELETE CASCADE,
      action TEXT NOT NULL CHECK (action IN ('accept','reject','false_positive','intentional_keep')),
      note TEXT,
      prior_status TEXT NOT NULL,
      resulting_status TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX review_issue_actions_issue_idx
      ON review_issue_actions(issue_id, created_at DESC);
  `,
} as const;
