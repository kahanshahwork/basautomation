import { useState, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { importApi } from '../api/client';
import { showToast } from '../components/ui/Toast';

import type { ImportHeadersResponse } from '../types';

const SYSTEM_FIELDS = [
  { key:'date',        label:'Date',        required:true  },
  { key:'description', label:'Description', required:true  },
  { key:'amount',      label:'Amount',      required:false },
  { key:'debit',       label:'Debit (−)',   required:false },
  { key:'credit',      label:'Credit (+)',  required:false },
] as const;

const ALIASES: Record<string,string[]> = {
  date:        ['date','trans date','transaction date','txn date','value date','posting date','settlement date'],
  description: ['description','narrative','narration','details','particulars','memo','reference','remarks','payee','transaction details'],
  amount:      ['amount','net amount','transaction amount','value'],
  debit:       ['debit','withdrawal','withdrawals','dr','money out','debit amount','paid out','cheques'],
  credit:      ['credit','deposit','deposits','cr','money in','credit amount','paid in','receipts'],
};
function autoDetect(field: string, headers: string[]): string {
  const al = ALIASES[field] || [];
  for (const h of headers) if (al.includes(h.toLowerCase().trim())) return h;
  return '';
}

/**
 * CSV/Excel import with two-step column mapping:
 *   Step 1 — upload file, read headers + sample rows.
 *   Step 2 — map system fields to your columns (auto-detected), then import.
 */
export function CsvImport({ onImported }: { onImported: (statementId: number, name: string) => void }) {
  const { activeClientId, activeQuarterId } = useAppStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [headers, setHeaders] = useState<string[]>([]);
  const [sample, setSample] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pick(f: File) {
    setFile(f); setError(null);
    if (!name) setName(f.name.replace(/\.[^.]+$/, ''));
  }
  function reset() {
    setFile(null); setStep(1); setHeaders([]); setSample([]); setMapping({}); setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function readHeaders() {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const d: ImportHeadersResponse = await importApi.headers(file);
      if (d.error) throw new Error(d.error);
      if (!d.headers?.length) throw new Error('No columns found in file');
      setHeaders(d.headers); setSample(d.sample || []);
      const auto: Record<string, string> = {};
      SYSTEM_FIELDS.forEach(f => { const a = autoDetect(f.key, d.headers); if (a) auto[f.key] = a; });
      setMapping(auto); setStep(2);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read file'); }
    finally { setBusy(false); }
  }

  async function doImport() {
    if (!file) return;
    if (!mapping.date || !mapping.description) { setError('Date and Description are required.'); return; }
    if (!mapping.amount && !mapping.debit && !mapping.credit) { setError('Map at least Amount, or Debit/Credit.'); return; }
    setBusy(true); setError(null);
    try {
      const d = await importApi.importCsv({
        file, clientId: activeClientId, quarterId: activeQuarterId,
        name: name || file.name.replace(/\.[^.]+$/, ''), mapping,
      });
      if (d.error) throw new Error(d.error);
      showToast(`Imported ${d.transactions?.length ?? 0} transactions`, 'success');
      onImported(d.statement_id, name || file.name);
      reset();
    } catch (e) { setError(e instanceof Error ? e.message : 'Import failed'); }
    finally { setBusy(false); }
  }

  const sampleRow = sample[0] || {};

  return (
    <div style={{ padding:16 }}>
      {step === 1 ? (
        <>
          <div onClick={() => inputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && /\.(csv|xlsx|xls)$/i.test(f.name)) pick(f); }}
            style={{ border:'1.5px dashed var(--border-default)', borderRadius:12, padding:'28px 16px', textAlign:'center', cursor:'pointer', background:'var(--surface-input)' }}>
            <div style={{ fontSize:28, marginBottom:8, opacity:.5 }}>📊</div>
            <div style={{ fontSize:12.5, color:'var(--text-secondary)' }}>
              {file ? <strong>{file.name}</strong> : <>Drop CSV / Excel here or <strong style={{ color:'var(--brand)' }}>click to browse</strong></>}
            </div>
            <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display:'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) pick(f); }} />
          </div>
          {file && (
            <div style={{ marginTop:12 }}>
              <label className="vw-label">Statement Name</label>
              <input className="vw-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. NAB Business Q1" />
            </div>
          )}
          {error && <div style={{ marginTop:10, color:'var(--red)', fontSize:12 }}>⚠ {error}</div>}
          <button className="btn-primary" style={{ marginTop:14, width:'100%', justifyContent:'center' }}
            disabled={!file || busy} onClick={readHeaders}>{busy ? 'Reading…' : 'Read Columns →'}</button>
        </>
      ) : (
        <>
          <div style={{ fontSize:13, fontWeight:700, marginBottom:4 }}>Map Columns</div>
          <p style={{ fontSize:11.5, color:'var(--text-muted)', marginBottom:12 }}>Match each system field to a column from your file. Auto-detected where possible.</p>
          <table className="vw-table" style={{ fontSize:12 }}>
            <thead><tr><th>System Field</th><th>Your Column</th><th>Sample</th></tr></thead>
            <tbody>
              {SYSTEM_FIELDS.map(f => {
                const col = mapping[f.key] || '';
                const sv = col ? String(sampleRow[col] ?? '—') : '—';
                return (
                  <tr key={f.key}>
                    <td style={{ fontWeight:600, whiteSpace:'nowrap' }}>{f.label}{f.required && <span style={{ color:'var(--red)' }}> *</span>}</td>
                    <td>
                      <select className="vw-select" style={{ fontSize:12, padding:'4px 6px' }} value={col}
                        onChange={e => setMapping(m => ({ ...m, [f.key]: e.target.value }))}>
                        <option value="">— skip —</option>
                        {headers.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </td>
                    <td style={{ color:'var(--text-muted)', fontFamily:'var(--mono)', fontSize:10.5, maxWidth:120, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={sv}>{sv}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p style={{ fontSize:10, color:'var(--text-muted)', marginTop:8 }}>* Use <strong>Amount</strong> for single-column files (positive = CR, negative = DR). Use <strong>Debit/Credit</strong> for separate columns.</p>
          {error && <div style={{ marginTop:8, color:'var(--red)', fontSize:12 }}>⚠ {error}</div>}
          <div style={{ display:'flex', gap:8, marginTop:14 }}>
            <button className="btn-secondary" onClick={() => setStep(1)}>← Back</button>
            <button className="btn-primary" style={{ flex:1, justifyContent:'center' }} disabled={busy} onClick={doImport}>
              {busy ? 'Importing…' : 'Import →'}
            </button>
          </div>
        </>
      )}
      <div style={{ marginTop:16, fontSize:11, color:'var(--text-muted)' }}>
        {sample.length > 0 && step === 1 && `${sample.length} sample rows loaded`}
      </div>
    </div>
  );
}
