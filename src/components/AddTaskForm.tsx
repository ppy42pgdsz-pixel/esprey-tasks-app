import { useState } from 'react';
import type { Company, RecurUnit } from '../types';
import { api } from '../api';

interface Props {
  companies: Company[];
  onSubmit: (data: {
    title: string;
    company_id?: string;
    company_name?: string;
    recur_interval?: number;
    recur_unit?: RecurUnit;
    tasks: string[];
  }) => Promise<void>;
  onCancel: () => void;
}

export default function AddTaskForm({ companies, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState('');
  const personalId = companies.find((c) => c.name.trim().toLowerCase() === 'personal')?.id ?? '';
  const [companyId, setCompanyId] = useState(personalId); // default to Personal
  const [recurUnit, setRecurUnit] = useState<'' | RecurUnit>('');
  const [recurInterval, setRecurInterval] = useState(1);
  const [tasks, setTasks] = useState<string[]>([]);
  const [newTask, setNewTask] = useState('');
  const [paste, setPaste] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedCompany = companies.find((c) => c.id === companyId);

  const addNewTask = () => {
    const t = newTask.trim();
    if (!t) return;
    setTasks((prev) => [...prev, t]);
    setNewTask('');
  };
  const updateTask = (i: number, value: string) => setTasks((prev) => prev.map((t, idx) => (idx === i ? value : t)));
  const removeTask = (i: number) => setTasks((prev) => prev.filter((_, idx) => idx !== i));

  const generateFromPaste = async () => {
    const text = paste.trim();
    if (!text) return;
    setGenerating(true);
    try {
      const { tasks: generated } = await api.extractTasks(text);
      if (generated.length === 0) {
        alert('No tasks found in that text. Try adding them manually.');
      } else {
        setTasks((prev) => [...prev, ...generated]);
        setPaste('');
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not generate tasks');
    } finally {
      setGenerating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      // Fold any unsubmitted single-task input into the list.
      const pending = newTask.trim();
      const finalTasks = pending ? [...tasks, pending] : tasks;
      await onSubmit({
        title: title.trim(),
        company_id: companyId || undefined,
        company_name: selectedCompany?.name,
        recur_unit: recurUnit || undefined,
        recur_interval: recurUnit ? Math.max(1, recurInterval) : undefined,
        tasks: finalTasks.map((t) => t.trim()).filter(Boolean),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="add-form-overlay">
      <form className="add-form" onSubmit={handleSubmit}>
        <h3 className="form-title">New Project</h3>

        <input
          className="text-input"
          placeholder="Project title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          required
        />

        <div className="form-row">
          <div className="company-field">
            <select
              className="select-input"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
            >
              {!personalId && <option value="">No company</option>}
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-row repeat-row">
          <span className="repeat-label">Repeat</span>
          <select
            className="select-input"
            value={recurUnit}
            onChange={(e) => setRecurUnit(e.target.value as '' | RecurUnit)}
          >
            <option value="">Doesn't repeat</option>
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>
          {recurUnit && (
            <label className="repeat-every">
              every
              <input
                type="number"
                min={1}
                className="text-input repeat-n"
                value={recurInterval}
                onChange={(e) => setRecurInterval(Math.max(1, Number(e.target.value) || 1))}
              />
              {recurUnit === 'day' ? 'day(s)' : recurUnit === 'week' ? 'week(s)' : 'month(s)'}
            </label>
          )}
        </div>

        {/* Tasks builder */}
        <div className="create-tasks">
          <div className="create-tasks-label">Tasks {tasks.length > 0 && <span className="muted">· {tasks.length}</span>}</div>

          {tasks.length > 0 && (
            <ul className="create-task-list">
              {tasks.map((t, i) => (
                <li key={i} className="create-task-row">
                  <input
                    className="text-input"
                    value={t}
                    onChange={(e) => updateTask(i, e.target.value)}
                    aria-label={`Task ${i + 1}`}
                  />
                  <button type="button" className="subtask-del" onClick={() => removeTask(i)} aria-label="Remove task">✕</button>
                </li>
              ))}
            </ul>
          )}

          <div className="create-task-add">
            <input
              className="text-input"
              placeholder="Add a task…"
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNewTask(); } }}
            />
            <button type="button" className="btn-secondary sm" onClick={addNewTask} disabled={!newTask.trim()}>Add</button>
          </div>

          <div className="create-task-paste">
            <textarea
              className="textarea"
              rows={3}
              placeholder="…or paste notes / an email / a rough list and let AI turn it into tasks"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
            />
            <button type="button" className="btn-secondary sm" onClick={generateFromPaste} disabled={generating || !paste.trim()}>
              {generating ? 'Generating…' : '✨ Generate tasks with AI'}
            </button>
          </div>
        </div>

        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving || !title.trim()}>
            {saving ? 'Creating…' : 'Create Project'}
          </button>
        </div>
      </form>
    </div>
  );
}
