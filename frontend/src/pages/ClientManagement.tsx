import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { advisorsApi, clientsApi, quartersApi, statementsApi } from '../api/client';
import { showToast } from '../components/ui/Toast';
import type { Advisor, Client, YearGroup, Quarter, Statement, BusinessType } from '../types';

/**
 * Client Management — hierarchical sidebar navigation:
 *   Advisor > Client > Year (AU FY) > Quarter
 * Left rail is a collapsible tree; the right pane shows the selected quarter's
 * statements and the entry point into the parse -> approve -> ... workflow.
 */
export function ClientManagementPage() {
  const { setClient, setQuarter, setPage, unlockNav, activeQuarterId } = useAppStore();

  const [advisors, setAdvisors] = useState<Advisor[]>([]);
  const [clientsByAdvisor, setClientsByAdvisor] = useState<Record<number, Client[]>>({});
  const [yearsByClient, setYearsByClient] = useState<Record<number, YearGroup[]>>({});

  const [openAdvisors, setOpenAdvisors] = useState<Set<number>>(new Set());
  const [openClients, setOpenClients] = useState<Set<number>>(new Set());
  const [openYears, setOpenYears] = useState<Set<string>>(new Set());

  const [selQuarter, setSelQuarter] = useState<Quarter | null>(null);
  const [selClient, setSelClient] = useState<Client | null>(null);
  const [statements, setStatements] = useState<Statement[]>([]);

  const [showAddAdvisor, setShowAddAdvisor] = useState(false);
  const [addClientFor, setAddClientFor] = useState<Advisor | null>(null);
  const [addQuarterFor, setAddQuarterFor] = useState<Client | null>(null);
  const [bizTypes, setBizTypes] = useState<BusinessType[]>([]);

  const loadAdvisors = useCallback(async () => { setAdvisors(await advisorsApi.list()); }, []);
  useEffect(() => { loadAdvisors(); }, [loadAdvisors]);
  useEffect(() => { clientsApi.businessTypes().then(setBizTypes); }, []);

  async function toggleAdvisor(a: Advisor) {
    const next = new Set(openAdvisors);
    if (next.has(a.id)) next.delete(a.id);
    else {
      next.add(a.id);
      if (!clientsByAdvisor[a.id]) {
        const cs = await clientsApi.list(a.id);
        setClientsByAdvisor(prev => ({ ...prev, [a.id]: cs }));
      }
    }
    setOpenAdvisors(next);
  }

  async function toggleClient(c: Client) {
    const next = new Set(openClients);
    if (next.has(c.id)) next.delete(c.id);
    else {
      next.add(c.id);
      if (!yearsByClient[c.id]) {
        const ys = await clientsApi.years(c.id);
        setYearsByClient(prev => ({ ...prev, [c.id]: ys }));
      }
    }
    setOpenClients(next);
  }

  function toggleYear(clientId: number, year: string) {
    const key = `${clientId}:${year}`;
    const next = new Set(openYears);
    next.has(key) ? next.delete(key) : next.add(key);
    setOpenYears(next);
  }

  async function selectQuarter(c: Client, q: Quarter) {
    setSelClient(c); setSelQuarter(q);
    setClient(c.id, c.name);
    setQuarter(q.id, q.label);
    unlockNav('parse');
    setStatements(await statementsApi.list(q.id));
  }

  async function refreshClientYears(clientId: number) {
    const ys = await clientsApi.years(clientId);
    setYearsByClient(prev => ({ ...prev, [clientId]: ys }));
  }

  function goToParse() { if (selQuarter) setPage('parse'); }

  async function deleteStatement(id: number) {
    if (!confirm('Delete this statement and all its transactions?')) return;
    await statementsApi.delete(id).catch(() => {});
    if (selQuarter) setStatements(await statementsApi.list(selQuarter.id));
    showToast('Statement deleted', 'info');
  }

  function resumeStatement(s: Statement) {
    useAppStore.getState().setStatement(s.id, s.statement_name || s.filename || `#${s.id}`, s.bank_id);
    unlockNav('approve', 'categorize', 'gst', 'pnl');
    setPage('parse');
  }

  return (
    <div className="anim-up" style={{ display: 'flex', gap: 0, height: 'calc(100vh - var(--topbar-h) - 40px)' }}>
      {/* LEFT: Navigation tree */}
      <div style={{ width: 320, flexShrink: 0, borderRight: '1px solid var(--border-light)', background: 'var(--surface-card)', borderRadius: 'var(--radius-lg) 0 0 var(--radius-lg)', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid var(--border-light)' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Advisors</span>
          <button className="btn-primary" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => setShowAddAdvisor(true)}>+ Advisor</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {advisors.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}>
              No advisors yet. Click <strong>+ Advisor</strong> to begin.
            </div>
          )}
          {advisors.map(a => (
            <div key={a.id}>
              <TreeRow depth={0} open={openAdvisors.has(a.id)} onToggle={() => toggleAdvisor(a)}
                icon="A" label={a.name} sub={a.firm || undefined} badge={a.client_count}
                actionLabel="+ Client" onAction={() => setAddClientFor(a)} />
              {openAdvisors.has(a.id) && (clientsByAdvisor[a.id] || []).map(c => (
                <div key={c.id}>
                  <TreeRow depth={1} open={openClients.has(c.id)} onToggle={() => toggleClient(c)}
                    icon="C" label={c.name} sub={bizLabel(bizTypes, c.business_type)}
                    actionLabel="+ Quarter" onAction={() => setAddQuarterFor(c)} />
                  {openClients.has(c.id) && (yearsByClient[c.id] || []).map(yg => {
                    const yKey = `${c.id}:${yg.year}`;
                    return (
                      <div key={yKey}>
                        <TreeRow depth={2} open={openYears.has(yKey)} onToggle={() => toggleYear(c.id, yg.year)}
                          icon="Y" label={yg.year} badge={yg.quarter_count} />
                        {openYears.has(yKey) && yg.quarters.map(q => (
                          <div key={q.id} onClick={() => selectQuarter(c, q)}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '6px 8px 6px 62px', borderRadius: 7, fontSize: 12.5,
                              background: activeQuarterId === q.id ? 'var(--brand-light)' : 'transparent',
                              color: activeQuarterId === q.id ? 'var(--brand)' : 'var(--text-secondary)',
                              fontWeight: activeQuarterId === q.id ? 700 : 500 }}>
                            <span style={{ fontSize: 11 }}>-</span>{q.label}
                          </div>
                        ))}
                        {openYears.has(yKey) && yg.quarters.length === 0 && (
                          <div style={{ padding: '4px 8px 4px 62px', fontSize: 11.5, color: 'var(--text-muted)' }}>No quarters</div>
                        )}
                      </div>
                    );
                  })}
                  {openClients.has(c.id) && (yearsByClient[c.id] || []).length === 0 && (
                    <div style={{ padding: '6px 8px 6px 46px', fontSize: 11.5, color: 'var(--text-muted)' }}>
                      No quarters yet - click <strong>+ Quarter</strong>.
                    </div>
                  )}
                </div>
              ))}
              {openAdvisors.has(a.id) && (clientsByAdvisor[a.id] || []).length === 0 && (
                <div style={{ padding: '6px 8px 6px 30px', fontSize: 11.5, color: 'var(--text-muted)' }}>
                  No clients yet - click <strong>+ Client</strong>.
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* RIGHT: Detail pane */}
      <div style={{ flex: 1, background: 'var(--surface-card)', borderRadius: '0 var(--radius-lg) var(--radius-lg) 0', border: '1px solid var(--border-light)', borderLeft: 'none', overflowY: 'auto', padding: 24 }}>
        {!selQuarter ? (
          <div className="empty-state" style={{ height: '100%' }}>
            <div className="empty-icon">CM</div>
            <p className="empty-title">Select a quarter</p>
            <p className="empty-sub">Pick an advisor, client, year, then quarter from the left to see its statements and start the workflow.</p>
          </div>
        ) : (
          <>
            <div className="page-hdr">
              <div className="page-hdr-left">
                <h1>{selClient?.name} - {selQuarter.label}</h1>
                <p>{selQuarter.year} - {selQuarter.period_start || '?'} to {selQuarter.period_end || '?'} - {statements.length} statement{statements.length === 1 ? '' : 's'}</p>
              </div>
              <div className="page-hdr-right">
                <button className="btn-primary" onClick={goToParse}>+ Add / Parse Statement</button>
              </div>
            </div>

            {statements.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">S</div>
                <p className="empty-title">No statements yet</p>
                <p className="empty-sub">Click "+ Add / Parse Statement" to upload a PDF or import CSV/Excel for this quarter.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {statements.map(s => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', border: '1px solid var(--border-light)', borderRadius: 'var(--radius)', background: 'var(--surface-card)' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--brand)', background: 'var(--brand-light)', padding: '3px 8px', borderRadius: 5 }}>{(s.bank_id || '?').toUpperCase()}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{s.statement_name || s.filename || `Statement #${s.id}`}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Added {s.created_at?.slice(0, 10) || '-'} - {s.txn_count ?? 0} transactions</div>
                    </div>
                    <span className={`badge ${statusBadge(s.status)}`}>{s.status}</span>
                    <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => resumeStatement(s)}>Resume</button>
                    <button className="btn-secondary" style={{ fontSize: 12, color: 'var(--red)', borderColor: 'rgba(239,68,68,.3)' }} onClick={() => deleteStatement(s.id)}>Del</button>
                  </div>
                ))}
              </div>
            )}

            {statements.length >= 2 && (
              <div style={{ marginTop: 20, padding: 16, background: 'var(--surface-input)', borderRadius: 'var(--radius)', border: '1px dashed var(--border-default)' }}>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  You have {statements.length} statements in this quarter. Use the <strong>Consolidate</strong> tab to merge them into one combined dataset.
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showAddAdvisor && <AddAdvisorModal onClose={() => setShowAddAdvisor(false)} onSaved={async () => { setShowAddAdvisor(false); await loadAdvisors(); }} />}
      {addClientFor && (
        <AddClientModal advisor={addClientFor} bizTypes={bizTypes} onClose={() => setAddClientFor(null)}
          onSaved={async () => {
            const a = addClientFor; setAddClientFor(null);
            const cs = await clientsApi.list(a.id);
            setClientsByAdvisor(prev => ({ ...prev, [a.id]: cs }));
            setOpenAdvisors(prev => new Set(prev).add(a.id));
            await loadAdvisors();
          }} />
      )}
      {addQuarterFor && (
        <AddQuarterModal client={addQuarterFor} onClose={() => setAddQuarterFor(null)}
          onSaved={async () => {
            const c = addQuarterFor; setAddQuarterFor(null);
            await refreshClientYears(c.id);
            setOpenClients(prev => new Set(prev).add(c.id));
          }} />
      )}
    </div>
  );
}

