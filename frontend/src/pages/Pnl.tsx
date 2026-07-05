import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { pnlApi, statementsApi } from '../api/client';
import { showToast } from '../components/ui/Toast';
import { fmt } from '../utils/format';
import type { PnlData } from '../types';

const GROUP_ORDER: Record<string, number> = { 'Income':0, 'Direct Cost':1, 'Expense':2, 'Excluded':3 };
const GROUP_COLOR: Record<string, string> = { 'Income':'var(--green)', 'Direct Cost':'var(--amber)', 'Expense':'var(--red)', 'Excluded':'var(--text-muted)' };

export function PnlPage() {
  const { activeStatementId, activeStatementName, activeClientName, markDone, setPage } = useAppStore();
  const [data, setData] = useState<PnlData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!activeStatementId) return;
    setLoading(true);
    try { setData(await pnlApi.get(activeStatementId)); }
    finally { setLoading(false); }
  }, [activeStatementId]);

  useEffect(() => { load(); }, [load]);

  async function handleFinalize() {
    if (!activeStatementId) return;
    await statementsApi.finalizePnl(activeStatementId).catch(() => {});
    markDone('pnl');
    showToast('Statement finalized', 'success');
    setPage('clients');
  }

  if (!activeStatementId) return (
    <div className="empty-state">
      <div className="empty-icon">📈</div><p className="empty-title">No statement selected</p>
      <p className="empty-sub">Complete the GST review first.</p>
    </div>
  );

  const rows = [...(data?.gross_category_rows ?? [])].sort((a,b) => {
    const g = (GROUP_ORDER[a.pnl_group] ?? 4) - (GROUP_ORDER[b.pnl_group] ?? 4);
    return g !== 0 ? g : (a.category || '').localeCompare(b.category || '');
  });

  // Total GST = sum of (gross − net) across every category row (the embedded GST component).
  const totalGst = rows.reduce((sum, r) => {
    const grp = r.pnl_group || 'Excluded';
    const gross = grp === 'Income' ? r.amount : Math.abs(r.amount);
    const netv  = grp === 'Income' ? r.net_amount : Math.abs(r.net_amount);
    return sum + (gross - netv);
  }, 0);

  return (
    <div className="anim-up">
      <div className="page-hdr">
        <div className="page-hdr-left">
          <h1>Profit &amp; Loss</h1>
          <p>{activeStatementName ? `${activeStatementName} · ` : ''}{activeClientName} · GST Unadjusted &amp; Adjusted shown side by side</p>
        </div>
        <div className="page-hdr-right">
          <button className="btn-secondary" onClick={() => setPage('gst')}>← Back</button>
          {activeStatementId && <a className="btn-secondary" href={pnlApi.exportUrl(activeStatementId,'gross')}>⬇ Export (Gross)</a>}
          {activeStatementId && <a className="btn-secondary" href={pnlApi.exportUrl(activeStatementId,'net')}>⬇ Export (Net)</a>}
          <button className="btn-primary" onClick={handleFinalize}>✓ Finalize</button>
        </div>
      </div>

      {loading && <p style={{ fontSize:13, color:'var(--text-muted)' }}>Loading…</p>}

      {/* Summary tiles */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:20 }}>
        <div className="stat-tile"><div className="stat-tile-val pos mono">{fmt(data?.gross_total_income)}</div><div className="stat-tile-lbl">Total Income (Gross)</div></div>
        <div className="stat-tile"><div className="stat-tile-val neg mono">{fmt(data?.gross_total_expense)}</div><div className="stat-tile-lbl">Total Expenses (Gross)</div></div>
        <div className="stat-tile">
          <div className="stat-tile-val mono" style={{ color: (data?.gross_net_profit ?? 0)>=0 ? 'var(--green)':'var(--red)' }}>{fmt(data?.gross_net_profit)}</div>
          <div className="stat-tile-lbl">Net Profit / Loss (Gross)</div>
        </div>
      </div>

      <div className="card">
        <div className="vw-table-wrap">
          <table className="vw-table">
            <thead><tr>
              <th>Category</th><th style={{width:120}}>Group</th>
              <th style={{textAlign:'right'}}>GST Unadjusted</th>
              <th style={{textAlign:'right'}}>GST</th>
              <th style={{textAlign:'right'}}>GST Adjusted</th>
              <th style={{textAlign:'right', width:70}}>Count</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign:'center', color:'var(--text-muted)', padding:24 }}>No categorized transactions yet.</td></tr>
              )}
              {(() => {
                let last: string | null = null;
                const out: React.ReactNode[] = [];
                rows.forEach((r, i) => {
                  const grp = r.pnl_group || 'Excluded';
                  const col = GROUP_COLOR[grp] || 'var(--text-muted)';
                  const gross = grp === 'Income' ? r.amount : Math.abs(r.amount);
                  const netv  = grp === 'Income' ? r.net_amount : Math.abs(r.net_amount);
                  const gst   = Math.round((gross - netv) * 100) / 100; // GST component = gross − net
                  const amtColor = grp === 'Income' ? 'var(--green)' : grp === 'Excluded' ? 'var(--text-muted)' : 'var(--red)';
                  if (grp !== last) {
                    last = grp;
                    out.push(
                      <tr key={`h-${i}`} style={{ background:'var(--surface-input)' }}>
                        <td colSpan={6} style={{ fontSize:10.5, fontWeight:800, textTransform:'uppercase', letterSpacing:.6, color:col, padding:'6px 12px' }}>{grp}</td>
                      </tr>
                    );
                  }
                  out.push(
                    <tr key={i}>
                      <td style={{ paddingLeft:20 }}>{r.category || '—'}</td>
                      <td><span className="badge badge-gray" style={{ color:col }}>{grp}</span></td>
                      <td className="mono" style={{ textAlign:'right', fontWeight:700, color:amtColor }}>{fmt(gross)}</td>
                      <td className="mono" style={{ textAlign:'right', color:'var(--purple)' }}>{fmt(gst)}</td>
                      <td className="mono" style={{ textAlign:'right', color:'var(--text-secondary)' }}>{fmt(netv)}</td>
                      <td style={{ textAlign:'right', color:'var(--text-muted)' }}>{r.count || 0}</td>
                    </tr>
                  );
                });
                return out;
              })()}
            </tbody>
            <tfoot>
              {/* Total GST across all categories */}
              <tr style={{ borderTop:'2px solid var(--purple)', background:'rgba(124,58,237,.05)' }}>
                <td colSpan={3} style={{ fontWeight:700, color:'var(--purple)', fontSize:11.5, textAlign:'right' }}>TOTAL GST</td>
                <td className="mono" style={{ textAlign:'right', fontWeight:800, color:'var(--purple)' }}>{fmt(totalGst)}</td>
                <td></td><td></td>
              </tr>
              {!!data?.gross_total_direct_cost && (
                <tr style={{ borderTop:'2px solid var(--amber)' }}>
                  <td colSpan={2} style={{ fontWeight:700, color:'var(--amber)', fontSize:11 }}>GROSS PROFIT (after Direct Costs)</td>
                  <td className="mono" style={{ textAlign:'right', fontWeight:700, color:(data.gross_profit_gross??0)>=0?'var(--green)':'var(--red)' }}>{fmt(data.gross_profit_gross)}</td>
                  <td></td>
                  <td className="mono" style={{ textAlign:'right', fontWeight:700, color:(data.gross_profit??0)>=0?'var(--green)':'var(--red)' }}>{fmt(data.gross_profit)}</td>
                  <td></td>
                </tr>
              )}
              <tr style={{ background:(data?.gross_net_profit??0)>=0?'rgba(16,185,129,.08)':'rgba(239,68,68,.08)', borderTop:`2px solid ${(data?.gross_net_profit??0)>=0?'var(--green)':'var(--red)'}` }}>
                <td colSpan={2} style={{ fontWeight:800, fontSize:13, color:(data?.gross_net_profit??0)>=0?'var(--green)':'var(--red)' }}>NET PROFIT / LOSS</td>
                <td className="mono" style={{ textAlign:'right', fontWeight:800, fontSize:14, color:(data?.gross_net_profit??0)>=0?'var(--green)':'var(--red)' }}>{fmt(data?.gross_net_profit)}</td>
                <td></td>
                <td className="mono" style={{ textAlign:'right', fontWeight:600, color:(data?.net_profit??0)>=0?'var(--green)':'var(--red)' }}>{fmt(data?.net_profit)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
