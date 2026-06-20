-- Subtask-level uploads: an attachment can belong to a specific subtask, and
-- carries a short AI-generated summary. (Email attachments keep subtask_id NULL.)
ALTER TABLE task_attachments ADD COLUMN subtask_id TEXT;
ALTER TABLE task_attachments ADD COLUMN summary TEXT;
