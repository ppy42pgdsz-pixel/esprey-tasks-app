import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from './api';
import type { Task, TaskStatus, RecurUnit, Company, User, UserRole } from './types';
import TaskList from './components/TaskList';
import TaskDetail from './components/TaskDetail';
import AddTaskForm from './components/AddTaskForm';
import SettingsPanel from './components/SettingsPanel';
import ReportsPanel from './components/ReportsPanel';
import CompletedSubtasks from './components/CompletedSubtasks';
import Assistant from './components/Assistant';
import type { CompletedSubtask } from './types';
import { notifSupported, notifPermission, requestNotifPermission, showNotifications, ensureServiceWorker, subscribeToPush } from './notifications';
import './styles.css';

type FilterStatus = 'active' | 'completed';
type QuickFilter = '' | 'overdue' | 'due_week' | 'awaiting' | 'assigned_me' | 'unassigned';

const QUICK_FILTERS: [QuickFilter, string][] = [
  ['overdue', 'Overdue'],
  ['due_week', 'Due this week'],
  ['awaiting', 'Awaiting my sign-off'],
  ['assigned_me', 'Assigned to me'],
  ['unassigned', 'Unassigned'],
];

type TaskView = 'work' | 'personal' | 'all';
const isPersonal = (companyName?: string | null) => (companyName ?? '').trim().toLowerCase() === 'personal';

