-- Companies table
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Contacts table
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  company_id TEXT,
  is_favourite INTEGER NOT NULL DEFAULT 0, -- 1 = true
  created_at INTEGER NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

-- Add company and contact columns to tasks
ALTER TABLE tasks ADD COLUMN company_id TEXT;
ALTER TABLE tasks ADD COLUMN company_name TEXT;
ALTER TABLE tasks ADD COLUMN contact_id TEXT;
ALTER TABLE tasks ADD COLUMN contact_name TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_company_id ON tasks(company_id);
CREATE INDEX IF NOT EXISTS idx_tasks_contact_id ON tasks(contact_id);
CREATE INDEX IF NOT EXISTS idx_contacts_is_favourite ON contacts(is_favourite);
