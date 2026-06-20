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
  onSubtaskProgress?: (taskId: string, total: number, done: number, pending?: number) => void;
}

export default function TaskDetail({ task, companies, contacts, me, users, onClose, onUpdate, onDelete, onSubtaskProgress }: Props) {
  const [generatingReply, setGeneratingReply] = useState(false);
  const [editingReply, setEditingReply] = useState(false);
  const [replyText, setReplyText] = useState(task.draft_reply ?? '');
  const [editingDesc, setEditingDesc] = useState(false);
  const [descText, setDescText] = useState(task.description);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [newSubtask, setNewSubtask] = useState('');
  const [assignOpenFor, setAssignOpenFor] = useState<string | null>(null);
  const [subAttachments, setSubAttachments] = useState<Record<string, TaskAttachment[]>>({});
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);

  const selectedContact = contacts.find((c) => c.id === task.contact_id) ?? null;
  const doneCount = subtasks.filter((s) => s.status === 'done').length;
  const meEmail = (me?.email ?? '').toLowerCase();
  const isOwner = meEmail === (task.owner_email ?? '').toLowerCase();

  useEffect(() => {
    api.listAttachments(task.id).then(setAttachments).catch(() => setAttachments([]));
    api.listSubtasks(task.id)
      .then((s) => {
        setSubtasks(s);
        onSubtaskProgress?.(task.id, s.length, s.filter((x) => x.status === 'done').length);
        Promise.all(
          s.map((st) => api.listSubtaskAttachments(st.id).then((a) => [st.id, a] as const).catch(() => [st.id, []] as const)),
        ).then((pairs) => setSubAttachments(Object.fromEntries(pairs)));
      })
      .catch(() => setSubtasks([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  const canEditSub = (s: Subtask) => isOwner || (s.assignee_emails ?? []).includes(meEmail);
  const uploadFile = async (s: Subtask, file: File) => {
    setUploadingFor(s.id);
    try {
      const att = await api.uploadSubtaskAttachment(s.id, file);
      setSubAttachments((prev) => ({ ...prev, [s.id]: [...(prev[s.id] ?? []), att] }));
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploadingFor(null);
    }
  };
  const removeAttachment = async (s: Subtask, attId: string) => {
    await api.deleteAttachment(attId);
    setSubAttachments((prev) => ({ ...prev, [s.id]: (prev[s.id] ?? []).filter((a) => a.id !== attId) }));
  };

  const commitSubtasks = (next: Subtask[]) => {
    setSubtasks(next);
    onSubtaskProgress?.(
      task.id,
      next.length,
      next.filter((s) => s.status === 'done').length,
      next.filter((s) => s.status === 'done' && !s.accepted_at).length,
    );
  };

  const cycleSubtaskStatus = async (s: Subtask) => {
    // A member can't change a subtask the owner has already signed off.
    if (!isOwner && s.accepted_at) return;
    const updated = await api.updateSubtask(s.id, { status: SUB_NEXT[s.status] });
    commitSubtasks(subtasks.map((x) => (x.id === updated.id ? updated : x)));
  };

  const acceptSubtask = async (s: Subtask) => {
    const updated = await api.updateSubtask(s.id, { accepted: true });
    commitSubtasks(subtasks.map((x) => (x.id === updated.id ? updated : x)));
  };
  const reinstateSubtask = async (s: Subtask) => {
    const updated = await api.updateSubtask(s.id, { accepted: false });
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
  const saveSubtaskDue = async (s: Subtask, ms: number | null) => {
    const updated = await api.updateSubtask(s.id, { due_date: ms });
    setSubtasks((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  };
  // Store and read dates as UTC midnight so the calendar day never shifts by
  // timezone (the date input is a plain calendar date, not a moment in time).
  const toDateInput = (ms?: number | null) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');
  const fromDateInput = (v: string) => (v ? Date.parse(`${v}T00:00:00Z`) : null);
  const fmtDue = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

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
    if (status === 'done') {
      const unfinished = subtasks.filter((s) => !(s.status === 'done' && s.accepted_at)).length;
      if (unfinished > 0 && !confirm(`${unfinished} subtask${unfinished > 1 ? 's are' : ' is'} not signed off yet. Mark the whole task complete anyway?`)) return;
    }
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
          disabled={!isOwner}
          onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}
        >
          <option value="todo">To Do</option>
          <option value="in_progress">In Progress</option>
          <option value="done">Done</option>
        </select>
        <select
          className="select-input"
          value={task.priority}
          disabled={!isOwner}
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
        {!isOwner ? (
          <div className="section-value">{task.company_name || <span className="muted">No company</span>}</div>
        ) : companies.length === 0 ? (
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
        {!isOwner ? (
          <>
            <div className="section-label">Contact</div>
            <div className="section-value">{task.contact_name || <span className="muted">—</span>}</div>
          </>
        ) : (
          <PeoplePicker
            contacts={contacts}
            selected={selectedContact}
            onSelect={handleContactSelect}
          />
        )}
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

      {/* Owner (shown to people who reach this task via a subtask assigned to them) */}
      {!isOwner && (
        <div className="detail-section">
          <div className="section-label">Owner</div>
          <p className="section-value">{task.owner_name || task.owner_email}</p>
        </div>
      )}

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
                  {isOwner ? (
                    <label className="subtask-due">
                      Due
                      <input
                        type="date"
                        value={toDateInput(s.due_date)}
                        onChange={(e) => saveSubtaskDue(s, fromDateInput(e.target.value))}
                      />
                    </label>
                  ) : s.due_date ? (
                    <span className="due-chip">Due {fmtDue(s.due_date)}</span>
                  ) : null}
                </div>
                {s.status === 'done' && (
                  <div className="subtask-signoff">
                    {s.accepted_at ? (
                      <>
                        <span className="signoff-accepted">✓ Accepted</span>
                        {isOwner && (
                          <button className="btn-mini" onClick={() => reinstateSubtask(s)}>Reopen</button>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="signoff-pending">Awaiting sign-off</span>
                        {isOwner && (
                          <>
                            <button className="btn-mini accept" onClick={() => acceptSubtask(s)}>Accept</button>
                            <button className="btn-mini" onClick={() => reinstateSubtask(s)}>Reinstate</button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}
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
                <div className="subtask-files">
                  {(subAttachments[s.id] ?? []).map((a) => (
                    <div key={a.id} className="subtask-file">
                      <div className="subtask-file-row">
                        <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" className="file-name">📎 {a.filename}</a>
                        {canEditSub(s) && (
                          <button className="subtask-del" onClick={() => removeAttachment(s, a.id)} title="Remove attachment" aria-label="Remove attachment">✕</button>
                        )}
                      </div>
                      {a.summary && <div className="file-summary">{a.summary}</div>}
                    </div>
                  ))}
                  {canEditSub(s) && (
                    <label className="attach-btn">
                      {uploadingFor === s.id ? 'Uploading…' : '+ Attach file'}
                      <input
                        type="file"
                        hidden
                        disabled={uploadingFor !== null}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(s, f); e.target.value = ''; }}
                      />
                    </label>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {isOwner && (
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
        )}
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
          {isOwner && (
            <button
              className="link-btn"
              onClick={() => {
                if (!editingDesc) setDescText(task.description);
                setEditingDesc(!editingDesc);
              }}
            >
              {editingDesc ? 'cancel' : 'edit'}
            </button>
          )}
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

      {isOwner && (
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
      )}

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
