import { useState, useEffect, useCallback } from 'react';
import { adminApi, type AdminUser } from '../api/client';
import { useAppStore } from '../store/appStore';
import { showToast } from '../components/ui/Toast';

/** Admin panel — user management, role assignment, password reset. Admin only. */
export function AdminPage() {
  const { authUser } = useAppStore();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [resetFor, setResetFor] = useState<AdminUser | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    adminApi.listUsers().then(setUsers).catch(() => setUsers([])).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Client-side guard (server enforces it too). Non-admins never see data.
  if (authUser?.role !== 'admin') {
    return (
      <div className="empty-state" style={{ height: 300 }}>
        <div className="empty-icon">🔒</div>
        <p className="empty-title">Administrator access required</p>
        <p className="empty-sub">This area is restricted to admin accounts.</p>
      </div>
    );
  }

  async function toggleRole(u: AdminUser) {
    const next = u.role === 'admin' ? 'user' : 'admin';
    try { await adminApi.updateUser(u.id, { role: next }); showToast(`${u.email} is now ${next}`, 'success'); load(); }
    catch (e) { showToast(e instanceof Error ? e.message : 'Failed to change role', 'error'); }
  }

  async function toggleActive(u: AdminUser) {
    try { await adminApi.updateUser(u.id, { is_active: !u.is_active }); showToast(`${u.email} ${u.is_active ? 'deactivated' : 'activated'}`, 'info'); load(); }
    catch (e) { showToast(e instanceof Error ? e.message : 'Failed to update', 'error'); }
  }

  async function remove(u: AdminUser) {
    if (!confirm(`Delete user "${u.email}"? This cannot be undone.`)) return;
    try { await adminApi.deleteUser(u.id); showToast('User deleted', 'info'); load(); }
    catch (e) { showToast(e instanceof Error ? e.message : 'Failed to delete', 'error'); }
  }

  return (
    <div className="anim-up">
      <div className="page-hdr">
        <div className="page-hdr-left">
          <h1>Admin — User Management</h1>
          <p>{users.length} user{users.length === 1 ? '' : 's'} · manage access, roles and passwords</p>
        </div>
        <div className="page-hdr-right">
          <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Add User</button>
        </div>
      </div>

      <div className="card">
        {loading ? <div className="empty-state"><p className="empty-sub">Loading…</p></div> : (
          <div className="vw-table-wrap">
            <table className="vw-table">
              <thead>
                <tr>
                  <th>Email</th><th>Name</th><th>Role</th>
                  <th style={{ textAlign: 'center' }}>Status</th>
                  <th>Last login</th><th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const isSelf = u.id === authUser?.id;
                  return (
                    <tr key={u.id} style={{ cursor: 'default' }}>
                      <td style={{ fontWeight: 600 }}>{u.email}{isSelf && <span className="badge badge-blue" style={{ marginLeft: 8, fontSize: 9 }}>you</span>}</td>
                      <td>{u.name || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                      <td><span className={`badge ${u.role === 'admin' ? 'badge-purple' : 'badge-gray'}`}>{u.role}</span></td>
                      <td style={{ textAlign: 'center' }}>
                        <span className={`badge ${u.is_active ? 'badge-green' : 'badge-red'}`}>{u.is_active ? 'active' : 'disabled'}</span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{u.last_login ? String(u.last_login).slice(0, 16).replace('T', ' ') : 'never'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          <button className="btn-ghost" style={{ fontSize: 11.5, padding: '4px 8px' }} onClick={() => toggleRole(u)} disabled={isSelf} title={isSelf ? "You can't change your own role" : ''}>
                            {u.role === 'admin' ? '↓ Make user' : '↑ Make admin'}
                          </button>
                          <button className="btn-ghost" style={{ fontSize: 11.5, padding: '4px 8px' }} onClick={() => toggleActive(u)} disabled={isSelf} title={isSelf ? "You can't disable yourself" : ''}>
                            {u.is_active ? 'Disable' : 'Enable'}
                          </button>
                          <button className="btn-ghost" style={{ fontSize: 11.5, padding: '4px 8px', color: 'var(--brand)' }} onClick={() => setResetFor(u)}>Reset PW</button>
                          <button className="btn-ghost" style={{ fontSize: 11.5, padding: '4px 8px', color: 'var(--red)' }} onClick={() => remove(u)} disabled={isSelf}>🗑</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
      {resetFor && <ResetModal user={resetFor} onClose={() => setResetFor(null)} onDone={() => setResetFor(null)} />}
    </div>
  );
}

function AddUserModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!email.includes('@')) { showToast('Enter a valid email', 'error'); return; }
    if (password.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }
    setBusy(true);
    try { await adminApi.addUser({ email: email.trim(), name: name.trim(), password, role }); showToast('User created', 'success'); onSaved(); }
    catch (e) { showToast(e instanceof Error ? e.message : 'Failed to create user', 'error'); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 420 }}>
        <h3>Add User</h3>
        <label className="vw-label">Email *</label>
        <input className="vw-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="user@company.com" autoFocus />
        <label className="vw-label" style={{ marginTop: 10 }}>Name</label>
        <input className="vw-input" value={name} onChange={e => setName(e.target.value)} placeholder="Full name" />
        <label className="vw-label" style={{ marginTop: 10 }}>Temporary Password *</label>
        <input className="vw-input" type="text" value={password} onChange={e => setPassword(e.target.value)} placeholder="min 6 characters" />
        <label className="vw-label" style={{ marginTop: 10 }}>Role</label>
        <select className="vw-select" value={role} onChange={e => setRole(e.target.value as 'admin' | 'user')}>
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Create User'}</button>
        </div>
      </div>
    </div>
  );
}

function ResetModal({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (pw.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }
    setBusy(true);
    try { await adminApi.resetPassword(user.id, pw); showToast(`Password reset for ${user.email}`, 'success'); onDone(); }
    catch (e) { showToast(e instanceof Error ? e.message : 'Failed to reset', 'error'); }
    finally { setBusy(false); }
  }
  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 400 }}>
        <h3>Reset Password</h3>
        <p className="modal-sub">Set a new password for <strong>{user.email}</strong>. They'll be signed out of all sessions and must log in again.</p>
        <label className="vw-label">New Password</label>
        <input className="vw-input" type="text" value={pw} onChange={e => setPw(e.target.value)} placeholder="min 6 characters" autoFocus />
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Resetting…' : 'Reset Password'}</button>
        </div>
      </div>
    </div>
  );
}
