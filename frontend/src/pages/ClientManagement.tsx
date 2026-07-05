import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { advisorsApi, clientsApi, quartersApi, statementsApi, consolidationApi } from '../api/client';
import { showToast } from '../components/ui/Toast';
import { fmt } from '../utils/format';
import type { Advisor, Client, YearGroup, Quarter, Statement, BusinessType, ConsolidationSummary } from '../types';

/**
 * Client Management — dedicated multi-column sidebar layout (no expandable tree):
 *   Column 1: Advisors rail        — pick an advisor
 *   Column 2: Advisor workspace     — that advisor's clients; pick a client to reveal
 *                                     its FY -> Quarter nav as a flat, sectioned list
 *   Main:     Quarter detail        — statements, merged statements, quick GST + P&L
 */
export function ClientManagementPage() {
  const { setClient, setQuarter, setPage, unlockNav, activeQuarterId } = useAppStore();

  const [advisors, setAdvisors] = useState<Advisor[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [years, setYears] = useState<YearGroup[]>([]);

  const [selAdvisor, setSelAdvisor] = useState<Advisor | null>(null);
  const [selClient, setSelClient] = useState<Client | null>(null);
  const [selQuarter, setSelQuarter] = useState<Quarter | null>(null);

  const [statements, setStatements] = useState<Statement[]>([]);
  const [summary, setSummary] = useState<ConsolidationSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [showAddAdvisor, setShowAddAdvisor] = useState(false);
  const [addClientFor, setAddClientFor] = useState<Advisor | null>(null);
  const [addQuarterFor, setAddQuarterFor] = useState<Client | null>(null);
  const [bizTypes, setBizTypes] = useState<BusinessType[]>([]);

  const loadAdvisors = useCallback(async () => { setAdvisors(await advisorsApi.list()); }, []);
  useEffect(() => { loadAdvisors(); }, [loadAdvisors]);
  useEffect(() => { clientsApi.businessTypes().then(setBizTypes); }, []);

  // ── Selection cascade ──────────────────────────────────────────────────
  const loadClients = useCallback(async (advisorId: number) => {
    setClients(await clientsApi.list(advisorId));
  }, []);

  const loadYears = useCallback(async (clientId: number) => {
    setYears(await clientsApi.years(clientId));
  }, []);

  async function selectAdvisor(a: Advisor) {
    setSelAdvisor(a);
    setSelClient(null); setSelQuarter(null); setSummary(null); setStatements([]); setYears([]);
    await loadClients(a.id);
  }

  async function selectClient(c: Client) {
    setSelClient(c);
    setSelQuarter(null); setSummary(null); setStatements([]);
    setClient(c.id, c.name);
    await loadYears(c.id);
  }

  const loadQuarterDetail = useCallback(async (qid: number) => {
    setStatements(await statementsApi.list(qid));
    setSummaryLoading(true);
    try { setSummary(await consolidationApi.quarterSummary(qid)); }
    catch { setSummary(null); }
    finally { setSummaryLoading(false); }
  }, []);

  async function selectQuarter(q: Quarter) {
    setSelQuarter(q);
    setQuarter(q.id, q.label);
    unlockNav('parse');
    await loadQuarterDetail(q.id);
  }

  // ── Deletes ────────────────────────────────────────────────────────────
  async function deleteAdvisor(a: Advisor) {
    const cc = a.client_count ?? 0;
    const msg = cc > 0
      ? `Delete advisor "${a.name}" and ALL ${cc} client(s) under them, including every quarter, statement and transaction? This cannot be undone.`
      : `Delete advisor "${a.name}"?`;
    if (!confirm(msg)) return;
    try {
      await advisorsApi.delete(a.id);
      if (selAdvisor?.id === a.id) { setSelAdvisor(null); setSelClient(null); setSelQuarter(null); setClients([]); setYears([]); setSummary(null); }
      await loadAdvisors();
      showToast('Advisor deleted', 'info');
    } catch (e) { showToast(e instanceof Error ? e.message : 'Failed to delete advisor', 'error'); }
  }

  async function deleteClient(c: Client) {
    if (!confirm(`Delete client "${c.name}" and ALL of its quarters, statements and transactions? This cannot be undone.`)) return;
    try {
      await clientsApi.delete(c.id);
      if (selClient?.id === c.id) { setSelClient(null); setSelQuarter(null); setYears([]); setSummary(null); }
      if (selAdvisor) await loadClients(selAdvisor.id);
      await loadAdvisors();
      showToast('Client deleted', 'info');
    } catch (e) { showToast(e instanceof Error ? e.message : 'Failed to delete client', 'error'); }
  }

  async function deleteQuarter(q: Quarter) {
    if (!confirm(`Delete quarter "${q.label}" and all its statements and transactions? This cannot be undone.`)) return;
    try {
      await quartersApi.delete(q.id);
      if (selQuarter?.id === q.id) { setSelQuarter(null); setSummary(null); setStatements([]); }
      if (selClient) await loadYears(selClient.id);
      showToast('Quarter deleted', 'info');
    } catch (e) { showToast(e instanceof Error ? e.message : 'Failed to delete quarter', 'error'); }
  }

  async function deleteStatement(id: number) {
    if (!confirm('Delete this statement and all its transactions?')) return;
    await statementsApi.delete(id).catch(() => {});
    if (selQuarter) await loadQuarterDetail(selQuarter.id);
    showToast('Statement deleted', 'info');
  }

  function goToParse() { if (selQuarter) setPage('parse'); }

  function resumeStatement(s: Statement) {
    useAppStore.getState().setStatement(s.id, s.statement_name || s.filename || `#${s.id}`, s.bank_id);
    unlockNav('approve', 'categorize', 'gst', 'pnl');
    setPage('parse');
  }

  const regular = statements.filter(s => s.bank_id !== 'consolidated');
  const merged = statements.filter(s => s.bank_id === 'consolidated');

  return (
    <div className="anim-up cm-shell">
      {/* ── COLUMN 1 — Advisors ─────────────────────────────────────────── */}
      <aside className="cm-rail cm-rail-advisors">
        <div className="cm-rail-hdr">
          <span>Advisors</span>
          <button className="btn-primary cm-mini-btn" onClick={() => setShowAddAdvisor(true)}>+ Advisor</button>
        </div>
        <div className="cm-rail-body">
          {advisors.length === 0 && (
            <div className="cm-empty-note">No advisors yet. Click <strong>+ Advisor</strong> to begin.</div>
          )}
          {advisors.map(a => (
            <div key={a.id} className={`cm-item ${selAdvisor?.id === a.id ? 'active' : ''}`} onClick={() => selectAdvisor(a)}>
              <span className="cm-avatar">{initials(a.name)}</span>
              <div className="cm-item-main">
                <div className="cm-item-title">{a.name}</div>
                {a.firm && <div className="cm-item-sub">{a.firm}</div>}
              </div>
              <span className="cm-count">{a.client_count ?? 0}</span>
              <button className="cm-del" title="Delete advisor" onClick={e => { e.stopPropagation(); deleteAdvisor(a); }}>×</button>
            </div>
          ))}
        </div>
      </aside>

      {/* ── COLUMN 2 — Advisor workspace (clients + FY/quarter nav) ──────── */}
      <aside className="cm-rail cm-rail-nav">
        {!selAdvisor ? (
          <div className="cm-rail-placeholder">Select an advisor</div>
        ) : (
          <>
            <div className="cm-rail-hdr">
              <span>{selAdvisor.name}</span>
              <button className="btn-primary cm-mini-btn" onClick={() => setAddClientFor(selAdvisor)}>+ Client</button>
            </div>
            <div className="cm-rail-body">
              {/* Clients */}
              <div className="cm-section-label">Clients</div>
              {clients.length === 0 && <div className="cm-empty-note">No clients yet — click <strong>+ Client</strong>.</div>}
              {clients.map(c => (
                <div key={c.id}>
                  <div className={`cm-item cm-item-client ${selClient?.id === c.id ? 'active' : ''}`} onClick={() => selectClient(c)}>
                    <span className="cm-avatar cm-avatar-sm">{initials(c.name)}</span>
                    <div className="cm-item-main">
                      <div className="cm-item-title">{c.name}</div>
                      <div className="cm-item-sub">{bizLabel(bizTypes, c.business_type)}</div>
                    </div>
                    <button className="cm-del" title="Delete client" onClick={e => { e.stopPropagation(); deleteClient(c); }}>×</button>
                  </div>

                  {/* FY -> Quarter nav appears inline under the selected client */}
                  {selClient?.id === c.id && (
                    <div className="cm-fy-block">
                      <div className="cm-fy-actions">
                        <button className="cm-link-btn" onClick={() => setAddQuarterFor(c)}>+ Quarter</button>
                      </div>
                      {years.length === 0 && <div className="cm-empty-note cm-indent">No quarters yet — click <strong>+ Quarter</strong>.</div>}
                      {years.map(yg => (
                        <div key={yg.year} className="cm-fy-group">
                          <div className="cm-fy-title">{yg.year} <span className="cm-count cm-count-sm">{yg.quarter_count}</span></div>
                          {yg.quarters.length === 0 && <div className="cm-empty-note cm-indent">No quarters</div>}
                          {yg.quarters.map(q => (
                            <div key={q.id} className={`cm-quarter ${activeQuarterId === q.id ? 'active' : ''}`} onClick={() => selectQuarter(q)}>
                              <span className="cm-q-dot" />
                              <span className="cm-q-label">{q.label}</span>
                              {q.period_start && <span className="cm-q-period">{q.period_start.slice(0, 10)}</span>}
                              <button className="cm-del" title="Delete quarter" onClick={e => { e.stopPropagation(); deleteQuarter(q); }}>×</button>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </aside>

      {/* ── MAIN — Quarter detail ───────────────────────────────────────── */}
      <div className="cm-detail">
        {!selQuarter ? (
          <div className="empty-state" style={{ height: '100%' }}>
            <div className="empty-icon">CM</div>
            <p className="empty-title">{!selAdvisor ? 'Pick an advisor to begin' : !selClient ? 'Pick a client' : 'Select a quarter'}</p>
            <p className="empty-sub">
              {!selAdvisor
                ? 'Choose an advisor on the far left, then a client, then a quarter.'
                : !selClient
                ? 'Choose a client from the list, then open a financial-year quarter.'
                : 'Open a quarter to see its statements, merged datasets and a live GST / P&L summary.'}
            </p>
          </div>
        ) : (
          <>
            <div className="page-hdr">
              <div className="page-hdr-left">
                <h1>{selClient?.name} - {selQuarter.label}</h1>
                <p>{selQuarter.year} - {selQuarter.period_start || '?'} to {selQuarter.period_end || '?'} - {regular.length} statement{regular.length === 1 ? '' : 's'}{merged.length ? ` - ${merged.length} merged` : ''}</p>
              </div>
              <div className="page-hdr-right">
                <button className="btn-primary" onClick={goToParse}>+ Add / Parse Statement</button>
              </div>
            </div>

            {/* Quick GST + P&L summary for the whole quarter */}
            <QuarterSummaryCards summary={summary} loading={summaryLoading} />

            {/* Regular statements */}
            <SectionLabel title="Statements" hint="Source bank statements & imports for this quarter" />
            {regular.length === 0 ? (
              <div className="empty-state" style={{ padding: '24px 0' }}>
                <div className="empty-icon">S</div>
                <p className="empty-title">No statements yet</p>
                <p className="empty-sub">Click "+ Add / Parse Statement" to upload a PDF or import CSV/Excel for this quarter.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {regular.map(s => (
                  <StatementRow key={s.id} s={s} onResume={() => resumeStatement(s)} onDelete={() => deleteStatement(s.id)} />
                ))}
              </div>
            )}

            {/* Merged / consolidated statements */}
            {merged.length > 0 && (
              <>
                <SectionLabel title="Merged Statements" hint="Combined datasets created from the Consolidate tab" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {merged.map(s => (
                    <StatementRow key={s.id} s={s} merged onResume={() => resumeStatement(s)} onDelete={() => deleteStatement(s.id)} />
                  ))}
                </div>
              </>
            )}

            {regular.length >= 2 && merged.length === 0 && (
              <div style={{ marginTop: 20, padding: 16, background: 'var(--surface-input)', borderRadius: 'var(--radius)', border: '1px dashed var(--border-default)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  You have {regular.length} statements in this quarter. Merge them into one combined dataset.
                </div>
                <button className="btn-secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }} onClick={() => setPage('consolidate')}>Open Consolidate →</button>
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
            if (selAdvisor?.id === a.id) await loadClients(a.id);
            await loadAdvisors();
          }} />
      )}
      {addQuarterFor && (
        <AddQuarterModal client={addQuarterFor} onClose={() => setAddQuarterFor(null)}
          onSaved={async () => {
            const c = addQuarterFor; setAddQuarterFor(null);
            if (selClient?.id === c.id) await loadYears(c.id);
          }} />
      )}
    </div>
  );
}

// ── Modals ──────────────────────────────────────────────────────────────
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

// ── Detail-pane helpers ───────────────────────────────────────────────────
function SectionLabel({ title, hint }: { title: string; hint?: string }) {
  return (
    <div style={{ margin: '22px 0 10px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
      {hint && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 1 }}>{hint}</div>}
    </div>
  );
}

function StatementRow({ s, merged, onResume, onDelete }: { s: Statement; merged?: boolean; onResume: () => void; onDelete: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
      border: `1px solid ${merged ? 'var(--brand-muted, var(--border-light))' : 'var(--border-light)'}`,
      borderRadius: 'var(--radius)', background: merged ? 'var(--brand-light)' : 'var(--surface-card)' }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--brand)', background: merged ? 'var(--surface-card)' : 'var(--brand-light)', padding: '3px 8px', borderRadius: 5, whiteSpace: 'nowrap' }}>
        {merged ? 'MERGED' : (s.bank_id || '?').toUpperCase()}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.statement_name || s.filename || `Statement #${s.id}`}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Added {s.created_at?.slice(0, 10) || '-'} - {s.txn_count ?? 0} transactions</div>
      </div>
      <span className={`badge ${statusBadge(s.status)}`}>{s.status}</span>
      <button className="btn-secondary" style={{ fontSize: 12 }} onClick={onResume}>Resume</button>
      <button className="btn-secondary" style={{ fontSize: 12, color: 'var(--red)', borderColor: 'rgba(239,68,68,.3)' }} onClick={onDelete}>Del</button>
    </div>
  );
}

function QuarterSummaryCards({ summary, loading }: { summary: ConsolidationSummary | null; loading: boolean }) {
  if (loading) {
    return <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '4px 0' }}>Loading summary…</div>;
  }
  if (!summary || summary.txn_count === 0) return null;

  const bas = summary.consolidated?.gst?.bas || ({} as Record<string, number>);
  const pnl = summary.consolidated?.pnl || ({} as { gross_net_profit?: number });
  const gstSales = bas['1A'] || 0;
  const gstPurch = bas['1B'] || 0;
  const netGst = gstSales - gstPurch;
  const netProfit = pnl.gross_net_profit ?? 0;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginTop: 4 }}>
      <SumTile label="Statements" val={String(summary.statement_count)} />
      <SumTile label="Transactions" val={String(summary.txn_count)} />
      <SumTile label="GST on Sales (1A)" val={fmt(gstSales)} mono />
      <SumTile label="GST on Purchases (1B)" val={fmt(gstPurch)} mono />
      <SumTile label={`Net GST ${netGst >= 0 ? 'Payable' : 'Refundable'}`} val={fmt(Math.abs(netGst))} mono color={netGst >= 0 ? 'var(--red)' : 'var(--green)'} />
      <SumTile label="Net Profit" val={fmt(netProfit)} mono color={netProfit >= 0 ? 'var(--green)' : 'var(--red)'} />
    </div>
  );
}

function SumTile({ label, val, mono, color }: { label: string; val: string; mono?: boolean; color?: string }) {
  return (
    <div className="stat-tile">
      <div className="stat-tile-val" style={{ fontFamily: mono ? 'var(--mono)' : undefined, color, fontSize: 18 }}>{val}</div>
      <div className="stat-tile-lbl">{label}</div>
    </div>
  );
}

function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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
