import { useState } from 'react';
import type { Company, User, UserRole } from '../types';
import { api } from '../api';

interface Props {
  companies: Company[];
  me: { email: string; name: string; role: UserRole } | null;
  users: User[];
  onClose: () => void;
  onCreateCompany: (name: string) => Promise<Company>;
  onRenameCompany: (id: string, name: string) => Promise<void>;
  onDeleteCompany: (id: string) => Promise<void>;
  onCreateUser: (data: { name: string; email: string; role: UserRole }) => Promise<void>;
  onUpdateUser: (email: string, data: { name?: string; role?: UserRole }) => Promise<void>;
  onDeleteUser: (email: string, wipe?: boolean) => Promise<void>;
  onAddAlias: (email: string, alias: string) => Promise<void>;
  onRemoveAlias: (email: string, alias: string) => Promise<void>;
  onSetUserCompanies: (email: string, companyIds: string[]) => Promise<void>;
  onRenameSelf: (name: string) => Promise<void>;
  notifStatus: 'unsupported' | NotificationPermission;
  onEnableNotifications: () => void;
  onTestNotification: () => void;
}

export default function SettingsPanel(props: Props) {
  const {
    companies, me, users, onClose,
    onCreateCompany, onRenameCompany, onDeleteCompany,
    onCreateUser, onDeleteUser, onAddAlias, onRemoveAlias, onSetUserCompanies, onRenameSelf,
    notifStatus, onEnableNotifications, onTestNotification,
  } = props;

  const isAdmin = me?.role === 'admin';
  const [view, setView] = useState<'menu' | 'team'>('menu');

  // Your profile (display name)
  const [myName, setMyName] = useState(me?.name ?? '');
  const [savingName, setSavingName] = useState(false);
  const saveMyName = async () => {
    const name = myName.trim();
    if (!name || name === me?.name) return;
    setSavingName(true);
    try { await onRenameSelf(name); } catch (e) { alert(e instanceof Error ? e.message : 'Could not save name'); } finally { setSavingName(false); }
  };

  // Daily digest manual send
  const [digestBusy, setDigestBusy] = useState<'me' | 'all' | null>(null);
  const [digestMsg, setDigestMsg] = useState<string | null>(null);
  const runDigest = async (all: boolean) => {
    setDigestBusy(all ? 'all' : 'me');
    setDigestMsg(null);
    try {
      const r = await api.sendDigest(all);
      setDigestMsg(
        r.sent === 0
          ? 'Nobody had anything pending, so no emails were sent.'
          : `Sent ${r.sent} email${r.sent === 1 ? '' : 's'}${all ? ` (${r.recipients - r.sent} had nothing pending and were skipped)` : ''}.`,
      );
    } catch (e) {
      setDigestMsg(e instanceof Error ? e.message : 'Failed to send.');
    } finally {
      setDigestBusy(null);
    }
  };

  // Companies
  const [newCompany, setNewCompany] = useState('');
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [editingCompanyName, setEditingCompanyName] = useState('');

  // Team
  const [newUser, setNewUser] = useState<{ name: string; email: string; role: UserRole }>({ name: '', email: '', role: 'member' });
  const [aliasInput, setAliasInput] = useState<Record<string, string>>({});

  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { alert(e instanceof Error ? e.message : 'Something went wrong'); } finally { setBusy(false); }
  };

  // ─── Companies ───
  const addCompany = () => run(async () => { if (!newCompany.trim()) return; await onCreateCompany(newCompany.trim()); setNewCompany(''); });
  const saveCompany = () => run(async () => { if (!editingCompanyName.trim() || !editingCompanyId) return; await onRenameCompany(editingCompanyId, editingCompanyName.trim()); setEditingCompanyId(null); });
  const removeCompany = (c: Company) => run(async () => { if (!confirm(`Delete "${c.name}"? Tasks keep the name but lose the link.`)) return; await onDeleteCompany(c.id); });

  // ─── Team ───
  const addUser = () => run(async () => {
    const name = newUser.name.trim() || newUser.email.trim();
    const email = newUser.email.trim();
    if (!email) return;
    await onCreateUser({ name, email, role: newUser.role });
    setNewUser({ name: '', email: '', role: 'member' });
  });
  const removeUser = (u: User, wipe: boolean) => run(async () => {
    const msg = wipe
      ? `WIPE & remove ${u.name}? This permanently deletes them AND all of their tasks. This cannot be undone.`
      : `Remove ${u.name}? Their tasks are kept, but they can no longer sign in.`;
    if (!confirm(msg)) return;
    await onDeleteUser(u.email, wipe);
  });
  const submitAlias = (email: string) => run(async () => {
    const v = (aliasInput[email] ?? '').trim();
    if (!v) return;
    await onAddAlias(email, v);
    setAliasInput((prev) => ({ ...prev, [email]: '' }));
  });

  // ─── Team page ───
  if (view === 'team' && isAdmin) {
    return (
      <div className="settings-page-overlay" onClick={onClose}>
        <div className="settings-page" onClick={(e) => e.stopPropagation()}>
          <div className="settings-page-header">
            <button className="back-btn" onClick={() => setView('menu')}>← Back</button>
            <h2 className="settings-page-title">Team</h2>
            <span className="header-spacer" />
          </div>

          <section className="settings-card">
            <div className="settings-card-label">Add a team member</div>
            <p className="muted card-help">
              Adding someone lets them sign in at tasks.esprey.net with their email (a one-time code on first login).
              They get their own private tasks; they only see what's shared with them. They also receive a welcome email.
            </p>
            <div className="settings-add-contact">
              <input className="text-input" placeholder="email@example.com" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} />
              <input className="text-input" placeholder="Display name (optional)" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} />
              <select className="select-input" value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value as UserRole })}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <button className="btn-primary sm" onClick={addUser} disabled={busy || !newUser.email.trim()}>Add member</button>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-label">Current members ({users.length})</div>
            {users.map((u) => {
              const isSelf = me?.email === u.email;
              return (
                <div key={u.email} className="member-card">
                  <div className="member-top">
                    <div className="member-name">
                      <strong>{u.name}</strong>
                      <span className="muted"> · {u.email}</span>
                      {u.role === 'admin' && <span className="badge-admin">ADMIN</span>}
                      {isSelf && <span className="badge-you">YOU</span>}
                    </div>
                    {!isSelf && (
                      <div className="settings-row-actions">
                        <button className="btn-secondary sm" onClick={() => removeUser(u, false)} disabled={busy}>Remove</button>
                        <button className="btn-danger" onClick={() => removeUser(u, true)} disabled={busy}>Wipe &amp; remove</button>
                      </div>
                    )}
                  </div>

                  <div className="member-aliases">
                    {(u.aliases ?? []).map((a) => (
                      <div key={a} className="alias-line">
                        <span className="alias-text">↳ {a}</span>
                        <button className="btn-secondary sm" onClick={() => onRemoveAlias(u.email, a)} disabled={busy}>Remove alias</button>
                      </div>
                    ))}
                    <div className="alias-add">
                      <input
                        className="text-input"
                        placeholder="add another email for this person"
                        value={aliasInput[u.email] ?? ''}
                        onChange={(e) => setAliasInput((prev) => ({ ...prev, [u.email]: e.target.value }))}
                        onKeyDown={(e) => e.key === 'Enter' && submitAlias(u.email)}
                      />
                      <button className="btn-secondary sm" onClick={() => submitAlias(u.email)} disabled={busy || !(aliasInput[u.email] ?? '').trim()}>+ Add</button>
                    </div>
                  </div>

                  {u.role === 'admin' ? (
                    <p className="muted member-companies-note">Admins can use all companies.</p>
                  ) : (
                    <div className="member-companies">
                      <span className="alias-label">Companies they can use</span>
                      <div className="company-allot-list">
                        {companies.filter((c) => c.name.trim().toLowerCase() !== 'personal').map((c) => {
                          const on = (u.company_ids ?? []).includes(c.id);
                          return (
                            <label key={c.id} className="checkbox-label">
                              <input
                                type="checkbox"
                                checked={on}
                                disabled={busy}
                                onChange={() => run(async () => {
                                  const current = u.company_ids ?? [];
                                  const next = on ? current.filter((x) => x !== c.id) : [...current, c.id];
                                  await onSetUserCompanies(u.email, next);
                                })}
                              />
                              {c.name}
                            </label>
                          );
                        })}
                      </div>
                      <span className="muted">Personal is always available.</span>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        </div>
      </div>
    );
  }

  // ─── Settings menu ───
  return (
    <div className="settings-page-overlay" onClick={onClose}>
      <div className="settings-page" onClick={(e) => e.stopPropagation()}>
        <div className="settings-page-header">
          <button className="back-btn" onClick={onClose}>← Back</button>
          <h2 className="settings-page-title">Settings</h2>
          <span className="header-spacer" />
        </div>
        {me && <p className="muted center">Signed in as {me.name} ({me.role})</p>}

        {me && (
          <section className="settings-card">
            <div className="settings-card-label">Your profile</div>
            <p className="muted" style={{ marginTop: 0 }}>This is the name other people see on your projects and tasks.</p>
            <div className="inline-add">
              <input
                className="text-input"
                placeholder="Your display name"
                value={myName}
                onChange={(e) => setMyName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveMyName()}
              />
              <button className="btn-primary sm" onClick={saveMyName} disabled={savingName || !myName.trim() || myName.trim() === me.name}>
                {savingName ? 'Saving…' : 'Save'}
              </button>
            </div>
          </section>
        )}

        {me && (
          <section className="settings-card">
            <div className="settings-card-label">Notifications</div>
            <p className="muted" style={{ marginTop: 0 }}>
              Get a pop-up when a task you assigned is completed, or when work you did is accepted or sent back. They appear while the app is open. On iPhone, add the app to your Home Screen first.
            </p>
            {notifStatus === 'unsupported' ? (
              <p className="muted">Your browser doesn't support notifications.</p>
            ) : notifStatus === 'granted' ? (
              <div className="settings-card-row">
                <span className="muted">✓ Notifications are on for this device.</span>
                <button className="btn-secondary sm" onClick={onTestNotification}>Send test</button>
              </div>
            ) : notifStatus === 'denied' ? (
              <p className="muted">Notifications are blocked — turn them back on for this site in your browser settings.</p>
            ) : (
              <button className="btn-primary" onClick={onEnableNotifications}>Turn on notifications</button>
            )}
          </section>
        )}

        {isAdmin && (
          <section className="settings-card">
            <div className="settings-card-label">Team</div>
            <div className="settings-card-row">
              <div><strong>Manage team members</strong> <span className="muted">· add or remove people who can sign in</span></div>
              <button className="btn-primary" onClick={() => setView('team')}>Open</button>
            </div>
          </section>
        )}

        {isAdmin && (
          <section className="settings-card">
            <div className="settings-card-label">Daily digest</div>
            <p className="muted" style={{ marginTop: 0 }}>
              Every morning the app automatically emails each person a summary of what's on their plate — items awaiting their sign-off, tasks assigned to them, and anything due soon. Anyone with nothing pending isn't emailed. The buttons below send it right now instead of waiting for the morning.
            </p>
            <div className="settings-card-row">
              <div><strong>Send everyone their digest now</strong> <span className="muted">· each person gets their own summary; people with nothing pending are skipped</span></div>
              <button className="btn-primary" onClick={() => runDigest(true)} disabled={digestBusy !== null}>
                {digestBusy === 'all' ? 'Sending…' : 'Send to everyone'}
              </button>
            </div>
            <div className="settings-card-row">
              <div><strong>Send me a preview</strong> <span className="muted">· emails only you, to see what it looks like</span></div>
              <button className="btn-secondary" onClick={() => runDigest(false)} disabled={digestBusy !== null}>
                {digestBusy === 'me' ? 'Sending…' : 'Send to me'}
              </button>
            </div>
            {digestMsg && <p className="muted center" style={{ marginTop: 8 }}>{digestMsg}</p>}
          </section>
        )}

        {/* Companies */}
        <section className="settings-card">
          <div className="settings-card-label">Companies</div>
          {companies.length === 0 ? <p className="muted">No companies yet.</p> : (
            <ul className="settings-list">
              {companies.map((c) => (
                <li key={c.id} className="settings-row">
                  {editingCompanyId === c.id ? (
                    <div className="inline-add full">
                      <input className="text-input" value={editingCompanyName} onChange={(e) => setEditingCompanyName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveCompany()} autoFocus />
                      <button className="btn-primary sm" onClick={saveCompany} disabled={busy}>Save</button>
                      <button className="btn-secondary sm" onClick={() => setEditingCompanyId(null)}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <span className="settings-row-name">{c.name}</span>
                      {isAdmin && (
                        <div className="settings-row-actions">
                          <button className="link-btn" onClick={() => { setEditingCompanyId(c.id); setEditingCompanyName(c.name); }}>Edit</button>
                          <button className="link-btn danger" onClick={() => removeCompany(c)} disabled={busy}>Delete</button>
                        </div>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {isAdmin && (
            <div className="inline-add mt">
              <input className="text-input" placeholder="New company name" value={newCompany} onChange={(e) => setNewCompany(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCompany()} />
              <button className="btn-primary sm" onClick={addCompany} disabled={busy || !newCompany.trim()}>Add</button>
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
