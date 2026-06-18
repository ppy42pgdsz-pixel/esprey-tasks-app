import { useState, useEffect } from 'react';
import type { Task, TaskStatus, TaskPriority, Company, Contact, TaskAttachment, Subtask, User } from '../types';
import { api } from '../api';
import PeoplePicker from './PeoplePicker';

/**
 * Split pasted text into individual subtask strings. Handles newline-separated
 * lists, inline numbered lists ("1) … 2) …" or "1. … 2. …"), and bullets.
 */
function splitIntoItems(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];
  const withBreaks = text
    .replace(/(?:^|\s)\d+[.)]\s+/g, '\n') // numbered markers (inline or line-start)
    .replace(/(?:^|\s)[•·]\s+/g, '\n'); // bullet markers
  return withBreaks
    .split(/\n+/)
    .map((s) => s.replace(/^[-*•·\s]+/, '').trim()) // strip leading dash/bullet
    .filter((s) => s.length > 0);
}

const SUB_NEXT: Record<TaskStatus, TaskStatus> = { todo: 'in_progress', in_progress: 'done', done: 'todo' };
const SUB_LABEL: Record<TaskStatus, string> = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' };

interface Props {
  task: Task;
  companies: Company[];
  contacts: Contact[];
  me: { email: string } | null;
  users: User[];
  onClose: () => void;
  onUpdate: (task: Task) => void;
  onDelete: (task: Task) => void;
  onSubtaskProgress?: (taskId: string, total: number, done: number) => void;
  onShareChange?: (taskId: string, visibility: 'private' | 'shared') => void;
}

