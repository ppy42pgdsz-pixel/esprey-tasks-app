-- Recurring tasks (schedule-based, baton-passing).
-- A task repeats every recur_interval × recur_unit. A daily worker cron spawns a
-- fresh copy when recur_next_at is reached and moves the recurrence onto the new
-- copy (clearing it on the old one). recur_active = 0 pauses without forgetting.
ALTER TABLE tasks ADD COLUMN recur_interval INTEGER;             -- the N in "every N units"
ALTER TABLE tasks ADD COLUMN recur_unit TEXT;                    -- 'day' | 'week' | 'month' | NULL = does not repeat
ALTER TABLE tasks ADD COLUMN recur_next_at INTEGER;             -- epoch ms (UTC midnight): when the next copy is generated
ALTER TABLE tasks ADD COLUMN recur_active INTEGER NOT NULL DEFAULT 1; -- 1 = repeating, 0 = paused

-- The cron scans for due recurrences; index the lookup.
CREATE INDEX IF NOT EXISTS idx_tasks_recur ON tasks(recur_next_at) WHERE recur_unit IS NOT NULL;
