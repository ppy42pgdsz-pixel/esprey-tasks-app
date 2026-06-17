import { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import type { Task, TaskStatus, TaskPriority, Company, Contact } from './types';
import TaskList from './components/TaskList';
import TaskDetail from './components/TaskDetail';
import AddTaskForm from './components/AddTaskForm';
import SettingsPanel from './components/SettingsPanel';
import './styles.css';

const sortContacts = (list: Contact[]) =>
  [...list].sort((a, b) => b.is_favourite - a.is_favourite || a.name.localeCompare(b.name));

type FilterStatus = 'all' | TaskStatus;

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterCompany, setFilterCompany] = useState<string>('');
  const [filterContact, setFilterContact] = useState<string>('');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Load companies and contacts once
  useEffect(() => {
    api.listCompanies().then(setCompanies).catch(console.error);
    api.listContacts().then(setContacts).catch(console.error);
  }, []);

  const loadTasks = useCallback(async () => {
    try {
      setError(null);
      const data = await api.listTasks(
        filterStatus === 'all' ? undefined : filterStatus,
        filterCompany || undefined,
        filterContact || undefined,
      );
      setTasks(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterCompany, filterContact]);

  useEffect(() => {
    setLoading(true);
    loadTasks();
  }, [loadTasks]);

  const handleStatusChange = async (task: Task, status: TaskStatus) => {
    const updated = await api.updateTask(task.id, { status });
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
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
    contact_id?: string;
    contact_name?: string;
  }) => {
    const task = await api.createTask(data);
    setTasks((prev) => [task, ...prev]);
    setShowAddForm(false);
  };

  const handleTaskUpdate = (updated: Task) => {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    setSelectedTask(updated);
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
    setContacts((prev) => prev.map((c) => (c.company_id === id ? { ...c, company_id: null } : c)));
    if (filterCompany === id) setFilterCompany('');
    await loadTasks(); // tasks were unassigned from this company
  };

  // ─── Settings: contact management ───
  const handleCreateContact = async (data: { name: string; email?: string; company_id?: string; is_favourite?: boolean }) => {
    const contact = await api.createContact(data);
    setContacts((prev) => sortContacts([...prev, contact]));
    return contact;
  };

  const handleUpdateContact = async (
    id: string,
    data: { name?: string; email?: string | null; company_id?: string | null; is_favourite?: boolean },
  ) => {
    const updated = await api.updateContact(id, data);
    setContacts((prev) => sortContacts(prev.map((c) => (c.id === id ? updated : c))));
    if ('name' in data) await loadTasks(); // denormalized contact_name changed
  };

  const handleDeleteContact = async (id: string) => {
    await api.deleteContact(id);
    setContacts((prev) => prev.filter((c) => c.id !== id));
    if (filterContact === id) setFilterContact('');
    await loadTasks(); // tasks were unassigned from this contact
  };

  // ─── Refresh ───
  const handleRefresh = async () => {
    setRefreshing(true);
    await loadTasks();
    setRefreshing(false);
  };

  // ─── Multi-select bulk edit ───
  const enterSelectMode = () => {
    setSelectedTask(null);
    setSelectedIds(new Set());
    setSelectMode(true);
  };
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allSelected = tasks.length > 0 && tasks.every((t) => selectedIds.has(t.id));
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(tasks.map((t) => t.id)));
  };

  const applyBulk = async (fn: (id: string) => Promise<unknown>) => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      await Promise.all(ids.map(fn));
      await loadTasks();
      setSelectedIds(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk action failed');
    }
  };
  const handleBulkStatus = (status: TaskStatus) => applyBulk((id) => api.updateTask(id, { status }));
  const handleBulkCompany = (value: string) => {
    const companyId = value === '__none__' ? '' : value;
    const company = companies.find((c) => c.id === companyId);
    return applyBulk((id) => api.updateTask(id, { company_id: companyId || null, company_name: company?.name ?? null }));
  };
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} task(s)? This cannot be undone.`)) return;
    await applyBulk((id) => api.deleteTask(id));
  };

  const counts = {
    all: tasks.length,
    todo: tasks.filter((t) => t.status === 'todo').length,
    in_progress: tasks.filter((t) => t.status === 'in_progress').length,
    done: tasks.filter((t) => t.status === 'done').length,
  };

  const favouriteContacts = contacts.filter((c) => c.is_favourite === 1);
  const otherContacts = contacts.filter((c) => c.is_favourite !== 1);

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <h1 className="logo">Tasks</h1>
          <div className="header-actions">
            <button className="btn-secondary" onClick={handleRefresh} disabled={refreshing} title="Reload tasks">
              {refreshing ? 'Refreshing…' : '↻ Refresh'}
            </button>
            <button className="btn-secondary" onClick={selectMode ? exitSelectMode : enterSelectMode}>
              {selectMode ? 'Done' : 'Select'}
            </button>
            <button className="btn-secondary" onClick={() => setShowSettings(true)}>
              Settings
            </button>
            <button className="btn-primary" onClick={() => setShowAddForm(true)}>
              + Add Task
            </button>
          </div>
        </div>

        <div className="filter-bar">
          <nav className="filter-nav">
            {(['all', 'todo', 'in_progress', 'done'] as FilterStatus[]).map((s) => (
              <button
                key={s}
                className={`filter-btn ${filterStatus === s ? 'active' : ''}`}
                onClick={() => setFilterStatus(s)}
              >
                {s === 'all' ? 'All' : s === 'in_progress' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1)}
                <span className="badge">{counts[s]}</span>
              </button>
            ))}
          </nav>

          <div className="filter-selects">
            <select
              className="select-input filter-select"
              value={filterCompany}
              onChange={(e) => setFilterCompany(e.target.value)}
            >
              <option value="">All companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            <select
              className="select-input filter-select"
              value={filterContact}
              onChange={(e) => setFilterContact(e.target.value)}
            >
              <option value="">All contacts</option>
              {favouriteContacts.length > 0 && (
                <optgroup label="Favourites">
                  {favouriteContacts.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </optgroup>
              )}
              {otherContacts.length > 0 && (
                <optgroup label="Others">
                  {otherContacts.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </optgroup>
              )}
            </select>

            {(filterCompany || filterContact) && (
              <button className="link-btn" onClick={() => { setFilterCompany(''); setFilterContact(''); }}>
                Clear filters
              </button>
            )}
          </div>
        </div>
      </header>

      {showSettings && (
        <SettingsPanel
          companies={companies}
          contacts={contacts}
          onClose={() => setShowSettings(false)}
          onCreateCompany={handleNewCompany}
          onRenameCompany={handleRenameCompany}
          onDeleteCompany={handleDeleteCompany}
          onCreateContact={handleCreateContact}
          onUpdateContact={handleUpdateContact}
          onDeleteContact={handleDeleteContact}
        />
      )}

      <main className="main">
        {!loading && !error && (
          <div className="stats-row">
            <div className="stat-card">
              <div className="stat-number">{counts.all}</div>
              <div className="stat-label">tasks</div>
            </div>
            <div className="stat-card">
              <div className="stat-number">{counts.todo}</div>
              <div className="stat-label">to do</div>
            </div>
            <div className="stat-card">
              <div className="stat-number">{companies.length}</div>
              <div className="stat-label">companies</div>
            </div>
          </div>
        )}

        {showAddForm && (
          <AddTaskForm
            companies={companies}
            contacts={contacts}
            onSubmit={handleAdd}
            onCancel={() => setShowAddForm(false)}
          />
        )}

        {selectMode && (
          <div className="bulk-bar">
            <label className="checkbox-label">
              <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
              {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select all'}
            </label>
            <select
              className="select-input bulk-select"
              value=""
              disabled={selectedIds.size === 0}
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
              disabled={selectedIds.size === 0}
              onChange={(e) => e.target.value && handleBulkCompany(e.target.value)}
            >
              <option value="">Set company…</option>
              <option value="__none__">No company</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button className="btn-danger" disabled={selectedIds.size === 0} onClick={handleBulkDelete}>
              Delete
            </button>
          </div>
        )}

        {loading ? (
          <div className="state-message">Loading…</div>
        ) : error ? (
          <div className="state-message error">{error}</div>
        ) : tasks.length === 0 ? (
          <div className="state-card">
            <div className="state-message muted">
              {filterStatus === 'all' && !filterCompany && !filterContact
                ? 'No tasks yet. Add one above or forward an email to tasks@esprey.net'
                : 'No tasks match the current filters.'}
            </div>
          </div>
        ) : (
          <TaskList
            tasks={tasks}
            selected={selectedTask}
            onSelect={setSelectedTask}
            onStatusChange={handleStatusChange}
            onDelete={handleDelete}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
          />
        )}
      </main>

      {selectedTask && !selectMode && (
        <div className="detail-overlay" onClick={() => setSelectedTask(null)}>
          <div className="detail-slideover" onClick={(e) => e.stopPropagation()}>
            <TaskDetail
              key={selectedTask.id}
              task={selectedTask}
              companies={companies}
              contacts={contacts}
              onClose={() => setSelectedTask(null)}
              onUpdate={handleTaskUpdate}
              onDelete={handleDelete}
            />
          </div>
        </div>
      )}
    </div>
  );
}
