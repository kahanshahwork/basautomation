import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import {
  clientsApi, statementsApi, consolidationApi,
} from '../api/client';
import { showToast } from '../components/ui/Toast';
import { fmt } from '../utils/format';
import type {
  Statement, YearGroup,
  ConsolidationSummary, AnnualConsolidation, ConsolidatedData,
} from '../types';

type Tab = 'merge' | 'quarter' | 'yearly';

/**
 * Consolidate — three modes:
 *   merge   : physically merge >=2 statements in a quarter into one new statement (name required)
 *   quarter : live combined GST + P&L across all statements in a quarter (report only)
 *   yearly  : combined GST + P&L across multiple quarters (report only)
 */
export function ConsolidatePage() {
  const { activeQuarterId, activeQuarterLabel, activeClientId, activeClientName, setPage, setStatement, unlockNav } = useAppStore();
  const [tab, setTab] = useState<Tab>('merge');

  return (
    <div className="anim-up">
      <div className="page-hdr">
        <div className="page-hdr-left">
          <h1>Consolidate</h1>
          <p>Merge statements, or build combined GST &amp; P&amp;L across a quarter or full year.</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, borderBottom: '1px solid var(--border-light)' }}>
        {([['merge', '🔗 Merge Statements'], ['quarter', '📊 Quarter BAS'], ['yearly', '📅 Yearly BAS']] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'none',
              border: 'none', borderBottom: `2px solid ${tab === t ? 'var(--brand)' : 'transparent'}`,
              color: tab === t ? 'var(--brand)' : 'var(--text-secondary)', fontFamily: 'var(--sans)',
            }}>{label}</button>
        ))}
      </div>

      {tab === 'merge' && (
        <MergeTab
          quarterId={activeQuarterId} quarterLabel={activeQuarterLabel} clientName={activeClientName}
          onMerged={(sid, name) => { setStatement(sid, name, 'consolidated'); unlockNav('approve', 'categorize', 'gst', 'pnl'); setPage('approve'); }}
        />
      )}
      {tab === 'quarter' && <QuarterBasTab quarterId={activeQuarterId} quarterLabel={activeQuarterLabel} clientName={activeClientName} />}
      {tab === 'yearly' && <YearlyBasTab clientId={activeClientId} clientName={activeClientName} />}
    </div>
  );
}

