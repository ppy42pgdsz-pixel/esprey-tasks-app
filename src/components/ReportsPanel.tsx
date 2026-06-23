import { useEffect, useState } from 'react';
import type { Company, ReportProject } from '../types';
import { api } from '../api';

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

interface Props {
  companies: Company[];
  onClose: () => void;
}

export default function ReportsPanel({ companies, onClose }: Props) {
  const [companyId, setCompanyId] = useState('');
  const [projects, setProjects] = useState<ReportProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [emailing, setEmailing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const scopeLabel = companyId ? (companies.find((c) => c.id === companyId)?.name ?? 'Selected company') : 'All companies';

  useEffect(() => {
    setLoading(true);
    setMsg(null);
    api.getReport(companyId || undefined)
      .then((r) => setProjects(r.projects))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, [companyId]);

  const totalTasks = projects.reduce((n, p) => n + p.tasks.length, 0);

  const emailMe = async () => {
    setEmailing(true);
    setMsg(null);
    try {
      const r = await api.emailReport(companyId || undefined);
      setMsg(`Emailed to you — ${r.projects} project${r.projects === 1 ? '' : 's'}.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not send the email.');
    } finally {
      setEmailing(false);
    }
  };

  return (
    <div className="settings-page-overlay" onClick={onClose}>
      <div className="settings-page" onClick={(e) => e.stopPropagation()}>
        <div className="settings-page-header no-print">
          <button className="back-btn" onClick={onClose}>← Back</button>
          <h2 className="settings-page-title">Outstanding report</h2>
          <span className="header-spacer" />
        </div>

        <div className="report-controls no-print">
          <select className="select-input" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">All companies</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="btn-secondary" onClick={() => window.print()} disabled={loading}>⬇ Save as PDF</button>
          <button className="btn-primary" onClick={emailMe} disabled={loading || emailing}>{emailing ? 'Sending…' : '✉ Email to me'}</button>
        </div>
        {msg && <p className="muted center no-print" style={{ marginTop: 4 }}>{msg}</p>}

        {/* Printable report */}
        <div className="report-print">
          <div className="report-head">
            <h1 className="report-title">Outstanding projects &amp; tasks</h1>
            <div className="report-sub">{scopeLabel} · {fmtDate(Date.now())} · {projects.length} project{projects.length === 1 ? '' : 's'}, {totalTasks} open task{totalTasks === 1 ? '' : 's'}</div>
          </div>

          {loading ? (
            <p className="muted">Loading…</p>
          ) : projects.length === 0 ? (
            <p className="muted">Nothing outstanding — all clear.</p>
          ) : (
            projects.map((p) => (
              <div key={p.id} className="report-project">
                <div className="report-project-head">
                  <span className="report-project-title">{p.title}</span>
                  <span className="report-project-meta">
                    {[p.company_name, p.due_date ? `due ${fmtDate(p.due_date)}` : null, `added ${fmtDate(p.created_at)}`].filter(Boolean).join(' · ')}
                  </span>
                </div>
                {p.tasks.length === 0 ? (
                  <div className="report-task muted">No open tasks</div>
                ) : (
                  <ul className="report-tasks">
                    {p.tasks.map((t, i) => (
                      <li key={i} className="report-task">
                        <span className="report-task-text">{t.text}</span>
                        <span className="report-task-meta">
                          {[t.assignee_names || 'Unassigned', t.due_date ? `due ${fmtDate(t.due_date)}` : null, t.status === 'done' ? 'awaiting sign-off' : null].filter(Boolean).join(' · ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
