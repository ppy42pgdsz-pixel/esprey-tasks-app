import { useState, useEffect } from 'react';
import type { Task, TaskStatus, Company, TaskAttachment, Subtask, User } from '../types';
import { api } from '../api';

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
  me: { email: string } | null;
  users: User[];
  onClose: () => void;
  onUpdate: (task: Task) => void;
  onDelete: (task: Task) => void;
  onSubtaskProgress?: (taskId: string, total: number, done: number, pending?: number) => void;
  focusSubtaskId?: string | null;
}

export default function TaskDetail({ task, companies, me, users, onClose, onUpdate, onDelete, onSubtaskProgress, focusSubtaskId }: Props) {
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [uploadingTask, setUploadingTask] = useState(false);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [newSubtask, setNewSubtask] = useState('');
  const [assignOpenFor, setAssignOpenFor] = useState<string | null>(null);
  const [subAttachments, setSubAttachments] = useState<Record<string, TaskAttachment[]>>({});
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);

  const doneCount = subtasks.filter((s) => s.status === 'done').length;
  const meEmail = (me?.email ?? '').toLowerCase();
  const isOwner = meEmail === (task.owner_email ?? '').toLowerCase();
  // Focused mode: show only one subtask's details (clicked from the list).
  const focusedSub = focusSubtaskId ? subtasks.find((s) => s.id === focusSubtaskId) : null;
  const visibleSubtasks = focusSubtaskId ? subtasks.filter((s) => s.id === focusSubtaskId) : subtasks;

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
    const reason = window.prompt('Sending this back — add a note for the assignee on what still needs doing (optional):', '');
    if (reason === null) return; // cancelled
    let payload: { accepted: false; instructions?: string } = { accepted: false };
    if (reason.trim()) {
      const stamp = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      const entry = `[REINSTATED ${stamp}] ${reason.trim()}`;
      payload = { accepted: false, instructions: s.instructions ? `${s.instructions}\n\n${entry}` : entry };
    }
    const updated = await api.updateSubtask(s.id, payload);
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

  const saveAssignees = async (s: Subtask, emails: string[], contactIds: string[]) => {
    await api.setSubtaskAssignees(s.id, { user_emails: emails, contact_ids: contactIds });
    setSubtasks((prev) => prev.map((x) => (x.id === s.id ? { ...x, assignee_emails: emails, contact_ids: contactIds } : x)));
  };
  const toggleAssignMember = (s: Subtask, email: string) => {
    const cur = s.assignee_emails ?? [];
    const next = cur.includes(email) ? cur.filter((e) => e !== email) : [...cur, email];
    void saveAssignees(s, next, s.contact_ids ?? []);
  };
  const saveSubtaskNotes = async (s: Subtask, notes: string) => {
    if ((s.notes ?? '') === notes) return;
    await api.updateSubtask(s.id, { notes });
    setSubtasks((prev) => prev.map((x) => (x.id === s.id ? { ...x, notes } : x)));
  };
  const saveSubtaskInstructions = async (s: Subtask, instructions: string) => {
    if ((s.instructions ?? '') === instructions) return;
    await api.updateSubtask(s.id, { instructions });
    setSubtasks((prev) => prev.map((x) => (x.id === s.id ? { ...x, instructions } : x)));
  };
  const saveSubtaskCompletion = async (s: Subtask, completion_note: string) => {
    if ((s.completion_note ?? '') === completion_note) return;
    await api.updateSubtask(s.id, { completion_note });
    setSubtasks((prev) => prev.map((x) => (x.id === s.id ? { ...x, completion_note } : x)));
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

  const saveDesc = async (value: string) => {
    if (value === task.description) return;
    const updated = await api.updateTask(task.id, { description: value });
    onUpdate(updated);
  };
  const uploadTaskFile = async (file: File) => {
    setUploadingTask(true);
    try {
      const att = await api.uploadTaskAttachment(task.id, file);
      setAttachments((prev) => [...prev, att]);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploadingTask(false);
    }
  };
  const removeTaskAttachment = async (attId: string) => {
    await api.deleteAttachment(attId);
    setAttachments((prev) => prev.filter((a) => a.id !== attId));
  };

  const handleStatusChange = async (status: TaskStatus) => {
    if (status === 'done') {
      const unfinished = subtasks.filter((s) => !(s.status === 'done' && s.accepted_at)).length;
      if (unfinished > 0 && !confirm(`${unfinished} subtask${unfinished > 1 ? 's are' : ' is'} not signed off yet. Mark the whole task complete anyway?`)) return;
    }
    const updated = await api.updateTask(task.id, { status });
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

  return (
    <aside className="task-detail">
      <div className="detail-header">
        {focusSubtaskId ? (
          <div className="detail-title-stack">
            <div className="detail-parent-name">{task.title}</div>
            <h2 className="detail-title focus-sub">{focusedSub?.text ?? 'Subtask'}</h2>
          </div>
        ) : (
          <h2 className="detail-title">{task.title}</h2>
        )}
        <button className="close-btn" onClick={onClose}>×</button>
      </div>

      {!focusSubtaskId && (
      <>
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
      </>
      )}

      {/* Subtasks (filtered to one in focused mode) */}
      <div className="detail-section">
        <div className="section-label">
          {focusSubtaskId ? 'Subtask' : `Subtasks${subtasks.length > 0 ? ` · ${doneCount}/${subtasks.length}` : ''}`}
        </div>
        {visibleSubtasks.length > 0 && (
          <ul className="subtask-list">
            {visibleSubtasks.map((s) => (
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
                  {(s.assignee_emails ?? []).length === 0 && (
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
                  </div>
                )}
                {/* Instructions — owner writes, member reads */}
                {isOwner ? (
                  <label className="subtask-field">
                    <span className="subtask-field-label">Instructions</span>
                    <textarea
                      key={`instr-${s.id}:${s.instructions ?? ''}`}
                      className="subtask-notes"
                      rows={2}
                      placeholder="Instructions for the assignee…"
                      defaultValue={s.instructions ?? ''}
                      onBlur={(e) => saveSubtaskInstructions(s, e.target.value)}
                    />
                  </label>
                ) : s.instructions ? (
                  <div className="subtask-field">
                    <span className="subtask-field-label">Instructions</span>
                    <div className="subtask-readonly">{s.instructions}</div>
                  </div>
                ) : null}

                {/* Notes — the member's own working notes (owner can read) */}
                {(s.assignee_emails ?? []).includes(meEmail) ? (
                  <label className="subtask-field">
                    <span className="subtask-field-label">Notes</span>
                    <textarea
                      className="subtask-notes"
                      rows={2}
                      placeholder="Your notes…"
                      defaultValue={s.notes ?? ''}
                      onBlur={(e) => saveSubtaskNotes(s, e.target.value)}
                    />
                  </label>
                ) : s.notes ? (
                  <div className="subtask-field">
                    <span className="subtask-field-label">Member notes</span>
                    <div className="subtask-readonly">{s.notes}</div>
                  </div>
                ) : null}

                {/* Completion note — member writes when marking done; owner reads at sign-off */}
                {(s.assignee_emails ?? []).includes(meEmail) ? (
                  <label className="subtask-field">
                    <span className="subtask-field-label">Completion note <span className="muted">· sent to the owner when you mark this done</span></span>
                    <textarea
                      className="subtask-notes"
                      rows={2}
                      placeholder="What you did / anything to hand back…"
                      defaultValue={s.completion_note ?? ''}
                      onBlur={(e) => saveSubtaskCompletion(s, e.target.value)}
                    />
                  </label>
                ) : s.completion_note ? (
                  <div className="subtask-field">
                    <span className="subtask-field-label">Completion note</span>
                    <div className="subtask-readonly">{s.completion_note}</div>
                  </div>
                ) : null}

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
        {isOwner && !focusSubtaskId && (
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

      {/* Shared task files shown read-only in focused subtask mode */}
      {focusSubtaskId && attachments.length > 0 && (
        <div className="detail-section">
          <div className="section-label">Shared files <span className="muted">(from the main task)</span></div>
          <div className="subtask-files">
            {attachments.map((a) => (
              <div key={a.id} className="subtask-file">
                <div className="subtask-file-row">
                  <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" className="file-name">📎 {a.filename}</a>
                </div>
                {a.summary && <div className="file-summary">{a.summary}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {!focusSubtaskId && (
        <>
          {/* Task files — shared across all subtasks */}
          <div className="detail-section">
            <div className="section-label">Files <span className="muted">· shared across subtasks</span></div>
            <div className="subtask-files">
              {attachments.map((a) => (
                <div key={a.id} className="subtask-file">
                  <div className="subtask-file-row">
                    <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" className="file-name">📎 {a.filename}</a>
                    {isOwner && (
                      <button className="subtask-del" onClick={() => removeTaskAttachment(a.id)} title="Remove file" aria-label="Remove file">✕</button>
                    )}
                  </div>
                  {a.summary && <div className="file-summary">{a.summary}</div>}
                </div>
              ))}
              <label className="attach-btn">
                {uploadingTask ? 'Uploading…' : '+ Attach file'}
                <input
                  type="file"
                  hidden
                  disabled={uploadingTask}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadTaskFile(f); e.target.value = ''; }}
                />
              </label>
            </div>
          </div>

          {/* Notes — always-visible text box */}
          <div className="detail-section">
            <div className="section-label">Notes</div>
            {isOwner ? (
              <textarea
                className="textarea"
                rows={4}
                placeholder="Add notes…"
                defaultValue={task.description}
                onBlur={(e) => saveDesc(e.target.value)}
              />
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
            <div className="detail-footer">
              <button className="btn-danger" onClick={() => { if (confirm('Delete this task?')) onDelete(task); }}>
                Delete task
              </button>
            </div>
          )}
        </>
      )}
    </aside>
  );
}
