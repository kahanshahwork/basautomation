import { useState, useEffect } from 'react';
import { categoryApi } from '../api/client';
import { showToast } from '../components/ui/Toast';
import type { Category, PotentialDuplicatePair } from '../types';

const PNL_GROUPS = ['Income','Direct Cost','Expense','Excluded'] as const;
const BAS_LABELS = ['G1','G11','excluded'] as const;

export function CategoryManagerPage() {
  const [cats, setCats]       = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch]   = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newCat, setNewCat]  = useState({ name:'', code:'', pnl_group:'Expense' as typeof PNL_GROUPS[number], bas_label:'G11' as typeof BAS_LABELS[number], gst_applicable:1 as 0|1 });

  // ── Potential duplicates ──
  const [dupes, setDupes] = useState<PotentialDuplicatePair[]>([]);
  const [showDupes, setShowDupes] = useState(true);

  // ── Manual merge (for a NEW imported category → any other category) ──
  const [mergeSource, setMergeSource] = useState<Category | null>(null);

  const loadAll = () => {
    setLoading(true);
    categoryApi.list().then(setCats).finally(() => setLoading(false));
    categoryApi.potentialDuplicates().then(d => setDupes(d.pairs)).catch(() => setDupes([]));
  };

  useEffect(() => { loadAll(); }, []);

  async function deleteDupe(id: number, name: string) {
    if (!confirm(`Delete the imported category "${name}"? (Only allowed if no transactions use it — otherwise it's deactivated.)`)) return;
    await categoryApi.delete(id);
    showToast(`"${name}" removed`, 'info');
    loadAll();
  }

  async function keepBoth(id: number, name: string) {
    await categoryApi.dismissNew(id);
    showToast(`Kept "${name}" as a separate category`, 'info');
    loadAll();
  }

  const filtered = cats.filter(c => {
    if (!showInactive && !c.is_active) return false;
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.code.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  // NEW (auto-discovered, incomplete) categories float to the top
  const sorted = [...filtered].sort((a, b) => (b.is_new ? 1 : 0) - (a.is_new ? 1 : 0));
  const newCount = cats.filter(c => c.is_new).length;

  async function handlePatch(id: number, field: string, value: unknown) {
    const updated = await categoryApi.update(id, field, value);
    setCats(prev => prev.map(c => c.id === id ? { ...c, ...(updated || { [field]: value }) } as Category : c));
    // pnl_group/bas_label edits can clear is_new → refresh the duplicates list
    if (field === 'pnl_group' || field === 'bas_label') {
      categoryApi.potentialDuplicates().then(d => setDupes(d.pairs)).catch(() => {});
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete or deactivate this category?')) return;
    await categoryApi.delete(id);
    setCats(prev => prev.filter(c => c.id !== id));
    categoryApi.potentialDuplicates().then(d => setDupes(d.pairs)).catch(() => {});
    showToast('Category removed', 'info');
  }

  async function handleAdd() {
    if (!newCat.name.trim()) return;
    const created = await categoryApi.create(newCat);
    setCats(prev => [...prev, created]);
    setShowAdd(false);
    setNewCat({ name:'', code:'', pnl_group:'Expense', bas_label:'G11', gst_applicable:1 as 0|1 });
    showToast('Category added', 'success');
  }

  return (
    <div className="anim-up">
      <div className="page-hdr">
        <div className="page-hdr-left">
          <h1>Category Manager</h1>
          <p>{cats.filter(c=>c.is_active).length} active · {cats.length} total categories</p>
        </div>
        <div className="page-hdr-right">
          <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, color:'var(--text-secondary)', cursor:'pointer' }}>
            <input type="checkbox" checked={showInactive} onChange={e=>setShowInactive(e.target.checked)} />
            Show inactive
          </label>
          <button className="btn-primary" onClick={()=>setShowAdd(true)}>+ Add Category</button>
        </div>
      </div>

      {dupes.length > 0 && (
        <div className="card" style={{ marginBottom: 16, border: '1px solid var(--purple, #7C3AED)' }}>
          <div style={{ padding: '13px 18px', borderBottom: showDupes ? '1px solid var(--border-light)' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
            onClick={() => setShowDupes(v => !v)}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--purple, #7C3AED)' }}>
              🔀 Potential Duplicates ({dupes.length}) — imported categories that look like existing ones
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{showDupes ? '▼ hide' : '▶ show'}</span>
          </div>
          {showDupes && (
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {dupes.map(pair => (
                <div key={pair.new_category.id} style={{ border: '1px solid var(--border-light)', borderRadius: 'var(--radius)', padding: 14, background: 'var(--surface-input)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                    <span className="badge badge-amber" style={{ fontSize: 9.5 }}>NEW (imported)</span>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{pair.new_category.name}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{pair.new_category.pnl_group}{pair.new_category.bas_label ? ` · ${pair.new_category.bas_label}` : ' · no BAS label'}</span>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      <button className="btn-secondary" style={{ fontSize: 11.5, padding: '4px 10px' }} onClick={() => keepBoth(pair.new_category.id, pair.new_category.name)}>Keep Both</button>
                      <button className="btn-secondary" style={{ fontSize: 11.5, padding: '4px 10px', color: 'var(--red)', borderColor: 'rgba(239,68,68,.3)' }} onClick={() => deleteDupe(pair.new_category.id, pair.new_category.name)}>Delete</button>
                    </div>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 6 }}>Looks similar to:</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {pair.matches.map(m => (
                      <div key={m.category.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', background: 'var(--surface-card)', border: '1px solid var(--border-light)', borderRadius: 8 }}>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{m.category.name}</span>
                          {m.category.is_new ? <span className="badge badge-amber" style={{ marginLeft: 6, fontSize: 9 }}>NEW</span> : <span className="badge badge-gray" style={{ marginLeft: 6, fontSize: 9 }}>existing</span>}
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>shared: {m.shared_words.join(', ')}</span>
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>use ⇄ Merge in the table below to combine</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {newCount > 0 && (
        <div className="card card-pad" style={{ marginBottom: 16, border: '1px solid var(--amber)', background: 'rgba(245,158,11,.06)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber-text, #92400e)' }}>
            ⚠ {newCount} newly-discovered categor{newCount === 1 ? 'y' : 'ies'} from BAS import need completing
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 4 }}>
            These were auto-created and are marked <strong>NEW</strong>. Set a correct P&amp;L group and BAS label for each — the NEW flag clears automatically once both are filled.
          </p>
        </div>
      )}

      <div className="card">
        <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--border-light)' }}>
          <div className="toolbar" style={{ margin:0 }}>
            <div className="search-box">
              <span className="search-icon">🔍</span>
              <input placeholder="Search categories…" value={search} onChange={e=>setSearch(e.target.value)} />
            </div>
            <span style={{ fontSize:12, color:'var(--text-muted)' }}>{filtered.length} categories</span>
          </div>
        </div>
        {loading ? <div className="empty-state"><p className="empty-sub">Loading…</p></div> : (
          <div className="vw-table-wrap">
            <table className="vw-table">
              <thead>
                <tr><th>Code</th><th>Name</th><th>P&L Group</th><th>BAS Label</th><th style={{textAlign:'center'}}>GST</th><th style={{textAlign:'center'}}>Active</th><th /></tr>
              </thead>
              <tbody>
                {sorted.map(c => (
                  <tr key={c.id} style={{ opacity: c.is_active ? 1 : .45, background: c.is_new ? 'rgba(245,158,11,.08)' : undefined }}>
                    <td style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--text-muted)' }}>{c.code}</td>
                    <td style={{ fontWeight:600 }}>
                      {c.name}
                      {c.is_new ? <span className="badge badge-amber" style={{ marginLeft:8, fontSize:9.5 }}>NEW</span> : null}
                    </td>
                    <td>
                      <select className="vw-select" style={{ padding:'4px 8px', fontSize:12 }}
                        value={c.pnl_group} onChange={e=>handlePatch(c.id,'pnl_group',e.target.value)}>
                        {PNL_GROUPS.map(g=><option key={g} value={g}>{g}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="vw-select" style={{ padding:'4px 8px', fontSize:12, borderColor: c.is_new && !c.bas_label ? 'var(--amber)' : undefined }}
                        value={c.bas_label || ''} onChange={e=>handlePatch(c.id,'bas_label',e.target.value)}>
                        <option value="" disabled>— set —</option>
                        {BAS_LABELS.map(l=><option key={l} value={l}>{l}</option>)}
                      </select>
                    </td>
                    <td style={{textAlign:'center'}}>
                      <input type="checkbox" checked={!!c.gst_applicable}
                        onChange={e=>handlePatch(c.id,'gst_applicable',e.target.checked?1:0)} />
                    </td>
                    <td style={{textAlign:'center'}}>
                      <input type="checkbox" checked={!!c.is_active}
                        onChange={e=>handlePatch(c.id,'is_active',e.target.checked?1:0)} />
                    </td>
                    <td>
                      <div style={{ display:'flex', gap:4, justifyContent:'flex-end' }}>
                        <button className="btn-ghost" style={{fontSize:11.5,color:'var(--brand)',padding:'4px 8px',fontWeight:600}} onClick={()=>setMergeSource(c)} title="Merge other categories into this one">⇄ Merge</button>
                        <button className="btn-ghost" style={{fontSize:12,color:'var(--red)',padding:'4px 8px'}} onClick={()=>handleDelete(c.id)}>🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && (
        <div className="modal-overlay" onClick={e=>{if(e.target===e.currentTarget)setShowAdd(false)}}>
          <div className="modal-box">
            <h3>Add Category</h3>
            <p className="modal-sub">Create a new category for the Australian Chart of Accounts.</p>
            <div className="field"><label className="vw-label">Category Name</label>
              <input className="vw-input" value={newCat.name} onChange={e=>setNewCat(p=>({...p,name:e.target.value}))} placeholder="e.g. Merchant Fees" autoFocus /></div>
            <div className="field"><label className="vw-label">Code</label>
              <input className="vw-input" value={newCat.code} onChange={e=>setNewCat(p=>({...p,code:e.target.value}))} placeholder="e.g. EXP_MERCHANT" /></div>
            <div className="field"><label className="vw-label">P&L Group</label>
              <select className="vw-select" value={newCat.pnl_group} onChange={e=>setNewCat(p=>({...p,pnl_group:e.target.value as typeof PNL_GROUPS[number]}))}>
                {PNL_GROUPS.map(g=><option key={g} value={g}>{g}</option>)}
              </select></div>
            <div className="field"><label className="vw-label">BAS Label</label>
              <select className="vw-select" value={newCat.bas_label} onChange={e=>setNewCat(p=>({...p,bas_label:e.target.value as typeof BAS_LABELS[number]}))}>
                {BAS_LABELS.map(l=><option key={l} value={l}>{l}</option>)}
              </select></div>
            <div className="field">
              <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,cursor:'pointer'}}>
                <input type="checkbox" checked={!!newCat.gst_applicable} onChange={e=>setNewCat(p=>({...p,gst_applicable:e.target.checked?1:0}))} />
                GST Applicable (10%)
              </label>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={()=>setShowAdd(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleAdd}>Add Category</button>
            </div>
          </div>
        </div>
      )}
      {mergeSource && (
        <MergeModal
          source={mergeSource}
          allCats={cats.filter(c => c.id !== mergeSource.id && c.is_active)}
          onClose={() => setMergeSource(null)}
          onMerged={() => { setMergeSource(null); loadAll(); }}
        />
      )}
    </div>
  );
}

// ── Merge modal: the clicked category (keeper) absorbs one or more others ──
function MergeModal({ source, allCats, onClose, onMerged }: {
  source: Category;         // the KEEPER — everything gets merged INTO this
  allCats: Category[];      // candidate categories to absorb (already excludes source)
  onClose: () => void;
  onMerged: () => void;
}) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const filtered = allCats.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.code.toLowerCase().includes(search.toLowerCase())
  );
  const pickedCats = allCats.filter(c => picked.has(c.id));

  function toggle(id: number) {
    setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function doMerge() {
    if (picked.size === 0) { showToast('Pick at least one category to merge in', 'error'); return; }
    const names = pickedCats.map(c => `"${c.name}"`).join(', ');
    if (!confirm(`Merge ${names} into "${source.name}"?\n\nAll transactions and vendor-memory patterns from ${picked.size === 1 ? 'that category' : 'those categories'} move to "${source.name}", then ${picked.size === 1 ? 'it is' : 'they are'} deleted.\n\nFuture bank statements whose transactions used to match ${picked.size === 1 ? 'it' : 'them'} will now be suggested as "${source.name}".`)) return;
    setBusy(true);
    let movedTxns = 0, movedVm = 0, ok = 0;
    try {
      // Merge each picked category INTO the keeper (source). Sequential to keep vendor-memory
      // repointing deterministic and avoid UNIQUE(client_id, pattern) races.
      for (const c of pickedCats) {
        const r = await categoryApi.merge(c.id, source.id);
        if (r.error) { showToast(`"${c.name}": ${r.error}`, 'error'); continue; }
        movedTxns += r.moved_transactions || 0;
        movedVm += r.moved_vendor_memory || 0;
        ok += 1;
      }
      if (ok > 0) {
        showToast(`Merged ${ok} categor${ok === 1 ? 'y' : 'ies'} into "${source.name}" — moved ${movedTxns} txns, ${movedVm} patterns`, 'success');
        onMerged();
      }
    } catch (e) { showToast(e instanceof Error ? e.message : 'Merge failed', 'error'); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 540 }}>
        <h3>Merge into “{source.name}”</h3>
        <p className="modal-sub">
          Pick one or more categories to fold <strong>into</strong> <strong>{source.name}</strong>.
          Their transactions and learned vendor-memory patterns move to {source.name}, then they're removed.
          Any category can absorb several others this way.
        </p>

        <div className="field">
          <label className="vw-label">Categories to merge in {picked.size > 0 ? `(${picked.size} selected)` : ''}</label>
          <input className="vw-input" placeholder="Search categories…" value={search} onChange={e => setSearch(e.target.value)} autoFocus />
          <div style={{ maxHeight: 260, overflowY: 'auto', marginTop: 8, border: '1px solid var(--border-light)', borderRadius: 8 }}>
            {filtered.length === 0 && <div style={{ padding: 12, fontSize: 12.5, color: 'var(--text-muted)' }}>No matches.</div>}
            {filtered.map(c => (
              <label key={c.id}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer',
                  background: picked.has(c.id) ? 'var(--brand-light)' : 'transparent',
                  borderBottom: '1px solid var(--border-light)' }}>
                <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: picked.has(c.id) ? 'var(--brand)' : 'var(--text-primary)' }}>{c.name}</span>
                {c.is_new ? <span className="badge badge-amber" style={{ fontSize: 9 }}>NEW</span> : <span className="badge badge-gray" style={{ fontSize: 9 }}>{c.pnl_group}</span>}
                {c.bas_label ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· {c.bas_label}</span> : null}
              </label>
            ))}
          </div>
        </div>

        {picked.size > 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', background: 'var(--surface-input)', borderRadius: 8, padding: '10px 12px', marginTop: 4 }}>
            Keeping <strong>{source.name}</strong>. Removing after merge: {pickedCats.map(c => c.name).join(', ')}.
          </div>
        )}

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || picked.size === 0} onClick={doMerge}>
            {busy ? 'Merging…' : `Merge ${picked.size || ''} into ${source.name}`}
          </button>
        </div>
      </div>
    </div>
  );
}
