import { useState } from 'react';
import { authApi } from '../api/client';
import { useAppStore } from '../store/appStore';
import { showToast } from '../components/ui/Toast';

/** Full-screen login gate. Shown until a valid session is established. */
export function LoginPage() {
  const { setAuthUser } = useAppStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!email.trim() || !password) { setErr('Enter your email and password'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await authApi.login(email.trim(), password);
      setAuthUser(r.user);
      showToast(`Welcome, ${r.user.name || r.user.email}`, 'success');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Login failed');
    } finally { setBusy(false); }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-input)', padding: 20 }}>
      <div className="card card-pad" style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{ width: 42, height: 42, borderRadius: 11, background: 'var(--brand)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16 }}>DP</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>DocParse</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>BAS Automation Suite</div>
          </div>
        </div>

        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Sign in</h3>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 16 }}>Enter your credentials to continue.</p>

        <label className="vw-label">Email</label>
        <input className="vw-input" type="email" value={email} autoFocus
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          placeholder="you@company.com" />

        <label className="vw-label" style={{ marginTop: 12 }}>Password</label>
        <input className="vw-input" type="password" value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          placeholder="••••••••" />

        {err && <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--red)', background: '#FEF2F2', border: '1px solid rgba(239,68,68,.25)', borderRadius: 8, padding: '8px 12px' }}>{err}</div>}

        <button className="btn-primary" style={{ width: '100%', marginTop: 18, justifyContent: 'center' }} disabled={busy} onClick={submit}>
          {busy ? 'Signing in…' : 'Sign In'}
        </button>
      </div>
    </div>
  );
}
