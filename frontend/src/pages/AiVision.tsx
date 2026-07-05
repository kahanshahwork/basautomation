import { useState, useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { aiApi, statementsApi } from '../api/client';
import { showToast } from '../components/ui/Toast';
import { fmt } from '../utils/format';
import type { AiProvider, ReviewItem } from '../api/client';
import type { Transaction } from '../types';

/**
 * AI Vision — extract transactions from a document image/PDF using the user's chosen
 * AI provider (Gemini / Claude / ChatGPT), then preview and push into the workflow.
 * Two modes:
 *   Direct  — we call the provider's API (needs the key in .env).
 *   Paste   — copy our prompt into your own AI window, paste the JSON back.
 */
export function AiVisionPage() {
  const { activeQuarterId, activeQuarterLabel, activeClientName, setStatement, unlockNav, markDone, setPage } = useAppStore();

  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [provider, setProvider] = useState('gemini');
  const [mode, setMode] = useState<'direct' | 'paste'>('direct');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [review, setReview] = useState<ReviewItem[]>([]);
  const [pasteText, setPasteText] = useState('');
  const [prompt, setPrompt] = useState('');
  const [name, setName] = useState('');

  useEffect(() => {
    aiApi.providers().then(ps => {
      setProviders(ps);
      const firstConfigured = ps.find(p => p.configured);
      if (firstConfigured) setProvider(firstConfigured.id);
    });
    aiApi.visionPrompt().then(d => setPrompt(d.prompt));
  }, []);

  const selectedProvider = providers.find(p => p.id === provider);

  async function extractDirect() {
    if (!file) { showToast('Upload a document first', 'error'); return; }
    setBusy(true); setTxns([]); setReview([]);
    try {
      const r = await aiApi.visionExtract(file, provider);
      if (r.error) throw new Error(r.error);
      setTxns(r.transactions || []);
      setReview(r.review || []);
      if (!name) setName(file.name.replace(/\.[^.]+$/, ''));
      showToast(`Extracted ${r.count} transactions via ${provider}`, 'success');
    } catch (e) { showToast(e instanceof Error ? e.message : 'Extraction failed', 'error'); }
    finally { setBusy(false); }
  }

  async function extractPaste() {
    if (!pasteText.trim()) { showToast('Paste the AI JSON output first', 'error'); return; }
    setBusy(true); setTxns([]); setReview([]);
    try {
      const r = await aiApi.visionExtractText(pasteText);
      if (r.error) throw new Error(r.error);
      setTxns(r.transactions || []);
      setReview(r.review || []);
      showToast(`Parsed ${r.count} transactions`, 'success');
    } catch (e) { showToast(e instanceof Error ? e.message : 'Parse failed', 'error'); }
    finally { setBusy(false); }
  }

  function editTxn(i: number, field: keyof Transaction, value: string) {
    setTxns(prev => prev.map((t, idx) => idx === i ? { ...t, [field]: field === 'amount' ? parseFloat(value || '0') : value } : t));
  }
  function removeTxn(i: number) { setTxns(prev => prev.filter((_, idx) => idx !== i)); }

  // Promote a flagged/uncertain line into the real transactions list
  function includeReview(i: number) {
    const r = review[i];
    setTxns(prev => [...prev, {
      transaction_id: `ai_rev_${r.review_id}`, date: r.date, description: r.description, amount: r.amount, source_page: 1,
    } as Transaction]);
    setReview(prev => prev.filter((_, idx) => idx !== i));
    showToast('Added to transactions', 'success');
  }
  function dismissReview(i: number) { setReview(prev => prev.filter((_, idx) => idx !== i)); }

  async function saveAsStatement() {
    if (!activeQuarterId) { showToast('Select a quarter in Client Management first', 'error'); return; }
    if (txns.length === 0) { showToast('Nothing to save', 'error'); return; }
    if (!name.trim()) { showToast('Give this statement a name', 'error'); return; }
    setBusy(true);
    try {
      const d = await statementsApi.create({
        transactions: txns, bank_id: `ai-${provider}`, filename: file?.name || 'ai-vision',
        quarter_id: activeQuarterId, statement_name: name.trim(),
      });
      setStatement(d.statement_id, name.trim(), `ai-${provider}`);
      unlockNav('approve', 'categorize', 'gst', 'pnl'); markDone('parse');
      showToast(`Saved ${txns.length} transactions — continue to Approve`, 'success');
      setPage('approve');
    } catch (e) { showToast(e instanceof Error ? e.message : 'Save failed', 'error'); }
    finally { setBusy(false); }
  }

  const credits = txns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const debits = txns.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0);

  return (
    <div className="anim-up">
      <div className="page-hdr">
        <div className="page-hdr-left">
          <h1>AI Vision</h1>
          <p>Extract transactions from a document using AI, review, then push into the workflow.{activeQuarterLabel ? ` · ${activeClientName} · ${activeQuarterLabel}` : ''}</p>
        </div>
      </div>

      {!activeQuarterId && (
        <div className="card card-pad" style={{ marginBottom: 16, background: 'var(--surface-input)' }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>⚠ Select a quarter in <strong>Client Management</strong> first — extracted transactions are saved under it.</span>
        </div>
      )}

      {/* Provider selector */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <label className="vw-label">AI Provider</label>
        <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          {providers.map(p => (
            <button key={p.id} onClick={() => setProvider(p.id)} disabled={mode === 'direct' && !p.configured}
              title={!p.configured ? `Add ${p.env_key} to .env to use direct mode` : ''}
              style={{
                padding: '8px 14px', fontSize: 12.5, fontWeight: 600, borderRadius: 8, cursor: (mode === 'direct' && !p.configured) ? 'not-allowed' : 'pointer',
                border: `1px solid ${provider === p.id ? 'var(--brand)' : 'var(--border-light)'}`,
                background: provider === p.id ? 'var(--brand-light)' : 'var(--surface-card)',
                color: provider === p.id ? 'var(--brand)' : 'var(--text-secondary)',
                opacity: (mode === 'direct' && !p.configured) ? 0.5 : 1, fontFamily: 'var(--sans)',
              }}>
              {p.label}{p.configured ? ' ✓' : ''}
            </button>
          ))}
        </div>
        {selectedProvider && !selectedProvider.configured && (
          <p style={{ fontSize: 11, color: 'var(--amber)', marginTop: 8 }}>
            No API key for {selectedProvider.label}. Add <code>{selectedProvider.env_key}</code> to your .env for direct mode, or use paste-back mode below.
          </p>
        )}

        <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
          {(['direct', 'paste'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 7, cursor: 'pointer', fontFamily: 'var(--sans)',
                border: `1px solid ${mode === m ? 'var(--brand)' : 'var(--border-light)'}`,
                background: mode === m ? 'var(--brand-light)' : 'var(--surface-input)',
                color: mode === m ? 'var(--brand)' : 'var(--text-secondary)' }}>
              {m === 'direct' ? '⚡ Direct API call' : '📋 Paste-back'}
            </button>
          ))}
        </div>
      </div>

      {/* Direct mode */}
      {mode === 'direct' && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <label className="vw-label">Document (image or PDF)</label>
          <input type="file" accept=".png,.jpg,.jpeg,.pdf" onChange={e => setFile(e.target.files?.[0] || null)} style={{ display: 'block', marginTop: 6, fontSize: 12.5 }} />
          {file && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>📄 {file.name}</div>}
          <button className="btn-primary" style={{ marginTop: 14 }} disabled={busy || !file || !selectedProvider?.configured} onClick={extractDirect}>
            {busy ? 'Extracting…' : `Extract with ${selectedProvider?.label || provider} →`}
          </button>
        </div>
      )}

      {/* Paste mode */}
      {mode === 'paste' && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <label className="vw-label">Step 1 — Copy this prompt into your AI, attach the document</label>
          <textarea readOnly value={prompt} onClick={e => (e.target as HTMLTextAreaElement).select()}
            style={{ width: '100%', height: 120, marginTop: 6, fontSize: 11, fontFamily: 'var(--mono)', padding: 10, borderRadius: 8, border: '1px solid var(--border-light)', background: 'var(--surface-input)', resize: 'vertical' }} />
          <button className="btn-secondary" style={{ marginTop: 8, fontSize: 12 }} onClick={() => { navigator.clipboard.writeText(prompt); showToast('Prompt copied', 'success'); }}>Copy Prompt</button>

          <label className="vw-label" style={{ marginTop: 16 }}>Step 2 — Paste the AI's JSON output here</label>
          <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder='[{"date":"01 Jul 2024","description":"...","amount":-82.40}, ...]'
            style={{ width: '100%', height: 120, marginTop: 6, fontSize: 11.5, fontFamily: 'var(--mono)', padding: 10, borderRadius: 8, border: '1px solid var(--border-light)', resize: 'vertical' }} />
          <button className="btn-primary" style={{ marginTop: 10 }} disabled={busy || !pasteText.trim()} onClick={extractPaste}>
            {busy ? 'Parsing…' : 'Parse Transactions →'}
          </button>
        </div>
      )}

      {/* Flagged / uncertain lines — shown separately, never silently dropped */}
      {review.length > 0 && (
        <div className="card" style={{ marginBottom: 16, border: '1px solid var(--amber)' }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border-light)', fontSize: 13, fontWeight: 700, color: 'var(--amber-text, #92400e)' }}>
            ⚠ {review.length} line{review.length === 1 ? '' : 's'} flagged for review — the AI wasn't sure these are transactions
          </div>
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {review.map((r, i) => (
              <div key={r.review_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', background: 'var(--surface-input)', borderRadius: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{r.description || r.raw}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.reason}{r.amount ? ` · ${fmt(r.amount)}` : ''}</div>
                </div>
                <button className="btn-secondary" style={{ fontSize: 11.5, padding: '4px 10px' }} onClick={() => includeReview(i)}>+ Add as transaction</button>
                <button className="btn-ghost" style={{ fontSize: 11.5, padding: '4px 8px', color: 'var(--text-muted)' }} onClick={() => dismissReview(i)}>Ignore</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Preview */}
      {txns.length > 0 && (
        <div className="card">
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Extracted Transactions ({txns.length})</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Credits {fmt(credits)} · Debits {fmt(debits)} · Review &amp; edit before saving</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input className="vw-input" style={{ width: 200 }} value={name} onChange={e => setName(e.target.value)} placeholder="Statement name *" />
              <button className="btn-primary" disabled={busy || !name.trim()} onClick={saveAsStatement}>Save &amp; Continue → Approve</button>
            </div>
          </div>
          <div className="vw-table-wrap">
            <table className="vw-table">
              <thead><tr><th style={{ width: 130 }}>Date</th><th>Description</th><th style={{ width: 140, textAlign: 'right' }}>Amount</th><th style={{ width: 60 }}></th></tr></thead>
              <tbody>
                {txns.map((t, i) => (
                  <tr key={i}>
                    <td><input className="vw-input" style={{ fontSize: 12, fontFamily: 'var(--mono)' }} value={t.date} onChange={e => editTxn(i, 'date', e.target.value)} /></td>
                    <td><input className="vw-input" style={{ fontSize: 12.5 }} value={t.description} onChange={e => editTxn(i, 'description', e.target.value)} /></td>
                    <td><input type="number" step="0.01" className="vw-input" style={{ fontSize: 12, fontFamily: 'var(--mono)', textAlign: 'right', color: t.amount >= 0 ? 'var(--green)' : 'var(--red)' }} value={t.amount} onChange={e => editTxn(i, 'amount', e.target.value)} /></td>
                    <td style={{ textAlign: 'center' }}><button className="btn-secondary" style={{ fontSize: 11, padding: '2px 8px', color: 'var(--red)' }} onClick={() => removeTxn(i)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
