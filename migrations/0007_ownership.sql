-- Task ownership + visibility, sharing, and email aliases.

ALTER TABLE tasks ADD COLUMN owner_email TEXT;
ALTER TABLE tasks ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'; -- private | shared
UPDATE tasks SET owner_email = 'cesprey@gmail.com' WHERE owner_email IS NULL;

CREATE TABLE IF NOT EXISTS task_shares (
  task_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  PRIMARY KEY (task_id, user_email)
);
CREATE INDEX IF NOT EXISTS idx_task_shares_user ON task_shares(user_email);

-- Any address (login or email sender) resolves to a primary user email.
CREATE TABLE IF NOT EXISTS user_aliases (
  alias_email TEXT PRIMARY KEY,
  user_email TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_aliases_user ON user_aliases(user_email);

-- Seed Carl's known aliases -> his primary (gmail). Adjust/extend as needed.
INSERT OR IGNORE INTO user_aliases (alias_email, user_email) VALUES
  ('cesprey@warabagold.com', 'cesprey@gmail.com'),
  ('ce@li-africa.com', 'cesprey@gmail.com'),
  ('cesprey@yahoo.com', 'cesprey@gmail.com');
