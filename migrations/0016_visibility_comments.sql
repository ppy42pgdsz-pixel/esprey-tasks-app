-- Project visibility + attributed comments.
-- members_see_all: when 1, anyone assigned a task in the project can see ALL of
-- its tasks (not just their own) — for sequence context. "Watchers" reuse the
-- existing task_shares table (people who can see the whole project without a task).
ALTER TABLE tasks ADD COLUMN members_see_all INTEGER NOT NULL DEFAULT 0;

-- Per-task comment thread, each comment attributed to its author.
CREATE TABLE IF NOT EXISTS subtask_comments (
  id TEXT PRIMARY KEY,
  subtask_id TEXT NOT NULL,
  author_email TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subtask_comments_subtask ON subtask_comments(subtask_id, created_at);
