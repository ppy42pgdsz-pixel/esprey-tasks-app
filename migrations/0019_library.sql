-- Per-user attachment library. Files live here and are *referenced* by tasks
-- (a task attachment points at the same stored object). A file is kept while it
-- is attached to at least one task; once unattached (never attached, detached,
-- or its last task removed) it is deleted 30 days later. orphaned_at = when it
-- became unattached (NULL while attached).
CREATE TABLE IF NOT EXISTS library_files (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  filename TEXT,
  mime_type TEXT,
  size INTEGER,
  summary TEXT,
  created_at INTEGER NOT NULL,
  orphaned_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_library_user ON library_files(user_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_library_orphaned ON library_files(orphaned_at);

-- A task attachment created from the library points back at the library file
-- (and shares its R2 object, so deleting the task copy must not delete the file).
ALTER TABLE task_attachments ADD COLUMN library_file_id TEXT;
