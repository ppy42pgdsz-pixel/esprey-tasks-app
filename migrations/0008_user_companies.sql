-- Which companies each member is allowed to use. Admin sees all; "Personal"
-- is always available to everyone regardless of allocation.
CREATE TABLE IF NOT EXISTS user_companies (
  user_email TEXT NOT NULL,
  company_id TEXT NOT NULL,
  PRIMARY KEY (user_email, company_id)
);

CREATE INDEX IF NOT EXISTS idx_user_companies_user ON user_companies(user_email);
