import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { statementsApi, transactionsApi } from '../api/client';
import { showToast } from '../components/ui/Toast';
import { fmt } from '../utils/format';
import type { Transaction } from '../types';

/**
 * Approve — every transaction fully editable inline (date, description, amount).
 * Edits persist immediately via PATCH /api/transactions/{id} (numeric id).
 * Add / delete rows supported. Approve locks the step and advances to Categorize.
 */
export function ApprovePage() {
  const {
    activeStatementId, activeStatementName, activeClientName, activeQuarterLabel,
    markDone, unlockNav, setPage,
  } = useAppStore();

  const [txns, setTxns]       = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [search, setSearch]   = useState('');
  const [dirty, setDirty]     = useState<Set<number>>(new Set());

  const load = useCallback(() => {
    if (!activeStatementId) return;
    setLoading(true);
    statementsApi.transactions(activeStatementId)
      .then(setTxns)
      .catch(() => showToast('Failed to load transactions', 'error'))
      .finally(() => setLoading(false));
  }, [activeStatementId]);

  useEffect(() => { load(); }, [load]);

  const filtered = txns.filter(t =>
    !search || t.description.toLowerCase().includes(search.toLowerCase()) || t.date.includes(search)
  );
  const credits = txns.filter(t => t.amount > 0).reduce((s,t) => s+t.amount, 0);
  const debits  = txns.filter(t => t.amount < 0).reduce((s,t) => s+t.amount, 0);

  // Optimistic local edit; persists on blur/Enter
  function editLocal(id: number, field: 'date'|'description'|'amount', value: string) {
    setTxns(prev => prev.map(t => t.id === id
      ? { ...t, [field]: field === 'amount' ? parseFloat(value || '0') : value }
      : t));
    setDirty(prev => new Set(prev).add(id));
  }

  async function persist(t: Transaction, field: 'date'|'description'|'amount') {
    if (t.id == null || !dirty.has(t.id)) return;
    try {
      const value = field === 'amount' ? Number(t.amount) : (field === 'date' ? t.date : t.description);
      await transactionsApi.patch(t.id, { [field]: value });
      setDirty(prev => { const n = new Set(prev); n.delete(t.id!); return n; });
    } catch { showToast('Save failed', 'error'); }
  }

  async function handleApprove() {
    if (!activeStatementId) return;
    setSaving(true);
    try {
      await statementsApi.approve(activeStatementId);
      markDone('approve'); unlockNav('categorize');
      showToast('Statement approved', 'success');
      setPage('categorize');
    } catch { showToast('Approve failed', 'error'); }
    finally { setSaving(false); }
  }

  async function addRow() {
    if (!activeStatementId) return;
    try {
      const created = await transactionsApi.add(activeStatementId, {
        date: new Date().toISOString().slice(0, 10), description: '', amount: 0,
      });
      setTxns(prev => [created, ...prev]);
      showToast('Transaction added — fill in its details', 'success');
    } catch { showToast('Could not add transaction', 'error'); }
  }

  async function deleteRow(id: number) {
    if (!confirm('Delete this transaction?')) return;
    try {
      await transactionsApi.delete(id);
      setTxns(prev => prev.filter(t => t.id !== id));
      showToast('Transaction deleted', 'info');
    } catch { showToast('Delete failed', 'error'); }
  }

  if (!activeStatementId) return (
    <div className="empty-state">
      <div className="empty-icon">📋</div>
      <p className="empty-title">No statement selected</p>
      <p className="empty-sub">Go to Client Management and select a statement first.</p>
    </div>
  );

  const inputStyle: React.CSSProperties = {
    border:'1px solid var(--border-light)', borderRadius:6, background:'var(--surface-input)',
    color:'var(--text-primary)', padding:'5px 8px', fontSize:12.5, width:'100%',
  };

  return (
    <div className="anim-up">
      <div className="page-hdr">
        <div className="page-hdr-left">
          <h1>Approve Transactions</h1>
          <p>{activeStatementName ? `${activeStatementName} · ` : ''}{activeClientName}{activeQuarterLabel ? ` · ${activeQuarterLabel}` : ''} · {txns.length} transactions</p>
        </div>
        <div className="page-hdr-right">
          <button className="btn-secondary" onClick={() => setPage('parse')}>← Back</button>
          <button className="btn-secondary" onClick={addRow}>+ Add Transaction</button>
          <button className="btn-primary" disabled={saving || !txns.length} onClick={handleApprove}>
            {saving ? 'Approving…' : '✓ Approve & Continue'}
          </button>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:20 }}>
        <div className="stat-tile"><div className="stat-tile-val">{txns.length}</div><div className="stat-tile-lbl">Total Transactions</div></div>
        <div className="stat-tile"><div className="stat-tile-val pos mono">{fmt(credits)}</div><div className="stat-tile-lbl">Total Credits</div></div>
        <div className="stat-tile"><div className="stat-tile-val neg mono">{fmt(debits)}</div><div className="stat-tile-lbl">Total Debits</div></div>
      </div>

      <div className="card">
        <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--border-light)', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
          <div className="search-box">
            <span className="search-icon">🔍</span>
            <input placeholder="Search date or description…" value={search} onChange={e=>setSearch(e.target.value)} />
          </div>
          <span style={{ fontSize:12, color:'var(--text-muted)' }}>
            {filtered.length} of {txns.length} rows · <em style={{ color:'var(--brand)' }}>click any cell to edit</em>
          </span>
        </div>

        {loading ? (
          <div className="empty-state"><p className="empty-sub">Loading transactions…</p></div>
        ) : (
          <div className="vw-table-wrap">
            <table className="vw-table">
              <thead>
                <tr>
                  <th style={{width:120}}>Date</th>
                  <th>Description</th>
                  <th style={{width:60, textAlign:'center'}}>Page</th>
                  <th style={{width:130, textAlign:'right'}}>Amount</th>
                  <th style={{width:70, textAlign:'center'}}>Type</th>
                  <th style={{width:44}}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.id}>
                    <td>
                      <input style={{ ...inputStyle, fontFamily:'var(--mono)' }} value={t.date}
                        onChange={e => editLocal(t.id!, 'date', e.target.value)}
                        onBlur={() => persist(t, 'date')} />
                    </td>
                    <td>
                      <input style={inputStyle} value={t.description}
                        onChange={e => editLocal(t.id!, 'description', e.target.value)}
                        onBlur={() => persist(t, 'description')} />
                    </td>
                    <td style={{ textAlign:'center', color:'var(--text-muted)', fontSize:12 }}>{t.source_page}</td>
                    <td style={{ textAlign:'right' }}>
                      <input type="number" step="0.01"
                        style={{ ...inputStyle, fontFamily:'var(--mono)', textAlign:'right',
                          color: t.amount>0 ? 'var(--green)' : 'var(--red)' }}
                        value={t.amount}
                        onChange={e => editLocal(t.id!, 'amount', e.target.value)}
                        onBlur={() => persist(t, 'amount')} />
                    </td>
                    <td style={{ textAlign:'center' }}>
                      <span className={`badge ${t.amount>0?'badge-green':'badge-red'}`}>{t.amount>0?'CR':'DR'}</span>
                    </td>
                    <td style={{ textAlign:'center' }}>
                      <button className="btn-ghost" style={{ fontSize:12, color:'var(--red)', padding:'4px 6px' }}
                        onClick={() => deleteRow(t.id!)} title="Delete transaction">🗑</button>
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
