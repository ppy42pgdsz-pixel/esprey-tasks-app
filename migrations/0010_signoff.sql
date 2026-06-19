-- Phase 2: owner sign-off on subtasks + task completion timestamp.
-- A subtask marked done by a member is "awaiting sign-off" until accepted_at is set.
-- A task gets completed_at when the owner marks it complete (status = 'done').
ALTER TABLE subtasks ADD COLUMN accepted_at INTEGER;
ALTER TABLE tasks ADD COLUMN completed_at INTEGER;
