import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '../store/appStore';
import { gstApi, categoryApi, categorizeApi, statementsApi } from '../api/client';
import { showToast } from '../components/ui/Toast';
import { fmt } from '../utils/format';
import type { Category, GstResponse } from '../types';

const CR_GROUPS = new Set(['Income', 'Excluded']);
const DR_GROUPS = new Set(['Direct Cost', 'Expense', 'Excluded']);

export function GstPage() {
  const { activeStatementId, activeStatementName, activeClientName, markDone, unlockNav, setPage } = useAppStore();
  const [data, setData] = useState<GstResponse | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [vmFlag, setVmFlag] = useState<Record<number, 'saved'|'stale'>>({});

  const load = useCallback(async () => {
    if (!activeStatementId) return;
    setLoading(true);
    try {
      const [d, c] = await Promise.all([gstApi.get(activeStatementId), categoryApi.list()]);
      setData(d); setCats(c);
    } finally { setLoading(false); }
  }, [activeStatementId]);

  useEffect(() => { load(); }, [load]);

  function optsFor(dir: 'CR'|'DR') {
    const allowed = dir === 'CR' ? CR_GROUPS : DR_GROUPS;
    return cats.filter(c => allowed.has(c.pnl_group));
  }

  async function patchAmount(txnId: number, val: string) {
    try { await gstApi.patchAmount(txnId, parseFloat(val || '0')); await load(); }
    catch { showToast('Update failed', 'error'); }
  }

  async function recategorize(txnId: number, catId: number | null) {
    if (!activeStatementId) return;
    try {
      // recategorize but do NOT auto-write vendor memory
      await categorizeApi.set(activeStatementId, [txnId], catId, true);
      setVmFlag(prev => ({ ...prev, [txnId]: 'stale' }));
      await load();
    } catch { showToast('Recategorize failed', 'error'); }
  }

  async function updateVm(txnId: number) {
    if (!activeStatementId) return;
    try {
      await categorizeApi.updateVendorMemory(activeStatementId, txnId);
      setVmFlag(prev => ({ ...prev, [txnId]: 'saved' }));
      showToast('Vendor memory updated', 'success');
    } catch (e) { showToast(e instanceof Error ? e.message : 'VM update failed', 'error'); }
  }

  async function handleContinue() {
    if (!activeStatementId) return;
    await statementsApi.finalizeGst(activeStatementId).catch(() => {});
    markDone('gst'); unlockNav('pnl'); setPage('pnl');
  }

  const bas = data?.summary?.bas;
  const net = useMemo(() => (bas ? (bas['1A'] || 0) - (bas['1B'] || 0) : 0), [bas]);

  if (!activeStatementId) return (
    <div className="empty-state">
      <div className="empty-icon">📊</div><p className="empty-title">No statement selected</p>
      <p className="empty-sub">Complete categorization first.</p>
    </div>
  );

  const selectStyle: React.CSSProperties = {
    border:'1px solid var(--border-light)', borderRadius:6, padding:'3px 5px',
    fontSize:11, background:'var(--surface-card)', color:'var(--text-primary)', maxWidth:170,
  };

  const basTiles = bas ? [
    { k:'G1',  label:'Total sales',          v: bas['G1'] },
    { k:'G10', label:'Capital purchases',    v: bas['G10'] },
    { k:'G11', label:'Non-capital purchases',v: bas['G11'] },
    { k:'1A',  label:'GST on sales',         v: bas['1A'] },
    { k:'1B',  label:'GST on purchases',     v: bas['1B'] },
  ] : [];

  return (
    <div className="anim-up">
      <div className="page-hdr">
        <div className="page-hdr-left">
          <h1>GST Review</h1>
          <p>{activeStatementName ? `${activeStatementName} · ` : ''}{activeClientName} · BAS labels &amp; GST treatment</p>
        </div>
        <div className="page-hdr-right">
          <button className="btn-secondary" onClick={() => setPage('categorize')}>← Back</button>
          {activeStatementId && <a className="btn-secondary" href={gstApi.exportUrl(activeStatementId)}>⬇ Export GST</a>}
          <button className="btn-primary" onClick={handleContinue}>Continue → P&amp;L</button>
        </div>
      </div>

      {loading && <p style={{ fontSize:13, color:'var(--text-muted)' }}>Loading…</p>}

      {/* BAS grid + net panel */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr) 1.3fr', gap:10, marginBottom:20 }}>
        {basTiles.map(t => (
          <div key={t.k} className="stat-tile">
            <div style={{ fontSize:10, fontWeight:800, color:'var(--brand)', letterSpacing:.5 }}>{t.k}</div>
            <div className="stat-tile-val mono" style={{ fontSize:16 }}>{fmt(t.v)}</div>
            <div className="stat-tile-lbl">{t.label}</div>
          </div>
        ))}
        <div className="stat-tile" style={{ background: net>=0 ? 'rgba(239,68,68,.06)' : 'rgba(16,185,129,.06)', borderColor: net>=0 ? 'rgba(239,68,68,.25)' : 'rgba(16,185,129,.25)' }}>
          <div style={{ fontSize:11, fontWeight:700 }}>Net GST {net>=0 ? 'Payable' : 'Refundable'}</div>
          <div className="stat-tile-val mono" style={{ color: net>=0 ? 'var(--red)' : 'var(--green)', fontSize:20 }}>{fmt(Math.abs(net))}</div>
        </div>
      </div>

      {/* Category summary */}
      <div className="card" style={{ marginBottom:20 }}>
        <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border-light)', fontSize:14, fontWeight:700 }}>GST Summary by Category</div>
        <div className="vw-table-wrap">
          <table className="vw-table">
            <thead><tr>
              <th>Category</th><th>P&amp;L Group</th><th>BAS</th>
              <th style={{textAlign:'right'}}>Gross</th><th style={{textAlign:'right'}}>GST</th>
              <th style={{textAlign:'right'}}>Net</th><th style={{textAlign:'right'}}>Count</th>
            </tr></thead>
            <tbody>
              {(data?.summary?.by_category ?? []).map((c, i) => (
                <tr key={i}>
                  <td style={{ fontWeight:600 }}>{c.category}</td>
                  <td><span className="badge badge-gray">{c.pnl_group}</span></td>
                  <td><span className="badge badge-blue">{c.bas_label}</span></td>
                  <td className="mono" style={{ textAlign:'right' }}>{fmt(c.gross)}</td>
                  <td className="mono" style={{ textAlign:'right' }}>{fmt(c.gst)}</td>
                  <td className="mono" style={{ textAlign:'right' }}>{fmt(c.net)}</td>
                  <td style={{ textAlign:'right', color:'var(--text-muted)' }}>{c.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Transaction detail */}
      <div className="card">
        <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border-light)', fontSize:14, fontWeight:700 }}>Transaction Detail</div>
        <div className="vw-table-wrap">
          <table className="vw-table">
            <thead><tr>
              <th>Description</th><th style={{width:190}}>Category</th>
              <th style={{textAlign:'center', width:50}}>GST?</th>
              <th style={{textAlign:'right', width:110}}>Amount</th>
              <th style={{textAlign:'right', width:90}}>GST</th>
              <th style={{textAlign:'right', width:100}}>Net</th>
              <th style={{textAlign:'center', width:120}}>Vendor Memory</th>
            </tr></thead>
            <tbody>
              {(data?.transactions ?? []).map(t => {
                const isCr = t.amount >= 0;
                const flag = t.id != null ? vmFlag[t.id] : undefined;
                return (
                  <tr key={t.id}>
                    <td title={t.description}>{t.description}</td>
                    <td>
                      <select style={selectStyle} value={t.category_id ?? ''}
                        onChange={e => recategorize(t.id!, e.target.value ? Number(e.target.value) : null)}>
                        <option value="">— unset —</option>
                        {optsFor(isCr?'CR':'DR').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td style={{ textAlign:'center' }}>{t.gst_applicable ? '✓' : '—'}</td>
                    <td style={{ textAlign:'right' }}>
                      <input type="number" step="0.01" defaultValue={t.amount}
                        onBlur={e => patchAmount(t.id!, e.target.value)}
                        style={{ border:'none', background:'transparent', fontFamily:'var(--mono)', fontSize:12, textAlign:'right', width:90, color: isCr?'var(--green)':'var(--red)' }} />
                    </td>
                    <td className="mono" style={{ textAlign:'right' }}>{fmt(t.gst_amount)}</td>
                    <td className="mono" style={{ textAlign:'right' }}>{fmt(t.net_amount)}</td>
                    <td style={{ textAlign:'center' }}>
                      {t.category_id ? (
                        <button className="btn-secondary" onClick={() => updateVm(t.id!)}
                          style={{ fontSize:10, padding:'3px 8px', whiteSpace:'nowrap',
                            ...(flag==='saved' ? { color:'var(--green)', borderColor:'rgba(16,185,129,.4)' }
                              : flag==='stale' ? { color:'var(--red)', borderColor:'rgba(239,68,68,.4)' }
                              : { color:'var(--purple)', borderColor:'rgba(124,58,237,.35)' }) }}>
                          {flag==='saved' ? '✓ In VM' : flag==='stale' ? '⚠ Update VM' : '🧠 Add to VM'}
                        </button>
                      ) : <span style={{ color:'var(--text-muted)', fontSize:11 }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
