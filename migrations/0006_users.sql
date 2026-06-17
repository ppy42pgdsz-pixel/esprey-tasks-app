-- Employees / team members who can log in and be shared/assigned tasks.
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member', -- admin | member
  created_at INTEGER NOT NULL
);

-- Seed the admin (Carl). Adjust the email if your Cloudflare Access login differs.
INSERT OR IGNORE INTO users (email, name, role, created_at)
VALUES ('cesprey@gmail.com', 'Carl', 'admin', 1750000000000);
