import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { vendorMemoryApi, clientsApi } from '../api/client';
import { showToast } from '../components/ui/Toast';
import type { VendorMemoryEntry, Client } from '../types';

export function VendorMemoryPage() {
  const { activeClientId, activeClientName, setPage } = useAppStore();
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState<number | null>(activeClientId);
  const [rows, setRows] = useState<VendorMemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  // ── BAS import state ──
  const [showImport, setShowImport] = useState(false);
  const [basFile, setBasFile] = useState<File | null>(null);
  const [basHeaders, setBasHeaders] = useState<string[]>([]);
  const [descCol, setDescCol] = useState('');
  const [catCol, setCatCol] = useState('');
  const [basBusy, setBasBusy] = useState(false);
  const [basResult, setBasResult] = useState<{ learned: number; created: string[]; skipped: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { clientsApi.list().then(setClients).catch(() => {}); }, []);
  useEffect(() => { if (activeClientId && clientId == null) setClientId(activeClientId); }, [activeClientId, clientId]);

  const load = useCallback(() => {
    if (!clientId) { setRows([]); return; }
    setLoading(true);
    vendorMemoryApi.list(clientId).then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter(r =>
    !search || r.pattern.toLowerCase().includes(search.toLowerCase()) ||
    (r.category_name || '').toLowerCase().includes(search.toLowerCase())
  );

  async function handleDelete(id: number) {
    if (!clientId || !confirm('Delete this vendor memory pattern?')) return;
    await vendorMemoryApi.delete(clientId, id);
    setRows(prev => prev.filter(r => r.id !== id));
    showToast('Pattern deleted', 'info');
  }
  async function clearAll() {
    if (!clientId || !confirm('Delete ALL vendor memory patterns for this client? This cannot be undone.')) return;
    await vendorMemoryApi.clearAll(clientId);
    setRows([]); showToast('All patterns cleared', 'info');
  }

  async function rebuildVm() {
    if (!clientId) return;
    const r = await vendorMemoryApi.rebuild(clientId);
    showToast(`Repaired ${r.repaired_merchant_patterns} merchant patterns`, 'success');
    load();
  }

  // ── BAS import ──
  function autoGuess(headers: string[], kind: 'desc' | 'cat'): string {
    const desc = ['description', 'narrative', 'details', 'particulars', 'memo', 'payee'];
    const cat = ['category', 'account', 'classification', 'type', 'gst category'];
    const list = kind === 'desc' ? desc : cat;
    return headers.find(h => list.includes(h.toLowerCase().trim())) || headers[kind === 'desc' ? 0 : 1] || '';
  }

  async function basReadHeaders(f: File) {
    if (!clientId) { showToast('Select a client first', 'error'); return; }
    setBasBusy(true); setBasResult(null);
    try {
      const d = await vendorMemoryApi.basHeaders(clientId, f);
      if (d.error) throw new Error(d.error);
      setBasFile(f);
      setBasHeaders(d.headers);
      setDescCol(autoGuess(d.headers, 'desc'));
      setCatCol(autoGuess(d.headers, 'cat'));
    } catch (e) { showToast(e instanceof Error ? e.message : 'Could not read file', 'error'); }
    finally { setBasBusy(false); }
  }

  async function basImport() {
    if (!clientId || !basFile) return;
    if (!descCol || !catCol) { showToast('Choose both columns', 'error'); return; }
    setBasBusy(true);
    try {
      const d = await vendorMemoryApi.basImport(clientId, basFile, descCol, catCol);
      if (d.error) throw new Error(d.error);
      setBasResult({ learned: d.learned, created: d.created_categories || [], skipped: d.skipped });
      showToast(`Learned ${d.learned} patterns${d.created_categories?.length ? `, discovered ${d.created_categories.length} new categories` : ''}`, 'success');
      setBasFile(null); setBasHeaders([]);
      if (fileRef.current) fileRef.current.value = '';
      load();
    } catch (e) { showToast(e instanceof Error ? e.message : 'Import failed', 'error'); }
    finally { setBasBusy(false); }
  }

  const selName = clients.find(c => c.id === clientId)?.name ?? activeClientName ?? '';

  return (
    <div className="anim-up">
      <div className="page-hdr">
        <div className="page-hdr-left">
          <h1>Vendor Memory</h1>
          <p>Learned vendor → category patterns{selName ? ` · ${selName}` : ''}</p>
        </div>
        <div className="page-hdr-right">
          <select className="vw-select" style={{ maxWidth:220 }} value={clientId ?? ''}
            onChange={e => setClientId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— Select Client —</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {rows.length > 0 && <button className="btn-danger" onClick={clearAll}>Clear All</button>}
          {rows.length > 0 && <button className="btn-secondary" disabled={!clientId} onClick={rebuildVm} title="Fix older patterns so vendor suggestions match reliably">🔧 Repair Suggestions</button>}
          <button className="btn-secondary" disabled={!clientId} onClick={() => setShowImport(v => !v)}>
            {showImport ? 'Close Import' : '📥 Import from BAS'}
          </button>
        </div>
      </div>

      {showImport && clientId && (
        <div className="card card-pad" style={{ marginBottom: 16, border: '1px solid var(--brand)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Import Vendor Memory from a past BAS</div>
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 14 }}>
            Upload a completed BAS export (.csv / .xlsx) with a description and a category column. Every row teaches vendor memory. Any category not already in the system is auto-created and flagged <strong>NEW</strong> in Category Manager until you fill in its P&amp;L group and BAS label.
          </p>

          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls"
            onChange={e => { const f = e.target.files?.[0]; if (f) basReadHeaders(f); }}
            style={{ display: 'block', fontSize: 12.5 }} />

          {basHeaders.length > 0 && (
            <div style={{ marginTop: 14, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label className="vw-label">Description column</label>
                <select className="vw-select" style={{ width: 200 }} value={descCol} onChange={e => setDescCol(e.target.value)}>
                  {basHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <div>
                <label className="vw-label">Category column</label>
                <select className="vw-select" style={{ width: 200 }} value={catCol} onChange={e => setCatCol(e.target.value)}>
                  {basHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <button className="btn-primary" disabled={basBusy || !descCol || !catCol} onClick={basImport}>
                {basBusy ? 'Importing…' : 'Import & Learn →'}
              </button>
            </div>
          )}

          {basResult && (
            <div style={{ marginTop: 14, padding: 12, background: 'var(--surface-input)', borderRadius: 'var(--radius)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>✓ Learned {basResult.learned} patterns{basResult.skipped ? ` · ${basResult.skipped} skipped` : ''}</div>
              {basResult.created.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 12.5 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Discovered {basResult.created.length} new categor{basResult.created.length === 1 ? 'y' : 'ies'}: </span>
                  {basResult.created.map(c => <span key={c} className="badge badge-amber" style={{ marginRight: 4 }}>{c}</span>)}
                  <button className="btn-secondary" style={{ fontSize: 11.5, padding: '3px 10px', marginLeft: 6 }} onClick={() => setPage('categorymanager')}>
                    Complete them in Category Manager →
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--border-light)', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
          <div className="search-box">
            <span className="search-icon">🔍</span>
            <input placeholder="Search patterns or categories…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <span style={{ fontSize:12, color:'var(--text-muted)' }}>{filtered.length} pattern{filtered.length===1?'':'s'}</span>
        </div>

        {!clientId ? (
          <div className="empty-state"><p className="empty-sub">Select a client to view their vendor memory.</p></div>
        ) : loading ? (
          <div className="empty-state"><p className="empty-sub">Loading…</p></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state"><p className="empty-sub">No patterns learned yet. Use “Add to Vendor Memory” on the Categorize or GST pages.</p></div>
        ) : (
          <div className="vw-table-wrap">
            <table className="vw-table">
              <thead><tr>
                <th>Pattern</th><th>Category</th><th>Group</th>
                <th style={{textAlign:'center'}}>GST</th>
                <th style={{textAlign:'right'}}>Hits</th><th>Updated</th>
                <th style={{textAlign:'center'}}>Actions</th>
              </tr></thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontFamily:'var(--mono)', fontSize:11.5 }}>{r.pattern}</td>
                    <td style={{ fontWeight:600 }}>{r.category_name}</td>
                    <td><span className="badge badge-gray">{r.pnl_group || '—'}</span></td>
                    <td style={{ textAlign:'center' }}>{r.gst_applicable ? '✓' : '—'}</td>
                    <td className="mono" style={{ textAlign:'right' }}>{r.hit_count}</td>
                    <td style={{ color:'var(--text-muted)', fontSize:11 }}>{r.updated_at?.slice(0,16) ?? '—'}</td>
                    <td style={{ textAlign:'center' }}>
                      <button className="btn-danger" style={{ fontSize:11, padding:'3px 8px' }} onClick={() => handleDelete(r.id)}>🗑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
