-- Subtask delegation: assign subtasks to members and/or external contacts,
-- and give each subtask a shared notes area.
ALTER TABLE subtasks ADD COLUMN notes TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS subtask_assignees (
  subtask_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  PRIMARY KEY (subtask_id, user_email)
);
CREATE INDEX IF NOT EXISTS idx_subtask_assignees_user ON subtask_assignees(user_email);
CREATE INDEX IF NOT EXISTS idx_subtask_assignees_subtask ON subtask_assignees(subtask_id);

CREATE TABLE IF NOT EXISTS subtask_contacts (
  subtask_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  PRIMARY KEY (subtask_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_subtask_contacts_subtask ON subtask_contacts(subtask_id);