function TreeRow({ depth, open, onToggle, icon, label, sub, badge, actionLabel, onAction }: {
  depth: number; open: boolean; onToggle: () => void;
  icon: string; label: string; sub?: string; badge?: number;
  actionLabel?: string; onAction?: () => void;
}) {
  const padLeft = 8 + depth * 18;
  return (
    <div onClick={onToggle} className="tree-row"
      style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', padding: `7px 8px 7px ${padLeft}px`, borderRadius: 7 }}>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 10 }}>{open ? 'v' : '>'}</span>
      <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--brand)', background: 'var(--brand-light)', borderRadius: 4, padding: '1px 5px' }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
        {sub && <div style={{ fontSize: 10.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
      </div>
      {badge != null && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--surface-input)', padding: '1px 6px', borderRadius: 9 }}>{badge}</span>}
      {actionLabel && onAction && (
        <button onClick={e => { e.stopPropagation(); onAction(); }}
          style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--brand)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 4px', whiteSpace: 'nowrap' }}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 460 }}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function AddAdvisorModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [firm, setFirm] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!name.trim()) { showToast('Advisor name is required', 'error'); return; }
    setBusy(true);
    try { await advisorsApi.create(name.trim(), firm.trim() || undefined, email.trim() || undefined); showToast('Advisor added', 'success'); onSaved(); }
    catch { showToast('Failed to add advisor', 'error'); } finally { setBusy(false); }
  }
  return (
    <Modal title="Add Advisor" onClose={onClose}>
      <label className="vw-label">Advisor Name *</label>
      <input className="vw-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Jane Smith" autoFocus />
      <label className="vw-label" style={{ marginTop: 10 }}>Firm</label>
      <input className="vw-input" value={firm} onChange={e => setFirm(e.target.value)} placeholder="e.g. ABC Accounting" />
      <label className="vw-label" style={{ marginTop: 10 }}>Email</label>
      <input className="vw-input" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@abc.com" />
      <div className="modal-footer">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving...' : 'Add Advisor'}</button>
      </div>
    </Modal>
  );
}

function AddClientModal({ advisor, bizTypes, onClose, onSaved }: { advisor: Advisor; bizTypes: BusinessType[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [biz, setBiz] = useState(bizTypes[0]?.code || 'RETAIL_TRADING');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!name.trim()) { showToast('Client name is required', 'error'); return; }
    setBusy(true);
    try { await clientsApi.create(name.trim(), biz, advisor.id); showToast('Client added', 'success'); onSaved(); }
    catch { showToast('Failed to add client', 'error'); } finally { setBusy(false); }
  }
  return (
    <Modal title={`Add Client under ${advisor.name}`} onClose={onClose}>
      <label className="vw-label">Client Name *</label>
      <input className="vw-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Acme Pty Ltd" autoFocus />
      <label className="vw-label" style={{ marginTop: 10 }}>Business Type</label>
      <select className="vw-select" value={biz} onChange={e => setBiz(e.target.value)}>
        {bizTypes.map(b => <option key={b.code} value={b.code}>{b.label}</option>)}
      </select>
      <div className="modal-footer">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving...' : 'Add Client'}</button>
      </div>
    </Modal>
  );
}

function AddQuarterModal({ client, onClose, onSaved }: { client: Client; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState('Q1');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!label.trim()) { showToast('Quarter label is required', 'error'); return; }
    setBusy(true);
    try { await quartersApi.create(client.id, label.trim(), start, end); showToast('Quarter added', 'success'); onSaved(); }
    catch { showToast('Failed to add quarter', 'error'); } finally { setBusy(false); }
  }
  return (
    <Modal title={`Add Quarter for ${client.name}`} onClose={onClose}>
      <label className="vw-label">Quarter Label *</label>
      <select className="vw-select" value={label} onChange={e => setLabel(e.target.value)}>
        <option>Q1</option><option>Q2</option><option>Q3</option><option>Q4</option>
      </select>
      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <div style={{ flex: 1 }}>
          <label className="vw-label">Period Start</label>
          <input className="vw-input" type="date" value={start} onChange={e => setStart(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="vw-label">Period End</label>
          <input className="vw-input" type="date" value={end} onChange={e => setEnd(e.target.value)} />
        </div>
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>The financial year (e.g. FY 2024-25) is derived automatically from the start date.</p>
      <div className="modal-footer">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving...' : 'Add Quarter'}</button>
      </div>
    </Modal>
  );
}

function bizLabel(types: BusinessType[], code: string): string {
  return types.find(t => t.code === code)?.label || code;
}
function statusBadge(status: string): string {
  switch (status) {
    case 'finalized': return 'badge-green';
    case 'gst_reviewed':
    case 'categorized': return 'badge-blue';
    case 'approved': return 'badge-amber';
    default: return 'badge-gray';
  }
}
