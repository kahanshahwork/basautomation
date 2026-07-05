import { useAppStore } from '../../store/appStore';
import { authApi } from '../../api/client';
import { showToast } from '../ui/Toast';
import styles from './Topbar.module.css';

interface Props { onMenuClick: () => void; }

export function Topbar({ onMenuClick }: Props) {
  const { activeClientName, activeQuarterLabel, activeStatementId, authUser, setAuthUser } = useAppStore();

  const now = new Date();
  const h = now.getHours();
  const greeting = h < 12 ? 'Good morning ☀️' : h < 17 ? 'Good afternoon 🌤️' : 'Good evening 🌆';
  const dateStr = now.toLocaleDateString('en-AU', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

  async function logout() {
    try { await authApi.logout(); } catch { /* ignore */ }
    setAuthUser(null);
    showToast('Signed out', 'info');
  }

  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        <button className={styles.hamburger} onClick={onMenuClick} aria-label="Menu">
          <span /><span /><span />
        </button>
        <div className={styles.logo}>
          <div className={styles.mark}>DP</div>
          <span className={styles.logoName}>DocParse</span>
        </div>
        {activeClientName && (
          <div className={styles.breadcrumb}>
            <span className={styles.breadSep}>·</span>
            <span className={styles.breadItem}>{activeClientName}</span>
            {activeQuarterLabel && <>
              <span className={styles.breadSep}>›</span>
              <span className={styles.breadItem}>{activeQuarterLabel}</span>
            </>}
            {activeStatementId && <>
              <span className={styles.breadSep}>›</span>
              <span className={styles.breadItem}>Stmt #{activeStatementId}</span>
            </>}
          </div>
        )}
      </div>
      <div className={styles.right}>
        <div className={styles.greet}>
          <p className={styles.greetText}>{greeting}</p>
          <p className={styles.greetDate}>{dateStr}</p>
        </div>
        {authUser && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 14, marginLeft: 4, borderLeft: '1px solid var(--border-light)' }}>
            <div style={{ textAlign: 'right', lineHeight: 1.2 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{authUser.name || authUser.email}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{authUser.role}</div>
            </div>
            <button className="btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }} onClick={logout}>Sign out</button>
          </div>
        )}
      </div>
    </header>
  );
}
