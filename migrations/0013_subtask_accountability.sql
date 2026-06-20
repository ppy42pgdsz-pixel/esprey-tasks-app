-- Accountability hand-off on a subtask:
--   instructions     — owner writes for the assignee (member reads, can't edit)
--   notes            — member's own working notes (already added in 0009)
--   completion_note  — what the member writes when marking done; the owner reads
--                      it before accepting (signing off)
ALTER TABLE subtasks ADD COLUMN instructions TEXT NOT NULL DEFAULT '';
ALTER TABLE subtasks ADD COLUMN completion_note TEXT NOT NULL DEFAULT '';