// ── MERGE TAB ──────────────────────────────────────────────────────────────
function MergeTab({ quarterId, quarterLabel, clientName, onMerged }: {
  quarterId: number | null; quarterLabel: string | null; clientName: string | null;
  onMerged: (statementId: number, name: string) => void;
}) {
  const { setStatement, unlockNav, setPage } = useAppStore();
  const [statements, setStatements] = useState<Statement[]>([]);
  const [mergedStatements, setMergedStatements] = useState<Statement[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!quarterId) return;
    const s = await statementsApi.list(quarterId);
    // Inputs = everything not already consolidated
    setStatements(s.filter(x => x.bank_id !== 'consolidated'));
    // Merged = the consolidated outputs, shown as their own section
    setMergedStatements(s.filter(x => x.bank_id === 'consolidated'));
  }, [quarterId]);

  useEffect(() => { load(); }, [load]);

  function openMerged(s: Statement) {
    setStatement(s.id, s.statement_name || s.filename || `#${s.id}`, 'consolidated');
    unlockNav('approve', 'categorize', 'gst', 'pnl');
    setPage('approve');
  }

  async function deleteMerged(id: number) {
    if (!confirm('Delete this merged statement? The original source statements are not affected.')) return;
    try { await statementsApi.delete(id); showToast('Merged statement deleted', 'info'); await load(); }
    catch { showToast('Failed to delete', 'error'); }
  }

  function toggle(id: number) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function merge() {
    if (!quarterId) return;
    if (selected.size < 2) { showToast('Select at least two statements', 'error'); return; }
    if (!name.trim()) { showToast('A name for the consolidated statement is required', 'error'); return; }
    setBusy(true);
    try {
      const r = await consolidationApi.mergeStatements(quarterId, [...selected], name.trim());
      if (r.error) throw new Error(r.error);
      showToast(`Merged into "${name}" (${r.txn_count} transactions)`, 'success');
      setSelected(new Set()); setName('');
      await load();
      onMerged(r.consolidated_statement_id!, name.trim());
    } catch (e) { showToast(e instanceof Error ? e.message : 'Merge failed', 'error'); }
    finally { setBusy(false); }
  }

  if (!quarterId) return <NeedQuarter />;

  return (
    <>
    <div className="card card-pad">
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{clientName} · {quarterLabel}</div>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>
          Select 2+ statements (PDF and/or Excel) to merge into one combined statement. Categories and GST already set on each are preserved.
        </p>
      </div>

      {statements.length === 0 ? (
        <div className="empty-state"><p className="empty-sub">No statements in this quarter yet.</p></div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {statements.map(s => (
              <label key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer',
                border: `1px solid ${selected.has(s.id) ? 'var(--brand)' : 'var(--border-light)'}`,
                background: selected.has(s.id) ? 'var(--brand-light)' : 'var(--surface-card)', borderRadius: 'var(--radius)',
              }}>
                <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--brand)', background: 'var(--surface-input)', padding: '3px 8px', borderRadius: 5 }}>{(s.bank_id || '?').toUpperCase()}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.statement_name || s.filename || `Statement #${s.id}`}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.txn_count ?? 0} transactions · {s.status}</div>
                </div>
              </label>
            ))}
          </div>

          <label className="vw-label">Consolidated Statement Name <span style={{ color: 'var(--red)' }}>*</span></label>
          <input className="vw-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Q1 FY25 — All Accounts Combined" />

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selected.size} selected</span>
            <button className="btn-primary" disabled={busy || selected.size < 2 || !name.trim()} onClick={merge}>
              {busy ? 'Merging…' : `Merge ${selected.size || ''} Statements →`}
            </button>
          </div>
        </>
      )}
    </div>

    {/* Existing merged statements for this quarter */}
    <div className="card card-pad" style={{ marginTop: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700 }}>Merged Statements</div>
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2, marginBottom: 12 }}>
        Combined statements you've already created for this quarter. Open one to review its GST &amp; P&amp;L, or delete it.
      </p>
      {mergedStatements.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '6px 0' }}>
          No merged statements yet. Select 2+ statements above and merge them.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {mergedStatements.map(s => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', border: '1px solid var(--border-light)', background: 'var(--brand-light)', borderRadius: 'var(--radius)' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--brand)', background: 'var(--surface-card)', padding: '3px 8px', borderRadius: 5 }}>MERGED</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.statement_name || s.filename || `Statement #${s.id}`}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.txn_count ?? 0} transactions · {s.status}</div>
              </div>
              <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => openMerged(s)}>Open</button>
              <button className="btn-secondary" style={{ fontSize: 12, color: 'var(--red)', borderColor: 'rgba(239,68,68,.3)' }} onClick={() => deleteMerged(s.id)}>Del</button>
            </div>
          ))}
        </div>
      )}
    </div>
    </>
  );
}