const dayStartUtc = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const nextDueOf = (t: Task): number | null => {
  const ds = [t.due_date, t.min_subtask_due].filter((d): d is number => typeof d === 'number');
  return ds.length ? Math.min(...ds) : null;
};

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('active');
  const [filterCompany, setFilterCompany] = useState<string>('');
  const [search, setSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('');
  const [filterPerson, setFilterPerson] = useState<string>('');
  const [view, setView] = useState<TaskView>(() => {
    try { const v = localStorage.getItem('taskView'); if (v === 'work' || v === 'personal' || v === 'all') return v; } catch { /* noop */ }
    return 'work';
  });
  useEffect(() => { try { localStorage.setItem('taskView', view); } catch { /* noop */ } }, [view]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [focusedSubtaskId, setFocusedSubtaskId] = useState<string | null>(null);
  const openTask = (task: Task) => { setFocusedSubtaskId(null); setSelectedTask(task); };
  const openSubtask = (task: Task, subtaskId: string) => { setFocusedSubtaskId(subtaskId); setSelectedTask(task); };
  const closeDetail = () => { setSelectedTask(null); setFocusedSubtaskId(null); };
  const [showAddForm, setShowAddForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [me, setMe] = useState<{ email: string; name: string; role: UserRole } | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [completedSubtasks, setCompletedSubtasks] = useState<CompletedSubtask[]>([]);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>(notifPermission());
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(() => {
    try { return new URLSearchParams(window.location.search).get('task'); } catch { return null; }
  });

  // Load reference data once
  useEffect(() => {
    api.listCompanies().then(setCompanies).catch(console.error);
    api.getMe().then(setMe).catch(console.error);
    api.listUsers().then(setUsers).catch(console.error);
  }, []);

  const sortUsers = (list: User[]) => [...list].sort((a, b) => a.name.localeCompare(b.name));
  const handleCreateUser = async (data: { name: string; email: string; role: UserRole }) => {
    const u = await api.createUser(data);
    setUsers((prev) => sortUsers([...prev.filter((x) => x.email !== u.email), u]));
  };
  const handleUpdateUser = async (email: string, data: { name?: string; role?: UserRole }) => {
    const u = await api.updateUser(email, data);
    setUsers((prev) => prev.map((x) => (x.email === email ? u : x)));
  };
  const handleDeleteUser = async (email: string, wipe = false) => {
    await api.deleteUser(email, wipe);
    setUsers((prev) => prev.filter((x) => x.email !== email));
    if (wipe) await loadTasks();
  };
  const handleAddAlias = async (email: string, alias: string) => {
    const res = await api.addUserAlias(email, alias);
    setUsers((prev) => prev.map((u) => (u.email === email
      ? { ...u, aliases: Array.from(new Set([...(u.aliases ?? []), res.alias])) }
      : u)));
  };
  const handleRemoveAlias = async (email: string, alias: string) => {
    await api.removeUserAlias(email, alias);
    setUsers((prev) => prev.map((u) => (u.email === email
      ? { ...u, aliases: (u.aliases ?? []).filter((a) => a !== alias) }
      : u)));
  };
  const handleSetUserCompanies = async (email: string, companyIds: string[]) => {
    const res = await api.setUserCompanies(email, companyIds);
    setUsers((prev) => prev.map((u) => (u.email === email ? { ...u, company_ids: res.company_ids } : u)));
  };
  // Edit your own display name (the name others see on your projects/tasks).
  const handleRenameSelf = async (name: string) => {
    if (!me) return;
    const updated = await api.updateUser(me.email, { name });
    setMe({ ...me, name: updated.name });
    setUsers((prev) => prev.map((u) => (u.email === me.email ? { ...u, name: updated.name } : u)));
    await loadTasks(); // owner/assignee names are joined server-side, so refresh the list
  };

  // Load by company only; status is filtered client-side so the stat cards
  // always show accurate counts for every status.
  const loadTasks = useCallback(async () => {
    try {
      setError(null);
      const data = await api.listTasks(undefined, filterCompany || undefined);
      setTasks(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [filterCompany]);

  useEffect(() => {
    setLoading(true);
    loadTasks();
  }, [loadTasks]);

  // The "Completed" tab also surfaces signed-off subtasks across all tasks.
  const loadCompletedSubtasks = useCallback(async () => {
    try {
      setCompletedSubtasks(await api.listCompletedSubtasks());
    } catch {
      setCompletedSubtasks([]);
    }
  }, []);

  useEffect(() => {
    if (filterStatus === 'completed') loadCompletedSubtasks();
  }, [filterStatus, loadCompletedSubtasks]);

  // ─── Notifications: poll unread, show OS banners, mark read ───
  // When Web Push is active, banners arrive via push (open or closed) so the
  // poll only clears the inbox; otherwise the poll shows banners (app-open only).
  const pushActiveRef = useRef(false);
  const pollNotifications = useCallback(async () => {
    if (!notifSupported() || Notification.permission !== 'granted') return;
    try {
      const items = await api.listNotifications();
      if (items.length) {
        if (!pushActiveRef.current) await showNotifications(items);
        await api.markNotificationsRead(items.map((n) => n.id));
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!notifSupported() || Notification.permission !== 'granted') return;
    ensureServiceWorker();
    // Make sure the server has this device's push subscription.
    subscribeToPush().then((ok) => { pushActiveRef.current = ok; });
    pollNotifications();
    const id = window.setInterval(pollNotifications, 30000);
    const onFocus = () => pollNotifications();
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, [pollNotifications]);

  const enableNotifications = async () => {
    const p = await requestNotifPermission();
    setNotifPerm(p);
    if (p === 'granted') {
      await ensureServiceWorker();
      pushActiveRef.current = await subscribeToPush();
      pollNotifications();
    }
  };

  const sendTestNotification = async () => {
    try {
      const r = await api.sendTestPush();
      alert(r.ok ? 'Sent — you should get a banner in a moment.' : (r.error || 'No subscribed device yet.'));
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not send test.');
    }
  };

  // Open the task named in a ?task= deep link (from clicking a notification).
  useEffect(() => {
    if (!pendingTaskId) return;
    const t = tasks.find((x) => x.id === pendingTaskId);
    if (t) {
      openTask(t);
      setPendingTaskId(null);
      try { const u = new URL(window.location.href); u.searchParams.delete('task'); window.history.replaceState({}, '', u.pathname + u.search); } catch { /* noop */ }
    }
  }, [tasks, pendingTaskId]);

  // Keep the list fresh across users without a manual refresh: poll periodically
  // and whenever the window/tab regains focus. loadTasks doesn't toggle the
  // loading spinner, so these refetches are silent.
  useEffect(() => {
    const refetch = () => loadTasks();
    const onVisible = () => { if (!document.hidden) refetch(); };
    const id = window.setInterval(refetch, 15000);
    window.addEventListener('focus', refetch);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', refetch);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadTasks]);

  // Preserve subtask counts (the PATCH response doesn't include them).
  const mergeCounts = (prev: Task, next: Task): Task => ({
    ...next,
    subtask_total: prev.subtask_total,
    subtask_done: prev.subtask_done,
  });

  const handleStatusChange = async (task: Task, status: TaskStatus) => {
    const updated = await api.updateTask(task.id, { status });
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? mergeCounts(t, updated) : t)));
    if (selectedTask?.id === updated.id) setSelectedTask(updated);
  };

  const handleDelete = async (task: Task) => {
    await api.deleteTask(task.id);
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    if (selectedTask?.id === task.id) setSelectedTask(null);
  };

  const handleAdd = async (data: {
    title: string;
    company_id?: string;
    company_name?: string;
    recur_interval?: number;
    recur_unit?: RecurUnit;
    tasks: string[];
  }) => {
    const { tasks: taskItems, ...projectData } = data;
    const project = await api.createTask(projectData);
    // Create each task (sequentially keeps their order/position).
    for (const text of taskItems) {
      try { await api.createSubtask(project.id, text); } catch (e) { console.error('failed to add task', e); }
    }
    setTasks((prev) => [{ ...project, subtask_total: taskItems.length, subtask_done: 0 }, ...prev]);
    setShowAddForm(false);
  };

  const handleTaskUpdate = (updated: Task) => {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? mergeCounts(t, updated) : t)));
    setSelectedTask(updated);
  };

  const handleSubtaskProgress = (taskId: string, total: number, done: number, pending?: number) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId
      ? { ...t, subtask_total: total, subtask_done: done, ...(pending === undefined ? {} : { pending_signoff: pending }) }
      : t)));
  };


  const handleNewCompany = async (name: string) => {
    const company = await api.createCompany(name);
    setCompanies((prev) => [...prev, company].sort((a, b) => a.name.localeCompare(b.name)));
    return company;
  };

  // ─── Settings: company management ───
  const handleRenameCompany = async (id: string, name: string) => {
    const updated = await api.updateCompany(id, name);
    setCompanies((prev) => prev.map((c) => (c.id === id ? updated : c)).sort((a, b) => a.name.localeCompare(b.name)));
    await loadTasks(); // tasks store a denormalized company_name that just changed
  };

  const handleDeleteCompany = async (id: string) => {
    await api.deleteCompany(id);
    setCompanies((prev) => prev.filter((c) => c.id !== id));
    if (filterCompany === id) setFilterCompany('');
    await loadTasks(); // tasks were unassigned from this company
  };

  // ─── Refresh ───
  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadTasks(), filterStatus === 'completed' ? loadCompletedSubtasks() : Promise.resolve()]);
    setRefreshing(false);
  };

  // Open a signed-off subtask from the Completed tab in its focused detail view.
  const openCompletedSubtask = (taskId: string, subtaskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (task) openSubtask(task, subtaskId);
  };

  // ─── Multi-select bulk edit (checkboxes always visible) ───
  const clearSelection = () => setSelectedIds(new Set());
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  // Completed (archived) tasks live under the "Completed" view; everything else
  // shows only active (non-archived) tasks.
  const activeTasks = tasks.filter((t) => !t.archived);
  const byStatus = filterStatus === 'completed' ? tasks.filter((t) => t.archived) : activeTasks;

  const meEmailLower = (me?.email ?? '').toLowerCase();
  const personName = filterPerson
    ? (users.find((u) => u.email.toLowerCase() === filterPerson)?.name ?? '')
    : '';
  const today = dayStartUtc();
  const weekEnd = today + 7 * 24 * 60 * 60 * 1000;
  const matchesQuick = (t: Task): boolean => {
    const d = nextDueOf(t);
    switch (quickFilter) {
      case 'overdue': return d != null && d < today && t.status !== 'done';
      case 'due_week': return d != null && d >= today && d <= weekEnd;
      case 'awaiting': return (t.pending_signoff ?? 0) > 0 && (t.owner_email ?? '').toLowerCase() === meEmailLower;
      case 'assigned_me': return (t.assigned_to_me ?? 0) > 0;
      case 'unassigned': return !(t.assignee_names && t.assignee_names.trim());
      default: return true;
    }
  };
  const matchesPerson = (t: Task): boolean => {
    if (!personName) return true;
    const names = (t.assignee_names ?? '').split(',').map((s) => s.trim());
    return names.includes(personName);
  };
  const matchesView = (companyName?: string | null) =>
    view === 'all' ? true : view === 'personal' ? isPersonal(companyName) : !isPersonal(companyName);
  const q = search.trim().toLowerCase();
  const visibleTasks = byStatus
    .filter((t) => !q || t.title.toLowerCase().includes(q))
    .filter(matchesQuick)
    .filter(matchesPerson)
    .filter((t) => matchesView(t.company_name));
  const visibleCompletedSubs = completedSubtasks.filter((cs) => matchesView(cs.company_name));
  const filtersActive = !!(q || quickFilter || filterPerson || filterCompany);
  const clearAllFilters = () => { setSearch(''); setQuickFilter(''); setFilterPerson(''); setFilterCompany(''); };

  const allSelected = visibleTasks.length > 0 && visibleTasks.every((t) => selectedIds.has(t.id));
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(visibleTasks.map((t) => t.id)));
  };

  // Run a bulk action over selected tasks. Never blanks the table on failure:
  // it reloads and reports how many were rejected (e.g. tasks you don't own).
  const applyBulk = async (fn: (id: string) => Promise<unknown>) => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const results = await Promise.allSettled(ids.map(fn));
    const failed = results.filter((r) => r.status === 'rejected').length;
    await loadTasks();
    setSelectedIds(new Set());
    if (failed) alert(`${failed} of ${ids.length} project(s) couldn't be changed — you can only edit projects you own.`);
  };
  const handleBulkStatus = (status: TaskStatus) => applyBulk((id) => api.updateTask(id, { status }));
  const handleBulkCompany = (value: string) => {
    const companyId = value === '__none__' ? '' : value;
    const company = companies.find((c) => c.id === companyId);
    return applyBulk((id) => api.updateTask(id, { company_id: companyId || null, company_name: company?.name ?? null }));
  };
  const handleBulkDelete = async () => {
    const meEmail = (me?.email ?? '').toLowerCase();
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    // You can only delete tasks you own — filter those out before asking.
    const mine = ids.filter((id) => {
      const t = tasks.find((x) => x.id === id);
      return !!t && ((t.owner_email ?? '').toLowerCase() === meEmail || !t.owner_email);
    });
    if (mine.length === 0) {
      alert("You can only delete projects you own. Projects shared with you can't be deleted.");
      return;
    }
    const skipped = ids.length - mine.length;
    const msg = skipped > 0
      ? `Delete ${mine.length} project(s) you own? ${skipped} owned by someone else will be left alone. This cannot be undone.`
      : `Delete ${mine.length} project(s)? This cannot be undone.`;
    if (!confirm(msg)) return;
    await Promise.allSettled(mine.map((id) => api.deleteTask(id)));
    await loadTasks();
    setSelectedIds(new Set());
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <div className="header-side header-left">
            <button className="icon-btn" title="Settings" aria-label="Settings" onClick={() => setShowSettings(true)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
            <button className="icon-btn" title="Outstanding report" aria-label="Outstanding report" onClick={() => setShowReports(true)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            </button>
          </div>

          <div className="header-title">
            <span className="app-icon" aria-hidden="true">
              <img src="/apple-touch-icon.png" width={28} height={28} alt="" style={{ display: 'block', borderRadius: 7 }} />
            </span>
            <h1 className="logo">Tasks</h1>
          </div>

          <div className="header-side header-right">
            <button className="btn-primary" onClick={() => setShowAddForm(true)}>
              + Add New
            </button>
          </div>
        </div>
      </header>

      {showSettings && (
        <SettingsPanel
          companies={companies}
          me={me}
          users={users}
          onClose={() => setShowSettings(false)}
          onCreateUser={handleCreateUser}
          onUpdateUser={handleUpdateUser}
          onDeleteUser={handleDeleteUser}
          onAddAlias={handleAddAlias}
          onRemoveAlias={handleRemoveAlias}
          onSetUserCompanies={handleSetUserCompanies}
          onCreateCompany={handleNewCompany}
          onRenameCompany={handleRenameCompany}
          onDeleteCompany={handleDeleteCompany}
          onRenameSelf={handleRenameSelf}
          notifStatus={notifSupported() ? notifPerm : 'unsupported'}
          onEnableNotifications={enableNotifications}
          onTestNotification={sendTestNotification}
        />
      )}

      {showReports && (
        <ReportsPanel companies={companies} onClose={() => setShowReports(false)} />
      )}

      <main className="main">
        {!loading && !error && (
          <>
            <div className="list-controls">
              <div className="seg-control" role="group" aria-label="Work or personal">
                {(['work', 'personal', 'all'] as TaskView[]).map((v) => (
                  <button
                    key={v}
                    className={`seg-btn ${view === v ? 'active' : ''}`}
                    onClick={() => setView(v)}
                  >
                    {v === 'work' ? 'Work' : v === 'personal' ? 'Personal' : 'All'}
                  </button>
                ))}
              </div>

              <input
                className="text-input search-input"
                type="search"
                placeholder="Search projects…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

              <select
                className="select-input"
                value={filterCompany}
                onChange={(e) => setFilterCompany(e.target.value)}
              >
                <option value="">All companies</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>

              {users.length > 0 && (
                <select
                  className="select-input"
                  value={filterPerson}
                  onChange={(e) => setFilterPerson(e.target.value)}
                >
                  <option value="">Anyone</option>
                  {users.map((u) => (
                    <option key={u.email} value={u.email.toLowerCase()}>{u.name}</option>
                  ))}
                </select>
              )}

              {filtersActive && (
                <button className="link-btn" onClick={clearAllFilters}>
                  Clear filters
                </button>
              )}

              <button className="btn-secondary spacer" onClick={handleRefresh} disabled={refreshing} title="Reload tasks">
                {refreshing ? 'Refreshing…' : '↻ Refresh'}
              </button>
            </div>

            <div className="quick-filters">
              {filterStatus === 'active' ? (
                <>
                  {QUICK_FILTERS.map(([key, label]) => (
                    <button
                      key={key}
                      className={`chip ${quickFilter === key ? 'active' : ''}`}
                      onClick={() => setQuickFilter(quickFilter === key ? '' : key)}
                    >
                      {label}
                    </button>
                  ))}
                  <button className="chip chip-view" onClick={() => { setQuickFilter(''); setFilterStatus('completed'); }}>
                    View completed
                  </button>
                </>
              ) : (
                <button className="chip active" onClick={() => setFilterStatus('active')}>
                  ← Back to active
                </button>
              )}
            </div>

            {filterStatus === 'completed' && (
              <p className="retention-note muted">
                Completed projects are automatically removed 30 days after they're marked complete — along with their tasks and files.
              </p>
            )}
          </>
        )}

        {showAddForm && (
          <AddTaskForm
            companies={companies}
            onSubmit={handleAdd}
            onCancel={() => setShowAddForm(false)}
          />
        )}

        {selectedIds.size > 0 && (
          <div className="bulk-bar">
            <span className="bulk-count">{selectedIds.size} selected</span>
            <select
              className="select-input bulk-select"
              value=""
              onChange={(e) => e.target.value && handleBulkStatus(e.target.value as TaskStatus)}
            >
              <option value="">Set status…</option>
              <option value="in_progress">Active</option>
              <option value="done">Done</option>
            </select>
            <select
              className="select-input bulk-select"
              value=""
              onChange={(e) => e.target.value && handleBulkCompany(e.target.value)}
            >
              <option value="">Set company…</option>
              <option value="__none__">No company</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button className="link-btn" onClick={clearSelection}>Clear</button>
            <button className="btn-danger" onClick={handleBulkDelete}>Delete</button>
          </div>
        )}

        {loading ? (
          <div className="state-message">Loading…</div>
        ) : error ? (
          <div className="state-message error">{error}</div>
        ) : (
          <>
            {visibleTasks.length > 0 && (
              <TaskList
                tasks={visibleTasks}
                selected={selectedTask}
                onSelect={openTask}
                onSelectSubtask={openSubtask}
                onStatusChange={handleStatusChange}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                allSelected={allSelected}
                onToggleSelectAll={toggleSelectAll}
                onSubtaskProgress={handleSubtaskProgress}
                meEmail={(me?.email ?? '').toLowerCase()}
                users={users}
                showCompleted={filterStatus === 'completed'}
              />
            )}

            {filterStatus === 'completed' && (
              <CompletedSubtasks items={visibleCompletedSubs} onOpen={openCompletedSubtask} />
            )}

            {visibleTasks.length === 0 && !(filterStatus === 'completed' && visibleCompletedSubs.length > 0) && (
              <div className="state-card">
                <div className="state-message muted">
                  {filterStatus === 'completed'
                    ? 'Nothing completed yet. Finished projects and signed-off tasks will show here.'
                    : !filtersActive
                      ? 'No projects yet. Add one above or forward an email to tasks@esprey.net'
                      : 'No projects match the current filters.'}
                </div>
                {filtersActive && filterStatus !== 'completed' && (
                  <button className="link-btn" onClick={clearAllFilters} style={{ marginTop: 8 }}>
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {selectedTask && (
        <div className="detail-overlay" onClick={closeDetail}>
          <div className="detail-slideover" onClick={(e) => e.stopPropagation()}>
            <TaskDetail
              key={`${selectedTask.id}:${focusedSubtaskId ?? ''}`}
              task={selectedTask}
              companies={companies}
              me={me}
              users={users}
              onClose={closeDetail}
              onUpdate={handleTaskUpdate}
              onDelete={handleDelete}
              onSubtaskProgress={handleSubtaskProgress}
              focusSubtaskId={focusedSubtaskId}
            />
          </div>
        </div>
      )}

      <Assistant onApplied={loadTasks} />
    </div>
  );
}
