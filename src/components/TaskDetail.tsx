import { useState, useEffect } from 'react';
import type { Task, TaskStatus, Company, TaskAttachment, TaskEvent, Subtask, User } from '../types';
import { api } from '../api';
import { downloadFile } from '../download';
import SubtaskComments from './SubtaskComments';
import LibraryPicker from './LibraryPicker';

const EVENT_ICON: Record<string, string> = {
  created: '✨', completed: '✅', reopened: '↩️', subtask_added: '➕',
  subtask_done: '☑️', accepted: '✔️', reinstated: '↩️', assigned: '👤',
};
function fmtEventTime(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

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
  const [recurInterval, setRecurInterval] = useState(task.recur_interval ?? 1);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [showActivity, setShowActivity] = useState(false);
  const [membersSeeAll, setMembersSeeAll] = useState(false);
  const [watchers, setWatchers] = useState<string[]>([]);

  const doneCount = subtasks.filter((s) => s.status === 'done').length;
  const meEmail = (me?.email ?? '').toLowerCase();
  const isOwner = meEmail === (task.owner_email ?? '').toLowerCase();
  // Focused mode: show only one subtask's details (clicked from the list).
  const focusedSub = focusSubtaskId ? subtasks.find((s) => s.id === focusSubtaskId) : null;
  const visibleSubtasks = focusSubtaskId ? subtasks.filter((s) => s.id === focusSubtaskId) : subtasks;

  // Deep link that opens a NEW, pre-filled event in the user's own Outlook,
  // so they stay the organiser and can toggle on a Teams meeting before sending.
  const outlookComposeUrl = () => {
    const due = task.due_date ?? null;
    const d = due ? new Date(due) : new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const y = due ? d.getUTCFullYear() : d.getFullYear();
    const m = (due ? d.getUTCMonth() : d.getMonth()) + 1;
    const day = due ? d.getUTCDate() : d.getDate();
    const date = `${y}-${pad(m)}-${pad(day)}`;
    const p = new URLSearchParams({
      subject: task.title,
      startdt: `${date}T09:00:00`,
      enddt: `${date}T09:30:00`,
      body: task.description || '',
    });
    return `https://outlook.office.com/calendar/0/deeplink/compose?${p.toString()}`;
  };

  // Download a calendar file that opens in the user's DEFAULT desktop calendar
  // app (e.g. Outlook desktop). They save it to their own calendar and can then
  // add a Teams meeting + attendees.
  const downloadInvite = () => {
    const due = task.due_date ?? null;
    const d = due ? new Date(due) : new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const y = due ? d.getUTCFullYear() : d.getFullYear();
    const mo = (due ? d.getUTCMonth() : d.getMonth()) + 1;
    const da = due ? d.getUTCDate() : d.getDate();
    const ymd = `${y}${pad(mo)}${pad(da)}`;
    const dtstamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const esc = (t: string) => t.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Esprey Tasks//EN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      `UID:${task.id}-${Date.now()}@esprey.net`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${ymd}T090000`,
      `DTEND:${ymd}T093000`,
      `SUMMARY:${esc(task.title)}`,
      task.description ? `DESCRIPTION:${esc(task.description)}` : '',
      'END:VEVENT', 'END:VCALENDAR',
    ].filter(Boolean).join('\r\n');
    const blob = new Blob([ics], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${task.title.replace(/[^\w]+/g, '_').slice(0, 40) || 'event'}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  useEffect(() => {
    api.listAttachments(task.id).then(setAttachments).catch(() => setAttachments([]));
    if (isOwner) {
      api.listEvents(task.id).then(setEvents).catch(() => setEvents([]));
      api.getShare(task.id).then((s) => { setMembersSeeAll(s.members_see_all); setWatchers(s.user_emails); }).catch(() => {});
    }
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
  const removeAttachment = async (s: Subtask, attId: string, name?: string | null) => {
    if (!confirm(`Remove this file?${name ? `\n\n${name}` : ''}`)) return;
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
    const s = subtasks.find((x) => x.id === id);
    if (!confirm(`Delete this task?${s ? `\n\n"${s.text}"` : ''}\n\nThis can't be undone.`)) return;
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
  const removeTaskAttachment = async (attId: string, name?: string | null) => {
    if (!confirm(`Remove this file?${name ? `\n\n${name}` : ''}`)) return;
    await api.deleteAttachment(attId);
    setAttachments((prev) => prev.filter((a) => a.id !== attId));
  };

  const handleStatusChange = async (status: TaskStatus) => {
    if (status === 'done') {
      const unfinished = subtasks.filter((s) => !(s.status === 'done' && s.accepted_at)).length;
      if (unfinished > 0 && !confirm(`${unfinished} task${unfinished > 1 ? 's are' : ' is'} not signed off yet. Mark the whole project complete anyway?`)) return;
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

  // ─── Project visibility (members-see-all + watchers) ───
  const saveShare = async (msa: boolean, w: string[]) => {
    try { await api.setShare(task.id, { members_see_all: msa, user_emails: w }); }
    catch (e) { alert(e instanceof Error ? e.message : 'Could not save'); }
  };
  const toggleSeeAll = () => { const v = !membersSeeAll; setMembersSeeAll(v); void saveShare(v, watchers); };
  const toggleWatcher = (email: string) => {
    const next = watchers.includes(email) ? watchers.filter((e) => e !== email) : [...watchers, email];
    setWatchers(next);
    void saveShare(membersSeeAll, next);
  };

  // ─── Recurrence ───
  const todayUtcMidnight = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
  const addInterval = (ms: number, unit: 'day' | 'week' | 'month', n: number) => {
    const d = new Date(ms); const y = d.getUTCFullYear(), mo = d.getUTCMonth(), da = d.getUTCDate();
    if (unit === 'week') return Date.UTC(y, mo, da + 7 * n);
    if (unit === 'month') return Date.UTC(y, mo + n, da);
    return Date.UTC(y, mo, da + n);
  };
  const saveRecurrence = async (data: Parameters<typeof api.updateTask>[1]) => {
    const updated = await api.updateTask(task.id, data);
    onUpdate(updated);
  };
  const changeRecurUnit = (unit: '' | 'day' | 'week' | 'month') => {
    if (!unit) { void saveRecurrence({ recur_unit: null, recur_interval: null, recur_next_at: null }); return; }
    const n = Math.max(1, recurInterval);
    const next = task.recur_next_at ?? addInterval(todayUtcMidnight(), unit, n);
    void saveRecurrence({ recur_unit: unit, recur_interval: n, recur_next_at: next, recur_active: 1 });
  };
  const changeRecurInterval = (n: number) => {
    const v = Math.max(1, n); setRecurInterval(v);
    if (task.recur_unit) void saveRecurrence({ recur_interval: v });
  };

  return (
    <aside className="task-detail">
      <button className="close-btn sheet-close" onClick={onClose}>×</button>
      <div className={`detail-cols${focusSubtaskId ? ' focus-task' : ''}`}>
      {/* ─── Left: project-level details ─── */}
      <div className="detail-left">
      <div className="detail-project-label">Project</div>
      <h2 className="detail-title">{task.title}</h2>

      <div className="detail-controls">
        <select
          className="select-input"
          value={task.status === 'done' ? 'done' : 'active'}
          disabled={!isOwner}
          onChange={(e) => handleStatusChange(e.target.value === 'done' ? 'done' : 'in_progress')}
        >
          <option value="active">Active</option>
          <option value="done">Done</option>
        </select>
        <button className="btn-secondary sm" onClick={downloadInvite} title="Downloads a calendar file that opens in your desktop calendar app; add a Teams meeting there">
          📅 Add to my Outlook
        </button>
        <a className="link-btn" href={outlookComposeUrl()} target="_blank" rel="noreferrer" title="Open in web Outlook instead">web</a>
      </div>

      {/* Company */}
      <div className="detail-section dt-advanced">
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

      {/* Repeat (owner only) */}
      {isOwner && (
        <div className="detail-section dt-advanced">
          <div className="section-label">Repeat</div>
          <div className="repeat-controls">
            <select
              className="select-input"
              value={task.recur_unit ?? ''}
              onChange={(e) => changeRecurUnit(e.target.value as '' | 'day' | 'week' | 'month')}
            >
              <option value="">Doesn't repeat</option>
              <option value="day">Daily</option>
              <option value="week">Weekly</option>
              <option value="month">Monthly</option>
            </select>
            {task.recur_unit && (
              <label className="repeat-every">
                every
                <input
                  type="number"
                  min={1}
                  className="text-input repeat-n"
                  value={recurInterval}
                  onChange={(e) => changeRecurInterval(Number(e.target.value) || 1)}
                />
                {task.recur_unit === 'day' ? 'day(s)' : task.recur_unit === 'week' ? 'week(s)' : 'month(s)'}
              </label>
            )}
          </div>
          {task.recur_unit && (
            <label className="repeat-next">
              Next occurrence
              <input
                type="date"
                value={toDateInput(task.recur_next_at)}
                onChange={(e) => { const ms = fromDateInput(e.target.value); if (ms) void saveRecurrence({ recur_next_at: ms }); }}
              />
            </label>
          )}
          {task.recur_unit && (
            <p className="repeat-hint muted">A fresh copy is created on each occurrence and this repeat moves to it. Deleting this project stops the series.</p>
          )}
        </div>
      )}

      {/* Who can see this project (owner only) */}
      {isOwner && (
        <div className="detail-section dt-advanced">
          <div className="section-label">Who can see this project</div>
          <label className="seeall-toggle">
            <input type="checkbox" checked={membersSeeAll} onChange={toggleSeeAll} />
            <span>Everyone with a task here can see all tasks</span>
          </label>
          <div className="watchers">
            <div className="watchers-label">Watchers <span className="muted">· can see &amp; comment on everything, even with no task</span></div>
            {users.filter((u) => u.email.toLowerCase() !== meEmail).length === 0 ? (
              <span className="assignee-none">No team members yet</span>
            ) : (
              users.filter((u) => u.email.toLowerCase() !== meEmail).map((u) => (
                <label key={u.email} className="assign-check">
                  <input
                    type="checkbox"
                    checked={watchers.includes(u.email.toLowerCase())}
                    onChange={() => toggleWatcher(u.email.toLowerCase())}
                  />
                  {u.name}
                </label>
              ))
            )}
          </div>
        </div>
      )}

      {task.source === 'email' && task.from_email && (
        <div className="detail-section dt-advanced">
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

      {/* Files — shared across all tasks */}
      <div className="detail-section">
        <div className="section-label">Files <span className="muted">· shared across tasks</span></div>
        <div className="subtask-files">
          {attachments.map((a) => (
            <div key={a.id} className="subtask-file">
              <div className="subtask-file-row">
                <button type="button" className="file-name file-link" onClick={() => downloadFile(`/api/attachments/${a.id}?download=1`)}>📎 {a.filename}</button>
                {isOwner && (
                  <button className="file-del" onClick={() => removeTaskAttachment(a.id, a.filename)} title="Remove file">Remove</button>
                )}
              </div>
              {a.summary && <div className="file-summary">{a.summary}</div>}
            </div>
          ))}
          {isOwner ? (
            <>
              <label className="attach-btn">
                {uploadingTask ? 'Uploading…' : '+ Attach file'}
                <input
                  type="file"
                  hidden
                  disabled={uploadingTask}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadTaskFile(f); e.target.value = ''; }}
                />
              </label>
              <LibraryPicker target={{ task_id: task.id }} onAttached={(att) => setAttachments((prev) => [...prev, att])} />
            </>
          ) : attachments.length === 0 ? (
            <span className="muted">No files</span>
          ) : null}
        </div>
      </div>

      {/* Notes */}
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
        <div className="detail-section dt-advanced">
          <div className="section-label">Original email</div>
          <div className="original-body">{task.original_body}</div>
        </div>
      )}

      {/* Activity timeline — owner only */}
      {isOwner && events.length > 0 && (
        <div className="detail-section activity-section">
          <button
            className="activity-toggle link-btn"
            onClick={() => {
              const next = !showActivity;
              setShowActivity(next);
              if (next) api.listEvents(task.id).then(setEvents).catch(() => {});
            }}
          >
            {showActivity ? '▾' : '▸'} Activity ({events.length})
          </button>
          {showActivity && (
            <ul className="activity-list">
              {events.map((e) => (
                <li key={e.id} className="activity-item">
                  <span className="activity-icon">{EVENT_ICON[e.type] ?? '•'}</span>
                  <div className="activity-body">
                    <div className="activity-detail">{e.detail}</div>
                    <div className="activity-meta">
                      {e.actor_name || (e.actor_email ? e.actor_email.split('@')[0] : 'System')} · {fmtEventTime(e.created_at)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {isOwner && (
        <div className="detail-footer">
          <button className="btn-danger" onClick={() => { if (confirm('Delete this project?')) onDelete(task); }}>
            Delete project
          </button>
        </div>
      )}

      </div>{/* end detail-left */}

      {/* ─── Right: tasks ─── */}
      <div className="detail-right">

      {/* Tasks (filtered to one in focused mode) */}
      <div className="detail-section">
        <div className="section-label">
          {focusSubtaskId ? (focusedSub?.text ?? 'Task') : `Tasks${subtasks.length > 0 ? ` · ${doneCount}/${subtasks.length}` : ''}`}
        </div>
        {visibleSubtasks.length > 0 && (
          <ul className="subtask-list">
            {visibleSubtasks.map((s) => (
              <li key={s.id} className={`subtask-item ${s.status === 'done' ? 'done' : ''}`}>
                <div className="subtask-titlerow">
                  <span
                    className={`status-pill ${s.status}${canEditSub(s) ? '' : ' static'}`}
                    title={canEditSub(s) ? `Mark as ${SUB_LABEL[SUB_NEXT[s.status]]}` : SUB_LABEL[s.status]}
                    onClick={canEditSub(s) ? () => cycleSubtaskStatus(s) : undefined}
                  >
                    {SUB_LABEL[s.status]}
                  </span>
                  <span className="subtask-text">{s.text}</span>
                  {isOwner && (
                    <button className="subtask-del" onClick={() => deleteSubtask(s.id)} title="Delete task" aria-label="Delete task">✕</button>
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
                        <button type="button" className="file-name file-link" onClick={() => downloadFile(`/api/attachments/${a.id}?download=1`)}>📎 {a.filename}</button>
                        {canEditSub(s) && (
                          <button className="file-del" onClick={() => removeAttachment(s, a.id, a.filename)} title="Remove file">Remove</button>
                        )}
                      </div>
                      {a.summary && <div className="file-summary">{a.summary}</div>}
                    </div>
                  ))}
                  {canEditSub(s) && (
                    <>
                      <label className="attach-btn">
                        {uploadingFor === s.id ? 'Uploading…' : '+ Attach file'}
                        <input
                          type="file"
                          hidden
                          disabled={uploadingFor !== null}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(s, f); e.target.value = ''; }}
                        />
                      </label>
                      <LibraryPicker
                        target={{ subtask_id: s.id }}
                        onAttached={(att) => setSubAttachments((prev) => ({ ...prev, [s.id]: [...(prev[s.id] ?? []), att] }))}
                      />
                    </>
                  )}
                </div>

                <SubtaskComments subtaskId={s.id} users={users} />
              </li>
            ))}
          </ul>
        )}
        {isOwner && !focusSubtaskId && (
          <div className="subtask-add mt">
            <textarea
              className="textarea"
              rows={3}
              placeholder="Add a task — or paste a list (new lines, or 1) 2) 3) split into separate tasks)"
              value={newSubtask}
              onChange={(e) => setNewSubtask(e.target.value)}
            />
            <button className="btn-primary sm" onClick={addSubtask} disabled={!newSubtask.trim()}>
              Add
            </button>
          </div>
        )}
      </div>

      </div>{/* end detail-right */}
      </div>{/* end detail-cols */}
    </aside>
  );
}
