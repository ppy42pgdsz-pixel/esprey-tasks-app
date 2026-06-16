-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo', -- todo | in_progress | done
  priority TEXT NOT NULL DEFAULT 'normal', -- low | normal | high
  source TEXT NOT NULL DEFAULT 'manual', -- manual | email
  -- Email metadata (populated when source = 'email')
  from_email TEXT,
  from_name TEXT,
  original_subject TEXT,
  original_body TEXT,
  -- AI-generated content
  draft_reply TEXT,
  -- Timestamps (Unix ms)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  due_date INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);
