-- Give subtasks a 3-state status (todo | in_progress | done), matching tasks.
ALTER TABLE subtasks ADD COLUMN status TEXT NOT NULL DEFAULT 'todo';

-- Carry over anything already marked done.
UPDATE subtasks SET status = 'done' WHERE done = 1;
