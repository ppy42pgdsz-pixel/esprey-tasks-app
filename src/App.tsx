import { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import type { Task, TaskStatus, TaskPriority, Company, Contact } from './types';
import TaskList from './components/TaskList';
import TaskDetail from './components/TaskDetail';
import AddTaskForm from './components/AddTaskForm';
import './styles.css';

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

  const handleNewContact = async (data: { name: string; is_favourite?: boolean }) => {
    const contact = await api.createContact(data);
    setContacts((prev) => [...prev, contact].sort((a, b) => b.is_favourite - a.is_favourite || a.name.localeCompare(b.name)));
    return contact;
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
          <button className="btn-primary" onClick={() => setShowAddForm(true)}>
            + Add Task
          </button>
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

      <main className="main">
        {showAddForm && (
          <AddTaskForm
            companies={companies}
            contacts={contacts}
            onSubmit={handleAdd}
            onCancel={() => setShowAddForm(false)}
            onNewCompany={handleNewCompany}
            onNewContact={handleNewContact}
          />
        )}

        {loading ? (
          <div className="state-message">Loading…</div>
        ) : error ? (
          <div className="state-message error">{error}</div>
        ) : tasks.length === 0 ? (
          <div className="state-message muted">
            {filterStatus === 'all' && !filterCompany && !filterContact
              ? 'No tasks yet. Add one above or forward an email to tasks@esprey.net'
              : 'No tasks match the current filters.'}
          </div>
        ) : (
          <div className="layout">
            <TaskList
              tasks={tasks}
              selected={selectedTask}
              onSelect={setSelectedTask}
              onStatusChange={handleStatusChange}
              onDelete={handleDelete}
            />
            {selectedTask && (
              <TaskDetail
                task={selectedTask}
                companies={companies}
                contacts={contacts}
                onClose={() => setSelectedTask(null)}
                onUpdate={handleTaskUpdate}
                onDelete={handleDelete}
                onNewCompany={handleNewCompany}
                onNewContact={handleNewContact}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
