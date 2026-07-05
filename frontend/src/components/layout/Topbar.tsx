import { useAppStore } from '../../store/appStore';
import styles from './Topbar.module.css';

interface Props { onMenuClick: () => void; }

export function Topbar({ onMenuClick }: Props) {
  const { activeClientName, activeQuarterLabel, activeStatementId } = useAppStore();

  const now = new Date();
  const h = now.getHours();
  const greeting = h < 12 ? 'Good morning ☀️' : h < 17 ? 'Good afternoon 🌤️' : 'Good evening 🌆';
  const dateStr = now.toLocaleDateString('en-AU', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

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
      </div>
    </header>
  );
}
