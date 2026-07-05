import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '../store/appStore';
import { statementsApi, categoryApi, categorizeApi } from '../api/client';
import { showToast } from '../components/ui/Toast';
import { fmt } from '../utils/format';
import type { Transaction, Category, TxnGroup } from '../types';

const CR_GROUPS = new Set(['Income', 'Excluded']);
const DR_GROUPS = new Set(['Direct Cost', 'Expense', 'Excluded']);

/**
 * Categorize — flat + grouped views, vendor-memory suggestions, and the explicit
 * "Add to Vendor Memory" cycle:
 *   1. Categorize a transaction (does NOT write vendor memory).
 *   2. Press "Add to VM" on that row → writes the exact + semantic-bucket pattern.
 *   3. If you later change that row's category, the row re-flags as "⚠ Update VM"
 *      until you press it again (or use the bulk "Update Categories → VM" button).
 * Suggestions (🧠) come from vendor memory and apply to similar vendors automatically.
 */
export function CategorizePage() {
  const {
    activeStatementId, activeStatementName, activeClientName,
    markDone, unlockNav, setPage,
  } = useAppStore();

  const [txns, setTxns]           = useState<Transaction[]>([]);
  const [cats, setCats]           = useState<Category[]>([]);
  const [suggestions, setSugg]    = useState<Record<number, number>>({});
  const [grouped, setGrouped]     = useState(false);
  const [suggestedOnly, setSuggestedOnly] = useState(false);
  const [groups, setGroups]       = useState<{ credit: TxnGroup[]; debit: TxnGroup[] }>({ credit: [], debit: [] });
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());
  const [loading, setLoading]     = useState(false);
  // Vendor-memory state per txn id: 'none' | 'saved' | 'stale'
  const [vmState, setVmState]     = useState<Record<number, 'none'|'saved'|'stale'>>({});

  const catById = useMemo(() => {
    const m: Record<number, Category> = {};
    cats.forEach(c => { m[c.id] = c; });
    return m;
  }, [cats]);

  const loadFlat = useCallback(async () => {
    if (!activeStatementId) return;
    setLoading(true);
    try {
      const [t, c, s] = await Promise.all([
        statementsApi.transactions(activeStatementId),
        categoryApi.list(),
        categorizeApi.suggest(activeStatementId),
      ]);
      setTxns(t); setCats(c);
      const sg: Record<number, number> = {};
      Object.entries(s).forEach(([k, v]) => { sg[Number(k)] = v as number; });
      setSugg(sg);
    } finally { setLoading(false); }
  }, [activeStatementId]);

  const loadGroups = useCallback(async () => {
    if (!activeStatementId) return;
    setLoading(true);
    try {
      const [g, c, t] = await Promise.all([
        categorizeApi.groups(activeStatementId),
        categoryApi.list(),
        statementsApi.transactions(activeStatementId),
      ]);
      setGroups(g); setCats(c); setTxns(t);
    } finally { setLoading(false); }
  }, [activeStatementId]);

  // Load once per (statement, view-mode) change. Depends only on stable primitives —
  // NOT on the load callbacks — to avoid a refetch loop that made the table flicker.
  useEffect(() => {
    if (grouped) loadGroups(); else loadFlat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStatementId, grouped]);

  const done = txns.filter(t => t.category_id).length;
  const suggestionCount = Object.keys(suggestions).filter(id => !txns.find(t => t.id === Number(id))?.category_id).length;

  function optsFor(dir: 'CR'|'DR') {
    const allowed = dir === 'CR' ? CR_GROUPS : DR_GROUPS;
    return cats.filter(c => allowed.has(c.pnl_group));
  }

  // ── Flat categorize ──
  async function categorize(id: number, catId: number | null) {
    if (!activeStatementId) return;
    setTxns(prev => prev.map(t => t.id === id ? { ...t, category_id: catId } : t));
    setSugg(prev => { const n = { ...prev }; delete n[id]; return n; });
    // if this row already had VM saved, changing category makes it stale
    setVmState(prev => ({ ...prev, [id]: prev[id] === 'saved' ? 'stale' : (catId ? prev[id] || 'none' : 'none') }));
    try {
      await categorizeApi.set(activeStatementId, [id], catId);
    } catch { showToast('Categorize failed', 'error'); }
  }

  async function acceptSuggestion(id: number, catId: number) {
    await categorize(id, catId);
  }
  function rejectSuggestion(id: number) {
    setSugg(prev => { const n = { ...prev }; delete n[id]; return n; });
  }

  // Apply every current vendor-memory suggestion in one action.
  async function assignAllSuggested() {
    if (!activeStatementId) return;
    const entries = Object.entries(suggestions)
      .map(([id, cat]) => [Number(id), cat] as [number, number])
      .filter(([id]) => !txns.find(t => t.id === id)?.category_id);
    if (entries.length === 0) { showToast('No suggestions to assign', 'info'); return; }
    // group by category for efficient bulk calls
    const byCat = new Map<number, number[]>();
    entries.forEach(([id, cat]) => { const a = byCat.get(cat) || []; a.push(id); byCat.set(cat, a); });
    try {
      for (const [cat, ids] of byCat) {
        await categorizeApi.set(activeStatementId, ids, cat);
      }
      setTxns(prev => prev.map(t => {
        const s = t.id != null ? suggestions[t.id] : undefined;
        return (s && !t.category_id) ? { ...t, category_id: s } : t;
      }));
      setSugg({});
      showToast(`Assigned ${entries.length} suggested categories`, 'success');
    } catch { showToast('Assign-all failed', 'error'); }
  }

  async function addToVm(id: number) {
    if (!activeStatementId) return;
    try {
      await categorizeApi.updateVendorMemory(activeStatementId, id);
      setVmState(prev => ({ ...prev, [id]: 'saved' }));
      showToast('Added to vendor memory', 'success');
    } catch (e) { showToast(e instanceof Error ? e.message : 'VM update failed', 'error'); }
  }

  async function addAllToVm() {
    if (!activeStatementId) return;
    try {
      const r = await categorizeApi.updateAllVendorMemory(activeStatementId);
      const next: Record<number,'saved'> = {};
      txns.forEach(t => { if (t.category_id && t.id != null) next[t.id] = 'saved'; });
      setVmState(next);
      showToast(`Saved ${r.count} patterns to vendor memory`, 'success');
    } catch { showToast('Bulk VM update failed', 'error'); }
  }

  // ── Grouped categorize ──
  async function categorizeGroupAll(g: TxnGroup, catId: number | null) {
    if (!activeStatementId) return;
    const ids = g.transactions.map(t => t.id);
    try {
      await categorizeApi.set(activeStatementId, ids, catId);
      await loadGroups();
    } catch { showToast('Group categorize failed', 'error'); }
  }
  async function categorizeInGroup(id: number, catId: number | null, key: string) {
    if (!activeStatementId) return;
    try {
      await categorizeApi.set(activeStatementId, [id], catId);
      setExpanded(prev => new Set(prev).add(key));
      await loadGroups();
    } catch { showToast('Categorize failed', 'error'); }
  }

  async function handleContinue() {
    if (!activeStatementId) return;
    await statementsApi.finalizeCategorize(activeStatementId).catch(() => {});
    markDone('categorize'); unlockNav('gst'); setPage('gst');
  }

  if (!activeStatementId) return (
    <div className="empty-state">
      <div className="empty-icon">🏷️</div>
      <p className="empty-title">No statement selected</p>
      <p className="empty-sub">Select a statement and approve it first.</p>
    </div>
  );

  const selectStyle: React.CSSProperties = {
    border:'1px solid var(--border-light)', borderRadius:6, padding:'4px 6px',
    fontSize:12, background:'var(--surface-card)', color:'var(--text-primary)', maxWidth:200,
  };

  return (
    <div className="anim-up">
      <div className="page-hdr">
        <div className="page-hdr-left">
          <h1>Categorize</h1>
          <p>{activeStatementName ? `${activeStatementName} · ` : ''}{activeClientName} · <strong style={{ color: done===txns.length && txns.length ? 'var(--green)' : 'var(--brand)' }}>{done} / {txns.length} categorized</strong></p>
        </div>
        <div className="page-hdr-right">
          <button className="btn-secondary" onClick={() => setPage('approve')}>← Back</button>
          <button className="btn-secondary" onClick={addAllToVm}>🧠 Add All to Vendor Memory</button>
          <button className="btn-secondary" onClick={() => setGrouped(g => !g)}>
            {grouped ? '☰ Flat View' : '⊞ Grouped View'}
          </button>
          <button className="btn-primary" onClick={handleContinue}>Continue → GST</button>
        </div>
      </div>

      {/* Suggestion action bar */}
      {!grouped && suggestionCount > 0 && (
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:14, padding:'10px 14px', background:'var(--brand-light)', border:'1px solid var(--brand)', borderRadius:'var(--radius)' }}>
          <span style={{ fontSize:13, fontWeight:600, color:'var(--brand)' }}>🧠 {suggestionCount} suggestion{suggestionCount===1?'':'s'} from vendor memory</span>
          <button className="btn-primary" style={{ padding:'5px 14px', fontSize:12.5 }} onClick={assignAllSuggested}>✓ Assign All Suggested</button>
          <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12.5, color:'var(--text-secondary)', cursor:'pointer', marginLeft:'auto' }}>
            <input type="checkbox" checked={suggestedOnly} onChange={e => setSuggestedOnly(e.target.checked)} />
            Show only suggested
          </label>
        </div>
      )}

      {loading && <p style={{ fontSize:13, color:'var(--text-muted)', marginBottom:12 }}>Loading…</p>}

      {/* ── FLAT VIEW ── */}
      {!grouped && (
        <div className="card">
          <div className="vw-table-wrap">
            <table className="vw-table">
              <thead>
                <tr>
                  <th style={{width:110}}>Date</th>
                  <th>Description</th>
                  <th style={{width:120, textAlign:'right'}}>Amount</th>
                  <th style={{width:170}}>Suggestion</th>
                  <th style={{width:230}}>Category</th>
                  <th style={{width:130, textAlign:'center'}}>Vendor Memory</th>
                </tr>
              </thead>
              <tbody>
                {txns.filter(t => !suggestedOnly || (t.id != null && suggestions[t.id] && !t.category_id)).map(t => {
                  const isCr = t.amount >= 0;
                  const sugId = !t.category_id ? suggestions[t.id!] : undefined;
                  const vm = t.id != null ? vmState[t.id] : undefined;
                  return (
                    <tr key={t.id}>
                      <td style={{ fontFamily:'var(--mono)', fontSize:11.5, whiteSpace:'nowrap' }}>{t.date}</td>
                      <td title={t.description}>{t.description}</td>
                      <td className={`mono ${isCr?'pos':'neg'}`} style={{ textAlign:'right' }}>{fmt(t.amount)}</td>
                      <td>
                        {sugId ? (
                          <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                            <span style={{ fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:5, background:'rgba(124,58,237,.1)', color:'var(--purple)', width:'fit-content' }}>
                              🧠 {catById[sugId]?.name ?? '?'}
                            </span>
                            <div style={{ display:'flex', gap:4 }}>
                              <button className="btn-primary" style={{ padding:'2px 8px', fontSize:10 }} onClick={() => acceptSuggestion(t.id!, sugId)}>✓ Accept</button>
                              <button className="btn-ghost" style={{ padding:'2px 6px', fontSize:10 }} onClick={() => rejectSuggestion(t.id!)}>✕</button>
                            </div>
                          </div>
                        ) : t.category_id ? (
                          <span style={{ color:'var(--green)', fontSize:11 }}>✓ set</span>
                        ) : (
                          <span style={{ color:'var(--text-muted)', fontSize:11 }}>—</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'nowrap' }}>
                          <span className={`badge ${isCr?'badge-green':'badge-red'}`} style={{ flexShrink:0 }}>{isCr?'CR':'DR'}</span>
                          <select style={{ ...selectStyle, flex:1, minWidth:0 }} value={t.category_id ?? ''}
                            onChange={e => categorize(t.id!, e.target.value ? Number(e.target.value) : null)}>
                            <option value="">— Uncategorized —</option>
                            {optsFor(isCr?'CR':'DR').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                      </td>
                      <td style={{ textAlign:'center' }}>
                        {t.category_id ? (
                          <button
                            onClick={() => addToVm(t.id!)}
                            className="btn-secondary"
                            style={{
                              fontSize:10, padding:'3px 8px', whiteSpace:'nowrap',
                              ...(vm === 'saved'
                                ? { color:'var(--green)', borderColor:'rgba(16,185,129,.4)', background:'rgba(16,185,129,.08)' }
                                : vm === 'stale'
                                ? { color:'var(--red)', borderColor:'rgba(239,68,68,.4)', background:'rgba(239,68,68,.08)' }
                                : { color:'var(--purple)', borderColor:'rgba(124,58,237,.35)', background:'rgba(124,58,237,.08)' }),
                            }}>
                            {vm === 'saved' ? '✓ In VM' : vm === 'stale' ? '⚠ Update VM' : '🧠 Add to VM'}
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
      )}

      {/* ── GROUPED VIEW ── */}
      {grouped && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {[...groups.credit.map(g => ({ ...g, _dir:'CR' as const })),
            ...groups.debit.map(g => ({ ...g, _dir:'DR' as const }))].map(g => {
            const key = `${g._dir}:${g.group_key}`;
            const isOpen = expanded.has(key);
            const doneCnt = g.transactions.filter(t => t.category_id).length;
            const allDone = doneCnt === g.transactions.length && g.transactions.length > 0;
            const opts = optsFor(g._dir);
            return (
              <div key={key} className="card" style={{ overflow:'hidden' }}>
                <div style={{ padding:'10px 16px', background:'var(--surface-input)', display:'flex', alignItems:'center', gap:10, cursor:'pointer' }}
                  onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; })}>
                  <span style={{ fontSize:11, color:'var(--text-muted)' }}>{isOpen ? '▼' : '▶'}</span>
                  <span className={`badge ${g._dir==='CR'?'badge-green':'badge-red'}`}>{g._dir}</span>
                  <span style={{ flex:1, fontSize:13, fontWeight:700 }}>{g.group_key}</span>
                  <span style={{ fontSize:11, color:'var(--text-muted)', whiteSpace:'nowrap' }}>{doneCnt}/{g.transactions.length} done · {fmt(g.total)}</span>
                  {allDone && <span className="badge badge-green">✓ ALL DONE</span>}
                  <select style={{ ...selectStyle, minWidth:170 }} value={g.dominant_category_id ?? ''}
                    onClick={e => e.stopPropagation()}
                    onChange={e => categorizeGroupAll(g, e.target.value ? Number(e.target.value) : null)}>
                    <option value="">— Set whole group —</option>
                    {opts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                {isOpen && (
                  <div className="vw-table-wrap">
                    <table className="vw-table">
                      <thead><tr><th style={{width:110}}>Date</th><th>Description</th><th style={{width:120, textAlign:'right'}}>Amount</th><th style={{width:220}}>Category</th></tr></thead>
                      <tbody>
                        {g.transactions.map(t => (
                          <tr key={t.id}>
                            <td style={{ fontFamily:'var(--mono)', fontSize:11.5 }}>{t.date}</td>
                            <td title={t.description}>{t.description}</td>
                            <td className={`mono ${t.amount>0?'pos':'neg'}`} style={{ textAlign:'right' }}>{fmt(t.amount)}</td>
                            <td>
                              <select style={selectStyle} value={t.category_id ?? ''}
                                onChange={e => categorizeInGroup(t.id, e.target.value ? Number(e.target.value) : null, key)}>
                                <option value="">— Uncategorized —</option>
                                {opts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
          {!groups.credit.length && !groups.debit.length && !loading && (
            <div className="empty-state"><p className="empty-sub">No transaction groups found.</p></div>
          )}
        </div>
      )}
    </div>
  );
}
