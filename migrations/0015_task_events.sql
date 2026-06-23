-- Activity timeline: an auto-logged, read-only history of what happened on a task.
-- Written at the API layer (and by the email worker) on meaningful actions:
-- created, completed, reopened, subtask_added, subtask_done, accepted,
-- reinstated, assigned. Shown as a collapsed "Activity (N)" list on the task.
CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  actor_email TEXT,                 -- who did it (null = system)
  type TEXT NOT NULL,               -- created | completed | reopened | subtask_added | subtask_done | accepted | reinstated | assigned
  detail TEXT NOT NULL DEFAULT '',  -- human-readable summary
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id, created_at DESC);
