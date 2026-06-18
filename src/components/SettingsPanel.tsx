import { useState } from 'react';
import type { Company, Contact, User, UserRole } from '../types';

interface Props {
  companies: Company[];
  contacts: Contact[];
  me: { email: string; name: string; role: UserRole } | null;
  users: User[];
  onClose: () => void;
  onCreateCompany: (name: string) => Promise<Company>;
  onRenameCompany: (id: string, name: string) => Promise<void>;
  onDeleteCompany: (id: string) => Promise<void>;
  onCreateContact: (data: { name: string; email?: string; company_id?: string; is_favourite?: boolean }) => Promise<Contact>;
  onUpdateContact: (id: string, data: { name?: string; email?: string | null; company_id?: string | null; is_favourite?: boolean }) => Promise<void>;
  onDeleteContact: (id: string) => Promise<void>;
  onCreateUser: (data: { name: string; email: string; role: UserRole }) => Promise<void>;
  onUpdateUser: (email: string, data: { name?: string; role?: UserRole }) => Promise<void>;
  onDeleteUser: (email: string, wipe?: boolean) => Promise<void>;
  onAddAlias: (email: string, alias: string) => Promise<void>;
  onRemoveAlias: (email: string, alias: string) => Promise<void>;
  onSetUserCompanies: (email: string, companyIds: string[]) => Promise<void>;
}

interface ContactDraft { name: string; email: string; company_id: string; }

export default function SettingsPanel(props: Props) {
  const {
    companies, contacts, me, users, onClose,
    onCreateCompany, onRenameCompany, onDeleteCompany,
    onCreateContact, onUpdateContact, onDeleteContact,
    onCreateUser, onDeleteUser, onAddAlias, onRemoveAlias, onSetUserCompanies,
  } = props;

  const isAdmin = me?.role === 'admin';
  const [view, setView] = useState<'menu' | 'team'>('menu');

  // Companies
  const [newCompany, setNewCompany] = useState('');
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [editingCompanyName, setEditingCompanyName] = useState('');

  // Contacts
  const [newContact, setNewContact] = useState<ContactDraft>({ name: '', email: '', company_id: '' });
  const [newContactFav, setNewContactFav] = useState(false);

  // Team
  const [newUser, setNewUser] = useState<{ name: string; email: string; role: UserRole }>({ name: '', email: '', role: 'member' });
  const [aliasInput, setAliasInput] = useState<Record<string, string>>({});

  const [busy, setBusy] = useState(false);
  const companyName = (id: string | null) => companies.find((c) => c.id === id)?.name ?? null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { alert(e instanceof Error ? e.message : 'Something went wrong'); } finally { setBusy(false); }
  };

  // ─── Companies ───
  const addCompany = () => run(async () => { if (!newCompany.trim()) return; await onCreateCompany(newCompany.trim()); setNewCompany(''); });
  const saveCompany = () => run(async () => { if (!editingCompanyName.trim() || !editingCompanyId) return; await onRenameCompany(editingCompanyId, editingCompanyName.trim()); setEditingCompanyId(null); });
  const removeCompany = (c: Company) => run(async () => { if (!confirm(`Delete "${c.name}"? Tasks keep the name but lose the link.`)) return; await onDeleteCompany(c.id); });

  // ─── Contacts ───
  const addContact = () => run(async () => {
    if (!newContact.name.trim()) return;
    await onCreateContact({ name: newContact.name.trim(), email: newContact.email.trim() || undefined, company_id: newContact.company_id || undefined, is_favourite: newContactFav });
    setNewContact({ name: '', email: '', company_id: '' }); setNewContactFav(false);
  });
  const toggleFav = (c: Contact) => run(() => onUpdateContact(c.id, { is_favourite: c.is_favourite !== 1 }));
  const removeContact = (c: Contact) => run(async () => { if (!confirm(`Delete "${c.name}"? Tasks keep the name but lose the link.`)) return; await onDeleteContact(c.id); });

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

        {isAdmin && (
          <section className="settings-card">
            <div className="settings-card-label">Team</div>
            <div className="settings-card-row">
              <div><strong>Manage team members</strong> <span className="muted">· add or remove people who can sign in</span></div>
              <button className="btn-primary" onClick={() => setView('team')}>Open</button>
            </div>
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
                      <div className="settings-row-actions">
                        <button className="link-btn" onClick={() => { setEditingCompanyId(c.id); setEditingCompanyName(c.name); }}>Edit</button>
                        <button className="link-btn danger" onClick={() => removeCompany(c)} disabled={busy}>Delete</button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="inline-add mt">
            <input className="text-input" placeholder="New company name" value={newCompany} onChange={(e) => setNewCompany(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCompany()} />
            <button className="btn-primary sm" onClick={addCompany} disabled={busy || !newCompany.trim()}>Add</button>
          </div>
        </section>

        {/* Contacts */}
        <section className="settings-card">
          <div className="settings-card-label">Contacts</div>
          <p className="muted card-help">External people you can tag on a task for reference. They don't sign in or take part in tasks.</p>
          <div className="settings-add-contact">
            <input className="text-input" placeholder="Name" value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} />
            <input className="text-input" placeholder="Email (optional)" value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} />
            <select className="select-input" value={newContact.company_id} onChange={(e) => setNewContact({ ...newContact, company_id: e.target.value })}>
              <option value="">No company</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <label className="checkbox-label"><input type="checkbox" checked={newContactFav} onChange={(e) => setNewContactFav(e.target.checked)} />Favourite</label>
            <button className="btn-primary sm" onClick={addContact} disabled={busy || !newContact.name.trim()}>Add</button>
          </div>
          {contacts.length > 0 && (
            <ul className="settings-list">
              {contacts.map((c) => (
                <li key={c.id} className="settings-row">
                  <button className={`fav-star ${c.is_favourite === 1 ? 'on' : ''}`} onClick={() => toggleFav(c)} disabled={busy} title="Favourite">{c.is_favourite === 1 ? '★' : '☆'}</button>
                  <div className="settings-row-name">
                    <span>{c.name}</span>
                    <span className="settings-row-sub">{[c.email, companyName(c.company_id)].filter(Boolean).join(' · ') || '—'}</span>
                  </div>
                  <div className="settings-row-actions">
                    <button className="link-btn danger" onClick={() => removeContact(c)} disabled={busy}>Delete</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