// ── QUARTER BAS TAB ─────────────────────────────────────────────────────────
function QuarterBasTab({ quarterId, quarterLabel, clientName }: { quarterId: number | null; quarterLabel: string | null; clientName: string | null }) {
  const [data, setData] = useState<ConsolidationSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!quarterId) return;
    setLoading(true); setErr(null);
    try { setData(await consolidationApi.quarterSummary(quarterId)); }
    catch { setErr('No statements in this quarter, or nothing to consolidate yet.'); setData(null); }
    finally { setLoading(false); }
  }, [quarterId]);

  useEffect(() => { load(); }, [load]);

  if (!quarterId) return <NeedQuarter />;

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{clientName} · {quarterLabel} — Combined BAS</div>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Live combined GST &amp; P&amp;L across every statement in this quarter (report only — nothing is modified).</p>
      </div>
      {loading && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</p>}
      {err && <div className="empty-state"><p className="empty-sub">{err}</p></div>}
      {data && (
        <>
          <BasSummaryCards consolidated={data.consolidated} txnCount={data.txn_count} statementCount={data.statement_count} />
          <div className="card" style={{ marginTop: 16 }}>
            <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border-light)', fontSize: 13, fontWeight: 700 }}>Per-Statement Breakdown</div>
            <div className="vw-table-wrap">
              <table className="vw-table">
                <thead><tr>
                  <th>Statement</th><th>Bank</th>
                  <th style={{ textAlign: 'right' }}>Txns</th>
                  <th style={{ textAlign: 'right' }}>Categorized</th>
                  <th style={{ textAlign: 'right' }}>Net GST</th>
                </tr></thead>
                <tbody>
                  {data.per_statement.map(s => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 600 }}>{s.statement_name}</td>
                      <td><span className="badge badge-gray">{(s.bank_id || '?').toUpperCase()}</span></td>
                      <td style={{ textAlign: 'right' }}>{s.txn_count}</td>
                      <td style={{ textAlign: 'right', color: s.categorized === s.txn_count ? 'var(--green)' : 'var(--amber)' }}>{s.categorized}/{s.txn_count}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{fmt(s.gst?.net_gst_payable)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── YEARLY BAS TAB ──────────────────────────────────────────────────────────
function YearlyBasTab({ clientId, clientName }: { clientId: number | null; clientName: string | null }) {
  const [years, setYears] = useState<YearGroup[]>([]);
  const [selYear, setSelYear] = useState<string>('');
  const [selQuarters, setSelQuarters] = useState<Set<number>>(new Set());
  const [label, setLabel] = useState('');
  const [result, setResult] = useState<AnnualConsolidation | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!clientId) return;
    const ys = await clientsApi.years(clientId);
    setYears(ys);
    if (ys.length && !selYear) { setSelYear(ys[0].year); setLabel(ys[0].year + ' Consolidated'); }
  }, [clientId, selYear]);

  useEffect(() => { load(); }, [load]);

  const yearGroup = years.find(y => y.year === selYear);

  function toggleQ(id: number) {
    setSelQuarters(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function build() {
    if (!clientId) return;
    if (selQuarters.size === 0) { showToast('Select at least one quarter', 'error'); return; }
    if (!label.trim()) { showToast('A label is required', 'error'); return; }
    setBusy(true);
    try {
      const r = await consolidationApi.annualSummary(clientId, label.trim(), [...selQuarters]);
      setResult(r);
      showToast(`Yearly BAS built (${r.txn_count} transactions)`, 'success');
    } catch (e) { showToast(e instanceof Error ? e.message : 'Failed to build yearly BAS', 'error'); }
    finally { setBusy(false); }
  }

  if (!clientId) return (
    <div className="empty-state"><div className="empty-icon">📅</div>
      <p className="empty-title">No client selected</p>
      <p className="empty-sub">Select a client in Client Management first.</p>
    </div>
  );

  return (
    <div>
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{clientName} — Yearly Consolidation</div>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 14 }}>Combine multiple quarters into a full-year BAS (GST + P&amp;L) with a per-quarter breakdown.</p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label className="vw-label">Financial Year</label>
            <select className="vw-select" style={{ width: 180 }} value={selYear}
              onChange={e => { setSelYear(e.target.value); setSelQuarters(new Set()); setLabel(e.target.value + ' Consolidated'); }}>
              {years.map(y => <option key={y.year} value={y.year}>{y.year} ({y.quarter_count} quarters)</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label className="vw-label">Consolidation Label</label>
            <input className="vw-input" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. FY 2024-25 Annual BAS" />
          </div>
        </div>

        {yearGroup && (
          <div style={{ marginTop: 14 }}>
            <label className="vw-label">Quarters to include</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
              {yearGroup.quarters.map(q => (
                <label key={q.id} style={{
                  display: 'flex', alignItems: 'center', gap: 7, padding: '7px 12px', cursor: 'pointer', fontSize: 12.5,
                  border: `1px solid ${selQuarters.has(q.id) ? 'var(--brand)' : 'var(--border-light)'}`,
                  background: selQuarters.has(q.id) ? 'var(--brand-light)' : 'var(--surface-card)',
                  color: selQuarters.has(q.id) ? 'var(--brand)' : 'var(--text-secondary)', borderRadius: 8, fontWeight: 600,
                }}>
                  <input type="checkbox" checked={selQuarters.has(q.id)} onChange={() => toggleQ(q.id)} />
                  {q.label}
                </label>
              ))}
              {yearGroup.quarters.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No quarters in this year.</span>}
            </div>
          </div>
        )}

        <button className="btn-primary" style={{ marginTop: 16 }} disabled={busy || selQuarters.size === 0 || !label.trim()} onClick={build}>
          {busy ? 'Building…' : 'Build Yearly BAS →'}
        </button>
      </div>

      {result && (
        <>
          <BasSummaryCards consolidated={result.consolidated} txnCount={result.txn_count} statementCount={undefined} quarterCount={result.per_quarter.length} />
          <div className="card" style={{ marginTop: 16 }}>
            <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border-light)', fontSize: 13, fontWeight: 700 }}>Per-Quarter Breakdown — {result.label}</div>
            <div className="vw-table-wrap">
              <table className="vw-table">
                <thead><tr>
                  <th>Quarter</th>
                  <th style={{ textAlign: 'right' }}>Statements</th>
                  <th style={{ textAlign: 'right' }}>Txns</th>
                  <th style={{ textAlign: 'right' }}>Net GST</th>
                  <th style={{ textAlign: 'right' }}>Net Profit</th>
                </tr></thead>
                <tbody>
                  {result.per_quarter.map(q => (
                    <tr key={q.quarter_id}>
                      <td style={{ fontWeight: 600 }}>{q.quarter_label}</td>
                      <td style={{ textAlign: 'right' }}>{q.statement_count}</td>
                      <td style={{ textAlign: 'right' }}>{q.txn_count}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{fmt(q.gst?.net_gst_payable)}</td>
                      <td className="mono" style={{ textAlign: 'right', color: (q.pnl?.gross_net_profit ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(q.pnl?.gross_net_profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Shared summary cards ────────────────────────────────────────────────────
function BasSummaryCards({ consolidated, txnCount, statementCount, quarterCount }: {
  consolidated: ConsolidatedData; txnCount: number; statementCount?: number; quarterCount?: number;
}) {
  const bas = consolidated?.gst?.bas || {};
  const pnl = consolidated?.pnl || {};
  const netGst = (bas['1A'] || 0) - (bas['1B'] || 0);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
      <Stat label={quarterCount != null ? 'Quarters' : 'Statements'} val={String(quarterCount ?? statementCount ?? 0)} />
      <Stat label="Transactions" val={String(txnCount)} />
      <Stat label="GST on Sales (1A)" val={fmt(bas['1A'])} mono />
      <Stat label="GST on Purchases (1B)" val={fmt(bas['1B'])} mono />
      <Stat label={`Net GST ${netGst >= 0 ? 'Payable' : 'Refundable'}`} val={fmt(Math.abs(netGst))} mono color={netGst >= 0 ? 'var(--red)' : 'var(--green)'} />
      <Stat label="Net Profit (Gross)" val={fmt((pnl as { gross_net_profit?: number }).gross_net_profit)} mono color={((pnl as { gross_net_profit?: number }).gross_net_profit ?? 0) >= 0 ? 'var(--green)' : 'var(--red)'} />
    </div>
  );
}

function Stat({ label, val, mono, color }: { label: string; val: string; mono?: boolean; color?: string }) {
  return (
    <div className="stat-tile">
      <div className="stat-tile-val" style={{ fontFamily: mono ? 'var(--mono)' : undefined, color, fontSize: 18 }}>{val}</div>
      <div className="stat-tile-lbl">{label}</div>
    </div>
  );
}

function NeedQuarter() {
  return (
    <div className="empty-state"><div className="empty-icon">🗂️</div>
      <p className="empty-title">No quarter selected</p>
      <p className="empty-sub">Go to Client Management and select a quarter first.</p>
    </div>
  );
}
