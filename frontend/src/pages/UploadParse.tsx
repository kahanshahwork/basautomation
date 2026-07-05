import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { parserApi, statementsApi } from '../api/client';
import { fmt, exportToCsv } from '../utils/format';
import { showToast } from '../components/ui/Toast';
import type { Transaction, AmbiguousTransaction, AmbDecision, SortCol, SortDir, Parser, DetectResult, Statement } from '../types';
import { CsvImport } from './CsvImport';

// ── Drop Zone ────────────────────────────────────────────────────────────────
function DropZone({ onFile, fileName, onRemove }: { onFile:(f:File)=>void; fileName:string|null; onRemove:()=>void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  if (fileName) return (
    <div style={{ display:'flex', alignItems:'center', gap:8, background:'var(--surface-input)', border:'1px solid var(--border-light)', borderRadius:10, padding:'10px 12px' }}>
      <span style={{ fontSize:16 }}>📄</span>
      <span style={{ flex:1, fontSize:12.5, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'var(--text-primary)' }}>{fileName}</span>
      <button onClick={onRemove} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:14, padding:'2px 4px', borderRadius:4 }}>✕</button>
    </div>
  );
  return (
    <div onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); const f=e.dataTransfer.files[0]; if(f) onFile(f); }}
      style={{ border:`1.5px dashed ${drag?'var(--brand)':'var(--border-default)'}`, borderRadius:12, padding:'24px 16px', textAlign:'center', cursor:'pointer', background:drag?'var(--brand-light)':'var(--surface-input)', transition:'all .15s' }}>
      <div style={{ fontSize:28, marginBottom:8, opacity:.5 }}>📁</div>
      <div style={{ fontSize:12.5, color:'var(--text-secondary)' }}>Drop PDF here or <strong style={{ color:'var(--brand)' }}>click to browse</strong></div>
      <input ref={inputRef} type="file" accept=".pdf" style={{ display:'none' }} onChange={e => { const f=e.target.files?.[0]; if(f) onFile(f); }} />
    </div>
  );
}

