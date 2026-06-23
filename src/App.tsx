import { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import type { Task, TaskStatus, TaskPriority, RecurUnit, Company, User, UserRole } from './types';
import TaskList from './components/TaskList';
import TaskDetail from './components/TaskDetail';
import AddTaskForm from './components/AddTaskForm';
import SettingsPanel from './components/SettingsPanel';
import './styles.css';

type FilterStatus = 'all' | 'todo' | 'in_progress' | 'completed';

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterCompany, setFilterCompany] = useState<string>('');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [focusedSubtaskId, setFocusedSubtaskId] = useState<string | null>(null);
  const openTask = (task: Task) => { setFocusedSubtaskId(null); setSelectedTask(task); };
  const openSubtask = (task: Task, subtaskId: string) => { setFocusedSubtaskId(subtaskId); setSelectedTask(task); };
  const closeDetail = () => { setSelectedTask(null); setFocusedSubtaskId(null); };
  const [showAddForm, setShowAddForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [me, setMe] = useState<{ email: string; name: string; role: UserRole } | null>(null);
  const [users, setUsers] = useState<User[]>([]);

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
    description?: string;
    priority?: TaskPriority;
    company_id?: string;
    company_name?: string;
    recur_interval?: number;
    recur_unit?: RecurUnit;
  }) => {
    const task = await api.createTask(data);
    setTasks((prev) => [task, ...prev]);
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
    await loadTasks();
    setRefreshing(false);
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
  const visibleTasks =
    filterStatus === 'completed' ? tasks.filter((t) => t.archived)
    : filterStatus === 'all' ? activeTasks
    : activeTasks.filter((t) => t.status === filterStatus);

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
    if (failed) alert(`${failed} of ${ids.length} task(s) couldn't be changed — you can only edit tasks you own.`);
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
      alert("You can only delete tasks you own. Tasks shared with you can't be deleted.");
      return;
    }
    const skipped = ids.length - mine.length;
    const msg = skipped > 0
      ? `Delete ${mine.length} task(s) you own? ${skipped} owned by someone else will be left alone. This cannot be undone.`
      : `Delete ${mine.length} task(s)? This cannot be undone.`;
    if (!confirm(msg)) return;
    await Promise.allSettled(mine.map((id) => api.deleteTask(id)));
    await loadTasks();
    setSelectedIds(new Set());
  };

  const counts = {
    all: activeTasks.length,
    todo: activeTasks.filter((t) => t.status === 'todo').length,
    in_progress: activeTasks.filter((t) => t.status === 'in_progress').length,
    completed: tasks.filter((t) => t.archived).length,
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <h1 className="logo">Tasks</h1>
          <div className="header-actions">
            <button className="btn-secondary" onClick={() => setShowSettings(true)}>
              Settings
            </button>
            <button className="btn-primary" onClick={() => setShowAddForm(true)}>
              + Add Task
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
        />
      )}

      <main className="main">
        {!loading && !error && (
          <>
            <div className="stats-row">
              {([
                ['all', 'tasks', counts.all],
                ['todo', 'to do', counts.todo],
                ['in_progress', 'in progress', counts.in_progress],
                ['completed', 'completed', counts.completed],
              ] as [FilterStatus, string, number][]).map(([status, label, n]) => (
                <button
                  key={status}
                  className={`stat-card clickable ${filterStatus === status ? 'active' : ''}`}
                  onClick={() => setFilterStatus(status)}
                >
                  <div className="stat-number">{n}</div>
                  <div className="stat-label">{label}</div>
                </button>
              ))}
            </div>

            <div className="list-controls">
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

              {filterCompany && (
                <button className="link-btn" onClick={() => setFilterCompany('')}>
                  Clear filter
                </button>
              )}

              <button className="btn-secondary spacer" onClick={handleRefresh} disabled={refreshing} title="Reload tasks">
                {refreshing ? 'Refreshing…' : '↻ Refresh'}
              </button>
            </div>
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
              <option value="todo">To Do</option>
              <option value="in_progress">In Progress</option>
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
        ) : visibleTasks.length === 0 ? (
          <div className="state-card">
            <div className="state-message muted">
              {filterStatus === 'all' && !filterCompany
                ? 'No tasks yet. Add one above or forward an email to tasks@esprey.net'
                : 'No tasks match the current filters.'}
            </div>
          </div>
        ) : (
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
    </div>
  );
}
