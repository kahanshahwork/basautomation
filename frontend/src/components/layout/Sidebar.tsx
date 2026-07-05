import { useAppStore, type PageName, type NavStepStatus } from '../../store/appStore';
import styles from './Sidebar.module.css';

const MANAGEMENT: { page: PageName; label: string; icon: string }[] = [
  { page: 'clients',         label: 'Client Management', icon: '👥' },
  { page: 'consolidate',     label: 'Consolidate',       icon: '🧾' },
  { page: 'vendormemory',    label: 'Vendor Memory',     icon: '🧠' },
  { page: 'categorymanager', label: 'Category Manager',  icon: '📂' },
];

const WORKFLOW: { page: PageName; label: string; num: number }[] = [
  { page: 'parse',      label: 'Upload & Parse', num: 1 },
  { page: 'approve',    label: 'Approve',        num: 2 },
  { page: 'categorize', label: 'Categorize',     num: 3 },
  { page: 'gst',        label: 'GST Review',     num: 4 },
  { page: 'pnl',        label: 'P & L',          num: 5 },
];

const AI: { page: PageName; label: string; icon: string }[] = [
  { page: 'aicategorize', label: 'AI Categorize', icon: '🤖' },
  { page: 'aivision',     label: 'AI Vision',     icon: '👁️' },
];

interface Props { open: boolean; onClose: () => void; }

export function Sidebar({ open }: Props) {
  const { currentPage, setPage, navState } = useAppStore();

  function status(page: PageName): NavStepStatus {
    return (navState as unknown as Record<string, NavStepStatus>)[page] ?? 'active';
  }
  function locked(page: PageName) {
    return (['parse','approve','categorize','gst','pnl'] as PageName[]).includes(page)
      && status(page) === 'locked';
  }

  function nav(page: PageName) {
    if (locked(page)) return;
    setPage(page);
  }

  return (
    <nav className={`${styles.sidebar} ${open ? styles.open : styles.closed}`}>
      {/* Logo area */}
      <div className={styles.logoArea}>
        <div className={styles.mark}>DP</div>
        <div>
          <div className={styles.logoName}>DocParse</div>
          <div className={styles.logoSub}>BAS Automation Suite</div>
        </div>
      </div>

      <div className={styles.scroll}>
        {/* Management */}
        <div className={styles.section}>
          <p className={styles.sectionLabel}>Management</p>
          {MANAGEMENT.map(i => (
            <div key={i.page}
              className={`${styles.item} ${currentPage === i.page ? styles.active : ''}`}
              onClick={() => nav(i.page)}>
              <span className={styles.itemIcon}>{i.icon}</span>
              {i.label}
            </div>
          ))}
        </div>

        {/* Workflow */}
        <div className={styles.section}>
          <p className={styles.sectionLabel}>Workflow Steps</p>
          {WORKFLOW.map(i => {
            const isLocked = locked(i.page);
            const isDone   = status(i.page) === 'done';
            return (
              <div key={i.page}
                className={[styles.item, currentPage===i.page ? styles.active:'', isLocked ? styles.locked:'', isDone ? styles.done:''].filter(Boolean).join(' ')}
                onClick={() => nav(i.page)}>
                <span className={styles.stepNum}>{i.num}</span>
                {i.label}
                {isDone && <span className={styles.checkmark}>✓</span>}
              </div>
            );
          })}
        </div>

        {/* AI Tools */}
        <div className={styles.section}>
          <p className={styles.sectionLabel}>AI Tools</p>
          {AI.map(i => (
            <div key={i.page}
              className={`${styles.item} ${currentPage === i.page ? styles.active : ''}`}
              onClick={() => nav(i.page)}>
              <span className={styles.itemIcon}>{i.icon}</span>
              {i.label}
            </div>
          ))}
        </div>
      </div>

      <div className={styles.footer}>DocParse v5 · port 5051</div>
    </nav>
  );
}