// ── Ambiguous Modal ──────────────────────────────────────────────────────────
function AmbiguousModal({ items, decisions, onChange, onApply, onClose }: {
  items:AmbiguousTransaction[]; decisions:Record<string,AmbDecision>;
  onChange:(id:string,dec:AmbDecision)=>void; onApply:()=>void; onClose:()=>void;
}) {
  return (
    <div className="modal-overlay" onClick={e => { if(e.target===e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth:540 }}>
        <h3>⚠️ Ambiguous Transactions ({items.length})</h3>
        <p className="modal-sub">These transactions could not be auto-classified. Review and decide each one.</p>
        <div style={{ maxHeight:360, overflowY:'auto', display:'flex', flexDirection:'column', gap:10 }}>
          {items.map(a => (
            <div key={a.transaction_id} style={{ padding:12, background:'var(--surface-input)', borderRadius:10, border:'1px solid var(--border-light)' }}>
              <div style={{ fontSize:13, fontWeight:600, marginBottom:3, color:'var(--text-primary)' }}>{a.description}</div>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:10 }}>Page {a.source_page??'?'} · {fmt(a.amount)}</div>
              <div style={{ display:'flex', gap:6 }}>
                {(['cr','dr','skip'] as AmbDecision[]).map(dec => (
                  <div key={dec} onClick={() => onChange(a.transaction_id, dec)}
                    style={{ flex:1, padding:'6px', textAlign:'center', borderRadius:7, fontSize:12, cursor:'pointer', border:`1px solid ${decisions[a.transaction_id]===dec?'var(--brand)':'var(--border-light)'}`, background:decisions[a.transaction_id]===dec?'var(--brand-light)':'var(--surface-card)', color:decisions[a.transaction_id]===dec?'var(--brand)':'var(--text-secondary)', fontWeight:decisions[a.transaction_id]===dec?700:400, transition:'all .1s' }}>
                    {dec==='cr'?'Credit ↑':dec==='dr'?'Debit ↓':'Skip'}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={onApply}>Apply Decisions</button>
        </div>
      </div>
    </div>
  );
}

// ── Transaction Table ────────────────────────────────────────────────────────
function TxnTable({ txns, ambiguous, onRowClick, focusedId, pdfOpen }: {
  txns:Transaction[]; ambiguous:AmbiguousTransaction[];
  onRowClick?:(t:Transaction)=>void; focusedId?:string|null; pdfOpen?:boolean;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all'|'cr'|'dr'>('all');
  const [sortCol, setSortCol] = useState<SortCol>('date');
  const [sortDir, setSortDir] = useState<SortDir>(1);
  const ambIds = new Set(ambiguous.map(a => a.transaction_id));

  const rows = txns
    .filter(t => {
      if (search && !t.description?.toLowerCase().includes(search.toLowerCase())) return false;
      if (filter==='cr' && t.amount<=0) return false;
      if (filter==='dr' && t.amount>=0) return false;
      return true;
    })
    .sort((a,b) => {
      let va: string|number = a[sortCol]??'', vb: string|number = b[sortCol]??'';
      if(typeof va==='string') va=va.toLowerCase(); if(typeof vb==='string') vb=vb.toLowerCase();
      return (va<vb?-1:va>vb?1:0)*sortDir;
    });

  function handleSort(col:SortCol) {
    if(sortCol===col) setSortDir(d=>d===1?-1:1); else { setSortCol(col); setSortDir(1); }
  }
  const SI = ({col}:{col:SortCol}) => <span style={{fontSize:9,marginLeft:3,color:'var(--text-muted)'}}>{sortCol===col?(sortDir===1?'↑':'↓'):'↕'}</span>;

  return (
    <div style={{ display:'flex', flexDirection:'column', flex:1, overflow:'hidden' }}>
      {/* Toolbar */}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 16px', background:'var(--surface-card)', borderBottom:'1px solid var(--border-light)', flexShrink:0, flexWrap:'wrap' }}>
        <div className="search-box" style={{ flex:1 }}>
          <span className="search-icon">🔍</span>
          <input placeholder="Search descriptions…" value={search} onChange={e=>setSearch(e.target.value)} />
        </div>
        <select className="vw-select" style={{ width:'auto', padding:'7px 10px' }} value={filter} onChange={e=>setFilter(e.target.value as typeof filter)}>
          <option value="all">All</option>
          <option value="cr">Credits</option>
          <option value="dr">Debits</option>
        </select>
        <span style={{ fontSize:12, color:'var(--text-muted)', whiteSpace:'nowrap' }}>{rows.length} of {txns.length} rows</span>
        <button className="btn-secondary" style={{ fontSize:12 }} onClick={() => exportToCsv(txns)}>⬇ CSV</button>
      </div>
      {/* Table */}
      <div style={{ flex:1, overflowY:'auto' }}>
        <table className="vw-table">
          <thead>
            <tr>
              <th style={{width:90}}>ID</th>
              <th style={{width:110,cursor:'pointer'}} onClick={()=>handleSort('date')}>Date <SI col="date"/></th>
              <th style={{cursor:'pointer'}} onClick={()=>handleSort('description')}>Description <SI col="description"/></th>
              <th style={{width:40,textAlign:'center'}}>Pg</th>
              <th style={{width:120,textAlign:'right',cursor:'pointer'}} onClick={()=>handleSort('amount')}>Amount <SI col="amount"/></th>
              <th style={{width:60,textAlign:'center'}}>Type</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(t => {
              const isAmb = ambIds.has(t.transaction_id);
              const isFocused = focusedId === t.transaction_id;
              return (
                <tr key={t.transaction_id}
                  onClick={() => onRowClick?.(t)}
                  style={{
                    background: isFocused ? 'rgba(37,99,235,.10)' : isAmb ? 'rgba(245,158,11,.04)' : undefined,
                    cursor: pdfOpen ? 'pointer' : 'default',
                    boxShadow: isFocused ? 'inset 3px 0 0 var(--brand)' : undefined,
                  }}>
                  <td style={{ fontFamily:'var(--mono)', fontSize:10.5, color:'var(--text-muted)' }}>{t.transaction_id}</td>
                  <td style={{ fontFamily:'var(--mono)', fontSize:12, whiteSpace:'nowrap' }}>{t.date}</td>
                  <td style={{ maxWidth:300, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={t.description}>{t.description}</td>
                  <td style={{ textAlign:'center', color:'var(--text-muted)', fontSize:12 }}>{t.source_page??''}</td>
                  <td className={`mono ${t.amount>0?'pos':'neg'}`} style={{ textAlign:'right' }}>{fmt(t.amount)}</td>
                  <td style={{ textAlign:'center' }}>
                    <span className={`badge ${t.amount>0?'badge-green':isAmb?'badge-amber':'badge-red'}`}>{t.amount>0?'CR':isAmb?'AMB':'DR'}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── PDF Panel (controlled: page + highlight driven by row clicks) ────────────
function PdfPanel({ tmpToken, pageCount, page, highlight, width, onPageChange, onClose }: {
  tmpToken:string; pageCount:number; page:number; highlight:number|null; width:number;
  onPageChange:(p:number)=>void; onClose:()=>void;
}) {
  const [img, setImg]   = useState<string|null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    parserApi.pdfPage(tmpToken, page, highlight ?? undefined)
      .then(d => { if(!cancelled) setImg(d.image); })
      .finally(() => { if(!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tmpToken, page, highlight]);
  return (
    <div style={{ width, borderLeft:'1px solid var(--border-light)', display:'flex', flexDirection:'column', background:'var(--surface-card)', flexShrink:0 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 12px', borderBottom:'1px solid var(--border-light)', background:'var(--surface-input)', flexShrink:0 }}>
        <span style={{ fontSize:12, fontWeight:600, flex:1 }}>PDF Preview</span>
        <span style={{ fontSize:11, color:'var(--text-muted)', fontFamily:'var(--mono)' }}>{page}/{pageCount}</span>
        <button className="btn-ghost" style={{ padding:'3px 7px', fontSize:12 }} disabled={page<=1} onClick={()=>onPageChange(page-1)}>‹</button>
        <button className="btn-ghost" style={{ padding:'3px 7px', fontSize:12 }} disabled={page>=pageCount} onClick={()=>onPageChange(page+1)}>›</button>
        <button className="btn-ghost" style={{ padding:'3px 7px', fontSize:12 }} onClick={onClose}>✕</button>
      </div>
      <div style={{ padding:'6px 12px', fontSize:10.5, color:'var(--text-muted)', borderBottom:'1px solid var(--border-light)', background:'var(--surface-card)' }}>
        💡 Click any transaction row to jump to its page &amp; highlight it.
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:8 }}>
        {loading && <div style={{ textAlign:'center', padding:20, fontSize:12, color:'var(--text-muted)' }}>Loading…</div>}
        {img && !loading && <img src={`data:image/png;base64,${img}`} alt={`PDF page ${page}`} style={{ width:'100%' }} />}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export function UploadParsePage() {
  const { activeQuarterId, activeQuarterLabel, activeClientName, activeStatementId, setStatement, clearStatement, unlockNav, markDone, setPage } = useAppStore();

  const [selectedFile, setSelectedFile] = useState<File|null>(null);
  const [tmpToken, setTmpToken]         = useState<string|null>(null);
  const [detectedBank, setDetectedBank] = useState<string|null>(null);
  const [overrideBank, setOverrideBank] = useState<string|null>(null);
  const [detectInfo, setDetectInfo]     = useState<DetectResult|null>(null);
  const [parsers, setParsers]           = useState<Parser[]>([]);
  const [stmtName, setStmtName]         = useState('');
  const [txns, setTxns]                 = useState<Transaction[]>([]);
  const [ambiguous, setAmbiguous]       = useState<AmbiguousTransaction[]>([]);
  const [ambDecisions, setAmbDecisions] = useState<Record<string,AmbDecision>>({});
  const [parseMeta, setParseMeta]       = useState<{bank_id:string;pageCount:number}>({bank_id:'',pageCount:1});
  const [parseError, setParseError]     = useState<string|null>(null);
  const [isParsing, setIsParsing]       = useState(false);
  const [isSaving, setIsSaving]         = useState(false);
  const [showAmb, setShowAmb]           = useState(false);
  const [showPdf, setShowPdf]           = useState(false);
  const [pdfPage, setPdfPage]           = useState(1);
  const [pdfHighlight, setPdfHighlight] = useState<number|null>(null);
  const [pdfWidth, setPdfWidth]         = useState(400);
  const [focusedId, setFocusedId]       = useState<string|null>(null);
  const [savedStmts, setSavedStmts]     = useState<Statement[]>([]);
  const [mode, setMode]                 = useState<'pdf'|'csv'>('pdf');

  // Click a transaction row → jump PDF to its page and highlight it
  const handleRowClick = useCallback((t: Transaction) => {
    if (!showPdf || !tmpToken) return;
    setFocusedId(t.transaction_id);
    if (t.source_page) setPdfPage(t.source_page);
    setPdfHighlight(t.row_top != null ? Number(t.row_top) : null);
  }, [showPdf, tmpToken]);

  // Drag the divider to resize the PDF pane (wider = smaller table, narrower = bigger table)
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = pdfWidth;
    function onMove(ev: MouseEvent) {
      // dragging left grows the PDF pane, dragging right shrinks it
      const next = Math.max(280, Math.min(900, startW + (startX - ev.clientX)));
      setPdfWidth(next);
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [pdfWidth]);

  useEffect(() => { parserApi.list().then(setParsers).catch(()=>{}); }, []);
  useEffect(() => { if(activeQuarterId) loadSavedStatements(); }, [activeQuarterId]);

  // Restore transactions when returning to this page with a saved statement active
  // (e.g. after clicking "← Back" from Approve). Without this, the table + summary
  // would be empty because parse results live in local component state.
  useEffect(() => {
    if (activeStatementId && txns.length === 0 && !selectedFile) {
      resumeStatement(activeStatementId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStatementId]);

  async function loadSavedStatements() {
    if(!activeQuarterId) return;
    setSavedStmts(await statementsApi.list(activeQuarterId));
  }

  async function handleFile(f:File) {
    setSelectedFile(f); setDetectedBank(null); setOverrideBank(null); setDetectInfo(null); setParseError(null);
    if(!stmtName) setStmtName(f.name.replace(/\.[^/.]+$/,'').replace(/[_-]+/g,' '));
    try {
      const d = await parserApi.detect(f);
      setTmpToken(d.tmp_token);
      if(d.bank_id && d.confidence>=0.5) { setDetectedBank(d.bank_id); setDetectInfo(d); }
      else setDetectInfo({...d,bank_id:null});
    } catch { setDetectInfo(null); }
  }

  function handleRemoveFile() {
    setSelectedFile(null); setTmpToken(null); setDetectedBank(null); setOverrideBank(null);
    setDetectInfo(null); setTxns([]); setAmbiguous([]); setStmtName(''); clearStatement();
  }

  const effectiveBank = overrideBank||detectedBank;
  const canParse = !!effectiveBank && (!!selectedFile||!!tmpToken);

  async function handleParse() {
    if(!canParse) return;
    setIsParsing(true); setParseError(null);
    try {
      const data = await parserApi.parse({ tmpToken:tmpToken??undefined, file:selectedFile??undefined, bankId:effectiveBank! });
      if(data.error) { setParseError(data.error); return; }
      setTmpToken(data.tmp_token); setTxns(data.transactions??[]); setAmbiguous(data.ambiguous??[]);
      setParseMeta({ bank_id:data.bank_id, pageCount:data.meta?.pages??data.page_count??1 });
    } catch(e) { setParseError((e as Error).message); }
    finally { setIsParsing(false); }
  }

  function applyAmbDecisions() {
    let updated=[...txns];
    Object.entries(ambDecisions).forEach(([id,dec]) => {
      const idx=updated.findIndex(t=>t.transaction_id===id); if(idx===-1) return;
      if(dec==='cr') updated[idx]={...updated[idx],amount:Math.abs(updated[idx].amount)};
      if(dec==='dr') updated[idx]={...updated[idx],amount:-Math.abs(updated[idx].amount)};
      if(dec==='skip') updated.splice(idx,1);
    });
    setTxns(updated); setAmbiguous(ambiguous.filter(a=>!ambDecisions[a.transaction_id]||ambDecisions[a.transaction_id]==='skip')); setShowAmb(false);
  }

  async function handleSave() {
    if(activeStatementId) { unlockNav('approve','categorize','gst','pnl'); markDone('parse'); setPage('approve'); return; }
    if(!txns.length) { showToast('No transactions to save','error'); return; }
    setIsSaving(true);
    try {
      const d = await statementsApi.create({ transactions:txns, bank_id:parseMeta.bank_id, filename:selectedFile?.name??'', quarter_id:activeQuarterId, statement_name:stmtName||selectedFile?.name||'Statement' });
      setStatement(d.statement_id, stmtName||selectedFile?.name||'Statement', parseMeta.bank_id);
      unlockNav('approve','categorize','gst','pnl'); markDone('parse');
      await loadSavedStatements(); showToast('Statement saved','success'); setPage('approve');
    } catch(e) { showToast('Error saving: '+(e as Error).message,'error'); }
    finally { setIsSaving(false); }
  }

  const resumeStatement = useCallback(async(id:number) => {
    const list = activeQuarterId ? await statementsApi.list(activeQuarterId) : [];
    const meta = list.find(s=>s.id===id);
    setStatement(id, meta?.statement_name??meta?.filename??`Statement #${id}`, meta?.bank_id);
    unlockNav('approve','categorize','gst','pnl');
    if(meta) setStmtName(meta.statement_name??meta.filename??'');
    const txnList = await statementsApi.transactions(id);
    setTxns(txnList); setAmbiguous([]); setParseMeta({ bank_id:meta?.bank_id??'', pageCount:1 });
    setSelectedFile(null); showToast('Statement loaded','info');
  }, [activeQuarterId, setStatement, unlockNav]);

  const totalCredits = txns.filter(t=>t.amount>0).reduce((s,t)=>s+t.amount,0);
  const totalDebits  = txns.filter(t=>t.amount<0).reduce((s,t)=>s+t.amount,0);
  const netVal       = totalCredits+totalDebits;

  const SB: React.CSSProperties = { width:268, background:'var(--surface-card)', borderRight:'1px solid var(--border-light)', overflowY:'auto', flexShrink:0, display:'flex', flexDirection:'column' };
  const SBS: React.CSSProperties = { padding:'14px 16px', borderBottom:'1px solid var(--border-light)' };
  const LBL: React.CSSProperties = { fontSize:9.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'1px', color:'var(--text-muted)', marginBottom:10, display:'block' };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', margin:'-28px -32px -48px' }}>
      {/* Page header */}
      <div style={{ padding:'16px 24px', background:'var(--surface-card)', borderBottom:'1px solid var(--border-light)', display:'flex', alignItems:'center', gap:12, flexShrink:0 }}>
        <div style={{ flex:1 }}>
          <h1 style={{ fontSize:18, fontWeight:700, color:'var(--text-primary)' }}>Upload & Parse</h1>
          {activeClientName && <p style={{ fontSize:12.5, color:'var(--text-secondary)', marginTop:1 }}>{activeClientName}{activeQuarterLabel?` · ${activeQuarterLabel}`:''}</p>}
        </div>
        {txns.length>0 && (
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            {ambiguous.length>0 && <button className="btn-primary" style={{ background:'var(--amber)' }} onClick={()=>setShowAmb(true)}>⚠️ {ambiguous.length} Ambiguous</button>}
            {tmpToken && <button className="btn-secondary" onClick={()=>setShowPdf(p=>!p)}>{showPdf?'Hide PDF':'🔍 View PDF'}</button>}
            <button className="btn-primary" style={{ background:'var(--green)' }} disabled={isSaving} onClick={handleSave}>
              {isSaving?'Saving…':activeStatementId?'→ Continue to Approve':'💾 Save & Continue →'}
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ flex:1, display:'flex', overflow:'hidden', minHeight:0 }}>
        {/* Left panel */}
        <div style={SB}>
          {/* Mode toggle */}
          <div style={{ ...SBS, display:'flex', gap:6 }}>
            <button onClick={() => setMode('pdf')}
              style={{ flex:1, padding:'7px', fontSize:12, fontWeight:600, borderRadius:8, cursor:'pointer', fontFamily:'var(--sans)',
                border:`1px solid ${mode==='pdf'?'var(--brand)':'var(--border-light)'}`,
                background:mode==='pdf'?'var(--brand-light)':'var(--surface-input)',
                color:mode==='pdf'?'var(--brand)':'var(--text-secondary)' }}>📄 PDF Parse</button>
            <button onClick={() => setMode('csv')}
              style={{ flex:1, padding:'7px', fontSize:12, fontWeight:600, borderRadius:8, cursor:'pointer', fontFamily:'var(--sans)',
                border:`1px solid ${mode==='csv'?'var(--brand)':'var(--border-light)'}`,
                background:mode==='csv'?'var(--brand-light)':'var(--surface-input)',
                color:mode==='csv'?'var(--brand)':'var(--text-secondary)' }}>📊 CSV / Excel</button>
          </div>

          {mode === 'csv' && (
            <CsvImport onImported={(id, nm) => {
              setStatement(id, nm, 'csv');
              unlockNav('approve','categorize','gst','pnl'); markDone('parse');
              loadSavedStatements();
              setPage('approve');
            }} />
          )}

          {mode === 'pdf' && <>
          {/* Drop zone */}
          <div style={SBS}>
            <span style={LBL}>Bank Statement PDF</span>
            <DropZone onFile={handleFile} fileName={selectedFile?.name??null} onRemove={handleRemoveFile} />
          </div></>}

          {selectedFile && (
            <div style={SBS}>
              <span style={LBL}>Statement Name</span>
              <input className="vw-input" value={stmtName} onChange={e=>setStmtName(e.target.value)} placeholder="e.g. NAB Business Jun 2026" />
            </div>
          )}

          {/* Detection */}
          {selectedFile && (
            <div style={SBS}>
              <span style={LBL}>Bank Detection</span>
              <div style={{ display:'flex', alignItems:'center', gap:8, background:'var(--surface-input)', border:'1px solid var(--border-light)', borderRadius:8, padding:'8px 10px', fontSize:12, color:'var(--text-secondary)' }}>
                {detectInfo===null ? <>
                  <span style={{ width:7,height:7,borderRadius:'50%',background:'var(--text-muted)',flexShrink:0,animation:'pulse 1s infinite' }} />Detecting…
                </> : detectInfo.bank_id ? <>
                  <span style={{ width:7,height:7,borderRadius:'50%',background:'var(--green)',flexShrink:0 }} />{detectInfo.display_name} ({Math.round(detectInfo.confidence*100)}%)
                </> : <>
                  <span style={{ width:7,height:7,borderRadius:'50%',background:'var(--amber)',flexShrink:0 }} />Uncertain — select bank manually
                </>}
              </div>
            </div>
          )}

          {/* Bank override */}
          {selectedFile && (
            <div style={SBS}>
              <span style={LBL}>Override Bank</span>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5 }}>
                {parsers.map(p => (
                  <button key={p.bank_id} onClick={()=>setOverrideBank(overrideBank===p.bank_id?null:p.bank_id)}
                    style={{ background:overrideBank===p.bank_id?'var(--brand-light)':'var(--surface-input)', border:`1px solid ${overrideBank===p.bank_id?'var(--brand)':'var(--border-light)'}`, borderRadius:8, padding:'6px 8px', fontSize:11, fontWeight:600, cursor:'pointer', color:overrideBank===p.bank_id?'var(--brand)':'var(--text-secondary)', transition:'all .12s', fontFamily:'var(--sans)' }}>
                    {p.display_name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Parse button */}
          {selectedFile && (
            <div style={SBS}>
              {parseError && <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:8, padding:'8px 10px', fontSize:12, color:'var(--red)', marginBottom:8 }}>{parseError}</div>}
              <button className="btn-primary" style={{ width:'100%', justifyContent:'center' }} disabled={!canParse||isParsing} onClick={handleParse}>
                {isParsing?'Parsing…':'⚙️ Parse Statement'}
              </button>
            </div>
          )}

          {/* Stats */}
          {txns.length>0 && (
            <div style={SBS}>
              <span style={LBL}>Summary</span>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                {[{v:txns.length,l:'Transactions',c:'var(--text-primary)'},{v:fmt(totalCredits),l:'Credits',c:'var(--green)'},{v:fmt(totalDebits),l:'Debits',c:'var(--red)'},{v:fmt(netVal),l:'Net',c:netVal>=0?'var(--green)':'var(--red)'}].map(s=>(
                  <div key={s.l} style={{ background:'var(--surface-input)', border:'1px solid var(--border-light)', borderRadius:10, padding:'10px 12px' }}>
                    <div style={{ fontSize:14, fontWeight:800, fontFamily:'var(--mono)', color:s.c }}>{s.v}</div>
                    <div style={{ fontSize:10, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.5px', marginTop:2 }}>{s.l}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Saved statements */}
          {savedStmts.length>0 && (
            <div style={SBS}>
              <span style={LBL}>Saved Statements</span>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {savedStmts.map(s => (
                  <div key={s.id} style={{ display:'flex', alignItems:'center', gap:8, background:'var(--surface-input)', border:'1px solid var(--border-light)', borderRadius:8, padding:'7px 10px' }}>
                    <span style={{ fontSize:9.5, fontWeight:700, color:'var(--brand)', background:'var(--brand-light)', padding:'2px 6px', borderRadius:4, flexShrink:0 }}>{(s.bank_id||'?').toUpperCase()}</span>
                    <span style={{ flex:1, fontSize:11.5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'var(--text-secondary)' }}>{s.statement_name||s.filename||`#${s.id}`}</span>
                    <button className="btn-secondary" style={{ fontSize:11, padding:'4px 8px' }} onClick={()=>resumeStatement(s.id)}>Load</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right area */}
        {txns.length===0 ? (
          <div className="empty-state" style={{ flex:1 }}>
            <div className="empty-icon">📑</div>
            <p className="empty-title">No transactions yet</p>
            <p className="empty-sub">Upload a PDF bank statement and click Parse Statement to extract transactions.</p>
          </div>
        ) : (
          <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
            <TxnTable txns={txns} ambiguous={ambiguous} onRowClick={handleRowClick} focusedId={focusedId} pdfOpen={showPdf} />
            {showPdf && tmpToken && (
              <>
                <div
                  onMouseDown={startResize}
                  title="Drag to resize"
                  style={{ width:6, cursor:'col-resize', flexShrink:0, background:'var(--border-light)',
                    borderLeft:'1px solid var(--border-default)', borderRight:'1px solid var(--border-default)' }}
                />
                <PdfPanel
                  tmpToken={tmpToken}
                  pageCount={parseMeta.pageCount}
                  page={pdfPage}
                  highlight={pdfHighlight}
                  width={pdfWidth}
                  onPageChange={(p)=>{ setPdfPage(p); setPdfHighlight(null); setFocusedId(null); }}
                  onClose={()=>setShowPdf(false)}
                />
              </>
            )}
          </div>
        )}
      </div>

      {showAmb && <AmbiguousModal items={ambiguous} decisions={ambDecisions} onChange={(id,dec)=>setAmbDecisions(p=>({...p,[id]:dec}))} onApply={applyAmbDecisions} onClose={()=>setShowAmb(false)} />}
    </div>
  );
}