export default function TaskDetail({ task, companies, contacts, me, users, onClose, onUpdate, onDelete, onSubtaskProgress, onShareChange }: Props) {
  const [generatingReply, setGeneratingReply] = useState(false);
  const [editingReply, setEditingReply] = useState(false);
  const [replyText, setReplyText] = useState(task.draft_reply ?? '');
  const [editingDesc, setEditingDesc] = useState(false);
  const [descText, setDescText] = useState(task.description);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [newSubtask, setNewSubtask] = useState('');
  const [assignOpenFor, setAssignOpenFor] = useState<string | null>(null);
  const [shareVisibility, setShareVisibility] = useState<'private' | 'shared'>(task.visibility ?? 'private');
  const [shareEmails, setShareEmails] = useState<string[]>([]);
  const [savingShare, setSavingShare] = useState(false);

  const selectedContact = contacts.find((c) => c.id === task.contact_id) ?? null;
  const doneCount = subtasks.filter((s) => s.status === 'done').length;
  const meEmail = (me?.email ?? '').toLowerCase();
  const isOwner = meEmail === (task.owner_email ?? '').toLowerCase();
  const shareableUsers = users.filter((u) => u.email.toLowerCase() !== meEmail);

  useEffect(() => {
    api.listAttachments(task.id).then(setAttachments).catch(() => setAttachments([]));
    api.listSubtasks(task.id)
      .then((s) => { setSubtasks(s); onSubtaskProgress?.(task.id, s.length, s.filter((x) => x.status === 'done').length); })
      .catch(() => setSubtasks([]));
    api.getShare(task.id)
      .then((s) => { setShareVisibility(s.visibility); setShareEmails(s.user_emails); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  const saveShare = async (visibility: 'private' | 'shared', emails: string[]) => {
    setSavingShare(true);
    try {
      const res = await api.setShare(task.id, { visibility, user_emails: emails });
      setShareVisibility(res.visibility);
      setShareEmails(res.user_emails);
      onShareChange?.(task.id, res.visibility);
    } finally {
      setSavingShare(false);
    }
  };

  const commitSubtasks = (next: Subtask[]) => {
    setSubtasks(next);
    onSubtaskProgress?.(task.id, next.length, next.filter((s) => s.status === 'done').length);
  };

  const cycleSubtaskStatus = async (s: Subtask) => {
    const updated = await api.updateSubtask(s.id, { status: SUB_NEXT[s.status] });
    commitSubtasks(subtasks.map((x) => (x.id === updated.id ? updated : x)));
  };

  const addSubtask = async () => {
    const items = splitIntoItems(newSubtask);
    if (items.length === 0) return;
    const created: Subtask[] = [];
    for (const text of items) {
      created.push(await api.createSubtask(task.id, text)); // sequential keeps order/position
    }
    setNewSubtask('');
    commitSubtasks([...subtasks, ...created]);
  };

  const deleteSubtask = async (id: string) => {
    await api.deleteSubtask(id);
    commitSubtasks(subtasks.filter((x) => x.id !== id));
  };

  const userName = (email: string) =>
    users.find((u) => u.email.toLowerCase() === email.toLowerCase())?.name ?? email;
  const contactName = (id: string) => contacts.find((c) => c.id === id)?.name ?? 'Contact';

  const saveAssignees = async (s: Subtask, emails: string[], contactIds: string[]) => {
    await api.setSubtaskAssignees(s.id, { user_emails: emails, contact_ids: contactIds });
    setSubtasks((prev) => prev.map((x) => (x.id === s.id ? { ...x, assignee_emails: emails, contact_ids: contactIds } : x)));
  };
  const toggleAssignMember = (s: Subtask, email: string) => {
    const cur = s.assignee_emails ?? [];
    const next = cur.includes(email) ? cur.filter((e) => e !== email) : [...cur, email];
    void saveAssignees(s, next, s.contact_ids ?? []);
  };
  const toggleAssignContact = (s: Subtask, id: string) => {
    const cur = s.contact_ids ?? [];
    const next = cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id];
    void saveAssignees(s, s.assignee_emails ?? [], next);
  };
  const saveSubtaskNotes = async (s: Subtask, notes: string) => {
    if ((s.notes ?? '') === notes) return;
    await api.updateSubtask(s.id, { notes });
    setSubtasks((prev) => prev.map((x) => (x.id === s.id ? { ...x, notes } : x)));
  };

  const handleGenerateReply = async () => {
    setGeneratingReply(true);
    try {
      const { draft_reply } = await api.generateDraftReply(task.id);
      setReplyText(draft_reply);
      onUpdate({ ...task, draft_reply });
    } finally {
      setGeneratingReply(false);
    }
  };

  const handleSaveReply = async () => {
    const updated = await api.updateTask(task.id, { draft_reply: replyText });
    onUpdate(updated);
    setEditingReply(false);
  };

  const handleSaveDesc = async () => {
    const updated = await api.updateTask(task.id, { description: descText });
    onUpdate(updated);
    setEditingDesc(false);
  };

  const handleStatusChange = async (status: TaskStatus) => {
    const updated = await api.updateTask(task.id, { status });
    onUpdate(updated);
  };

  const handlePriorityChange = async (priority: TaskPriority) => {
    const updated = await api.updateTask(task.id, { priority });
    onUpdate(updated);
  };

  const handleCompanyChange = async (companyId: string) => {
    const company = companies.find((c) => c.id === companyId);
    const updated = await api.updateTask(task.id, {
      company_id: companyId || null,
      company_name: company?.name ?? null,
    } as Parameters<typeof api.updateTask>[1]);
    onUpdate(updated);
  };

  const handleContactSelect = async (contact: Contact | null) => {
    const updated = await api.updateTask(task.id, {
      contact_id: contact?.id ?? null,
      contact_name: contact?.name ?? null,
    } as Parameters<typeof api.updateTask>[1]);
    onUpdate(updated);
  };

  const copyToClipboard = (text: string) => navigator.clipboard.writeText(text);

  return (
    <aside className="task-detail">
      <div className="detail-header">
        <h2 className="detail-title">{task.title}</h2>
        <button className="close-btn" onClick={onClose}>×</button>
      </div>

      <div className="detail-controls">
        <select
          className="select-input"
          value={task.status}
          onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}
        >
          <option value="todo">To Do</option>
          <option value="in_progress">In Progress</option>
          <option value="done">Done</option>
        </select>
        <select
          className="select-input"
          value={task.priority}
          onChange={(e) => handlePriorityChange(e.target.value as TaskPriority)}
        >
          <option value="low">Low priority</option>
          <option value="normal">Normal priority</option>
          <option value="high">High priority</option>
        </select>
      </div>

      {/* Company */}
      <div className="detail-section">
        <div className="section-label">Company</div>
        {companies.length === 0 ? (
          <p className="muted">No companies yet. Add them in Settings.</p>
        ) : (
          <select
            className="select-input"
            value={task.company_id ?? ''}
            onChange={(e) => handleCompanyChange(e.target.value)}
          >
            <option value="">No company</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Contact */}
      <div className="detail-section">
        <PeoplePicker
          contacts={contacts}
          selected={selectedContact}
          onSelect={handleContactSelect}
        />
      </div>

      {task.source === 'email' && task.from_email && (
        <div className="detail-section">
          <div className="section-label">From</div>
          <div className="section-value muted">
            {task.from_name ? `${task.from_name} <${task.from_email}>` : task.from_email}
          </div>
          {task.original_subject && (
            <>
              <div className="section-label mt">Subject</div>
              <div className="section-value muted">{task.original_subject}</div>
            </>
          )}
        </div>
      )}

      {/* Sharing */}
      <div className="detail-section">
        <div className="section-label">Sharing</div>
        {isOwner ? (
          <>
            <select
              className="select-input"
              value={shareVisibility}
              disabled={savingShare}
              onChange={(e) => {
                const v = e.target.value as 'private' | 'shared';
                saveShare(v, v === 'shared' ? shareEmails : []);
              }}
            >
              <option value="private">Private — only me</option>
              <option value="shared">Shared</option>
            </select>
            {shareVisibility === 'shared' && (
              <div className="share-people mt">
                {shareableUsers.length === 0 ? (
                  <p className="muted">No teammates yet — add them in Settings → Team.</p>
                ) : (
                  shareableUsers.map((u) => {
                    const checked = shareEmails.includes(u.email.toLowerCase());
                    return (
                      <label key={u.email} className="checkbox-label share-person">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={savingShare}
                          onChange={() => {
                            const em = u.email.toLowerCase();
                            const next = checked ? shareEmails.filter((x) => x !== em) : [...shareEmails, em];
                            setShareEmails(next);
                            saveShare('shared', next);
                          }}
                        />
                        {u.name} <span className="muted">{u.email}</span>
                      </label>
                    );
                  })
                )}
              </div>
            )}
          </>
        ) : (
          <p className="section-value">Owned by {task.owner_name || task.owner_email}{shareVisibility === 'shared' ? ' · shared with you' : ''}.</p>
        )}
      </div>

      {/* Subtasks */}
      <div className="detail-section">
        <div className="section-label">
          Subtasks{subtasks.length > 0 ? ` · ${doneCount}/${subtasks.length}` : ''}
        </div>
        {subtasks.length > 0 && (
          <ul className="subtask-list">
            {subtasks.map((s) => (
              <li key={s.id} className={`subtask-item ${s.status === 'done' ? 'done' : ''}`}>
                <div className="subtask-titlerow">
                  <span
                    className={`status-pill ${s.status}`}
                    title={`Mark as ${SUB_LABEL[SUB_NEXT[s.status]]}`}
                    onClick={() => cycleSubtaskStatus(s)}
                  >
                    {SUB_LABEL[s.status]}
                  </span>
                  <span className="subtask-text">{s.text}</span>
                  {isOwner && (
                    <button className="subtask-del" onClick={() => deleteSubtask(s.id)} title="Delete subtask" aria-label="Delete subtask">✕</button>
                  )}
                </div>
                <div className="subtask-meta">
                  {(s.assignee_emails ?? []).map((em) => (
                    <span key={em} className="assignee-chip">{userName(em)}</span>
                  ))}
                  {(s.contact_ids ?? []).map((cid) => (
                    <span key={cid} className="assignee-chip contact">{contactName(cid)}</span>
                  ))}
                  {(s.assignee_emails ?? []).length === 0 && (s.contact_ids ?? []).length === 0 && (
                    <span className="assignee-none">Unassigned</span>
                  )}
                  {isOwner && (
                    <button className="link-btn" onClick={() => setAssignOpenFor(assignOpenFor === s.id ? null : s.id)}>
                      {assignOpenFor === s.id ? 'Done' : 'Assign'}
                    </button>
                  )}
                </div>
                {isOwner && assignOpenFor === s.id && (
                  <div className="assign-picker">
                    <div className="assign-group">
                      <div className="assign-label">Team</div>
                      {users.length === 0 && <span className="assignee-none">No members</span>}
                      {users.map((u) => (
                        <label key={u.email} className="assign-check">
                          <input
                            type="checkbox"
                            checked={(s.assignee_emails ?? []).includes(u.email.toLowerCase())}
                            onChange={() => toggleAssignMember(s, u.email.toLowerCase())}
                          />
                          {u.name}
                        </label>
                      ))}
                    </div>
                    <div className="assign-group">
                      <div className="assign-label">Contacts</div>
                      {contacts.length === 0 && <span className="assignee-none">No contacts</span>}
                      {contacts.map((c) => (
                        <label key={c.id} className="assign-check">
                          <input
                            type="checkbox"
                            checked={(s.contact_ids ?? []).includes(c.id)}
                            onChange={() => toggleAssignContact(s, c.id)}
                          />
                          {c.name}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <textarea
                  className="subtask-notes"
                  rows={2}
                  placeholder="Shared notes for this subtask…"
                  defaultValue={s.notes ?? ''}
                  onBlur={(e) => saveSubtaskNotes(s, e.target.value)}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="subtask-add mt">
          <textarea
            className="textarea"
            rows={3}
            placeholder="Add a subtask — or paste a list (new lines, or 1) 2) 3) split into separate subtasks)"
            value={newSubtask}
            onChange={(e) => setNewSubtask(e.target.value)}
          />
          <button className="btn-primary sm" onClick={addSubtask} disabled={!newSubtask.trim()}>
            Add
          </button>
        </div>
      </div>

      {attachments.length > 0 && (
        <div className="detail-section">
          <div className="section-label">Attachments</div>
          <div className="attachment-list">
            {attachments.map((a) => {
              const url = `/api/attachments/${a.id}`;
              const mime = a.mime_type ?? '';
              const isImage = mime.startsWith('image/');
              const badge = mime === 'application/pdf' ? 'PDF' : mime === 'message/rfc822' ? 'EML' : 'FILE';
              return (
                <a key={a.id} className="attachment-item" href={url} target="_blank" rel="noopener noreferrer">
                  {isImage ? (
                    <img className="attachment-thumb" src={url} alt={a.filename ?? 'attachment'} />
                  ) : (
                    <span className="attachment-icon">{badge}</span>
                  )}
                  <span className="attachment-name">{a.filename ?? 'attachment'}</span>
                </a>
              );
            })}
          </div>
        </div>
      )}

      <div className="detail-section">
        <div className="section-label-row">
          <span className="section-label">Notes</span>
          <button
            className="link-btn"
            onClick={() => {
              if (!editingDesc) setDescText(task.description);
              setEditingDesc(!editingDesc);
            }}
          >
            {editingDesc ? 'cancel' : 'edit'}
          </button>
        </div>
        {editingDesc ? (
          <div>
            <textarea
              className="textarea"
              value={descText}
              onChange={(e) => setDescText(e.target.value)}
              rows={4}
            />
            <button className="btn-primary sm" onClick={handleSaveDesc}>Save</button>
          </div>
        ) : (
          <div className="section-value" style={{ whiteSpace: 'pre-wrap' }}>
            {task.description || <span className="muted">No notes</span>}
          </div>
        )}
      </div>

      {task.source === 'email' && task.original_body && (
        <div className="detail-section">
          <div className="section-label">Original email</div>
          <div className="original-body">{task.original_body}</div>
        </div>
      )}

      <div className="detail-section">
        <div className="section-label-row">
          <span className="section-label">Draft reply</span>
          <div className="section-actions">
            {replyText && (
              <>
                <button className="link-btn" onClick={() => copyToClipboard(replyText)}>copy</button>
                <button className="link-btn" onClick={() => setEditingReply(!editingReply)}>
                  {editingReply ? 'cancel' : 'edit'}
                </button>
              </>
            )}
            <button className="link-btn" onClick={handleGenerateReply} disabled={generatingReply}>
              {generatingReply ? 'generating…' : replyText ? 'regenerate' : 'generate'}
            </button>
          </div>
        </div>

        {editingReply ? (
          <div>
            <textarea className="textarea" value={replyText} onChange={(e) => setReplyText(e.target.value)} rows={8} />
            <button className="btn-primary sm" onClick={handleSaveReply}>Save</button>
          </div>
        ) : replyText ? (
          <div className="draft-reply">{replyText}</div>
        ) : (
          <div className="muted section-value">
            {task.source === 'email' ? 'Click generate to draft a reply with Claude.' : 'Add email context to generate a reply.'}
          </div>
        )}
      </div>

      {isOwner && (
        <div className="detail-footer">
          <button className="btn-danger" onClick={() => { if (confirm('Delete this task?')) onDelete(task); }}>
            Delete task
          </button>
        </div>
      )}
    </aside>
  );
}
