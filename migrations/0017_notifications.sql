-- In-app / OS notifications feed. One row per recipient per event; the client
-- polls unread rows while the app is open and shows an OS banner, then marks
-- them read. (Foundation for Web Push later.)
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,      -- recipient
  type TEXT NOT NULL,            -- task_done | accepted | reinstated
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  task_id TEXT,                  -- project to open on click
  subtask_id TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER               -- null = unseen
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_email, read_at, created_at DESC);
