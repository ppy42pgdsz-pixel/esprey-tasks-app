-- Optional per-subtask due date (epoch ms), used for the daily reminder digest.
ALTER TABLE subtasks ADD COLUMN due_date INTEGER;
