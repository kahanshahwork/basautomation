import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { aiApi } from '../api/client';
import { showToast } from '../components/ui/Toast';
import type { AiProvider } from '../api/client';

/**
 * AI Categorize — categorize a statement's UNCATEGORIZED transactions with AI.
 *   Direct : pick provider, one click -> categories applied.
 *   Paste  : copy the generated prompt into your own AI, paste "id: Category" back, apply.
 * Applied categories land in the main Categorize page (same DB), respecting direction rules.
 */
export function AiCategorizePage() {
  const { activeStatementId, activeStatementName, setPage } = useAppStore();

  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [provider, setProvider] = useState('gemini');
  const [mode, setMode] = useState<'direct' | 'paste'>('direct');
  const [batches, setBatches] = useState<Array<{ batch_num: number; total_batches: number; count: number; label: string; prompt: string }>>([]);
  const [totalUncat, setTotalUncat] = useState(0);
  const [pasteText, setPasteText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ applied: number; errors: Array<{ line: string; reason: string }> } | null>(null);

  useEffect(() => {
    aiApi.providers().then(ps => {
      setProviders(ps);
      const first = ps.find(p => p.configured);
      if (first) setProvider(first.id);
    });
  }, []);

  const loadPrompt = useCallback(async () => {
    if (!activeStatementId) return;
    const d = await aiApi.categorizePrompt(activeStatementId);
    setBatches(d.batches || []);
    setTotalUncat(d.total_uncategorized || 0);
  }, [activeStatementId]);

  useEffect(() => { loadPrompt(); }, [loadPrompt]);

  const selectedProvider = providers.find(p => p.id === provider);

  async function runDirect() {
    if (!activeStatementId) return;
    setBusy(true); setResult(null);
    try {
      const r = await aiApi.categorizeViaProvider(activeStatementId, provider);
      if (r.error) throw new Error(r.error);
      const applied = await aiApi.categorizeApply(activeStatementId, r.response_text || '');
      setResult(applied);
      showToast(`Applied ${applied.applied} categories`, 'success');
      await loadPrompt();
    } catch (e) { showToast(e instanceof Error ? e.message : 'Failed', 'error'); }
    finally { setBusy(false); }
  }

  async function applyPaste() {
    if (!activeStatementId || !pasteText.trim()) { showToast('Paste the AI output first', 'error'); return; }
    setBusy(true); setResult(null);
    try {
      const applied = await aiApi.categorizeApply(activeStatementId, pasteText);
      setResult(applied);
      showToast(`Applied ${applied.applied} categories`, 'success');
      setPasteText('');
      await loadPrompt();
    } catch (e) { showToast(e instanceof Error ? e.message : 'Apply failed', 'error'); }
    finally { setBusy(false); }
  }

  if (!activeStatementId) return (
    <div className="empty-state"><div className="empty-icon">🤖</div>
      <p className="empty-title">No statement selected</p>
      <p className="empty-sub">Select a statement (via Client Management → Resume) first.</p>
    </div>
  );

  const combinedPrompt = batches.map(b => b.prompt).join('\n\n──────────\n\n');

  return (
    <div className="anim-up">
      <div className="page-hdr">
        <div className="page-hdr-left">
          <h1>AI Categorize</h1>
          <p>{activeStatementName ? `${activeStatementName} · ` : ''}<strong>{totalUncat}</strong> uncategorized transactions</p>
        </div>
        <div className="page-hdr-right">
          <button className="btn-secondary" onClick={() => setPage('categorize')}>Go to Categorize →</button>
        </div>
      </div>

      {totalUncat === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">✓</div>
          <p className="empty-title">All transactions categorized</p>
          <p className="empty-sub">Nothing left for AI to do. Head to Categorize to review, or GST next.</p>
        </div>
      ) : (
        <>
          {/* Provider + mode */}
          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <label className="vw-label">AI Provider</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              {providers.map(p => (
                <button key={p.id} onClick={() => setProvider(p.id)} disabled={mode === 'direct' && !p.configured}
                  style={{ padding: '8px 14px', fontSize: 12.5, fontWeight: 600, borderRadius: 8, cursor: (mode === 'direct' && !p.configured) ? 'not-allowed' : 'pointer',
                    border: `1px solid ${provider === p.id ? 'var(--brand)' : 'var(--border-light)'}`,
                    background: provider === p.id ? 'var(--brand-light)' : 'var(--surface-card)',
                    color: provider === p.id ? 'var(--brand)' : 'var(--text-secondary)',
                    opacity: (mode === 'direct' && !p.configured) ? 0.5 : 1, fontFamily: 'var(--sans)' }}>
                  {p.label}{p.configured ? ' ✓' : ''}
                </button>
              ))}
            </div>
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

          {mode === 'direct' && (
            <div className="card card-pad" style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 12 }}>
                Categorize all {totalUncat} uncategorized transactions in one click using {selectedProvider?.label || provider}. Results are applied automatically (wrong-direction suggestions are rejected).
              </p>
              <button className="btn-primary" disabled={busy || !selectedProvider?.configured} onClick={runDirect}>
                {busy ? 'Categorizing…' : `Categorize with ${selectedProvider?.label || provider} →`}
              </button>
              {selectedProvider && !selectedProvider.configured && (
                <p style={{ fontSize: 11, color: 'var(--amber)', marginTop: 8 }}>Add <code>{selectedProvider.env_key}</code> to .env, or use paste-back.</p>
              )}
            </div>
          )}

          {mode === 'paste' && (
            <div className="card card-pad" style={{ marginBottom: 16 }}>
              <label className="vw-label">Step 1 — Copy this prompt into your AI</label>
              <textarea readOnly value={combinedPrompt} onClick={e => (e.target as HTMLTextAreaElement).select()}
                style={{ width: '100%', height: 160, marginTop: 6, fontSize: 10.5, fontFamily: 'var(--mono)', padding: 10, borderRadius: 8, border: '1px solid var(--border-light)', background: 'var(--surface-input)', resize: 'vertical' }} />
              <button className="btn-secondary" style={{ marginTop: 8, fontSize: 12 }} onClick={() => { navigator.clipboard.writeText(combinedPrompt); showToast('Prompt copied', 'success'); }}>Copy Prompt</button>

              <label className="vw-label" style={{ marginTop: 16 }}>Step 2 — Paste the AI output (one "id: Category" per line)</label>
              <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder={"nab_0001: Travel & Vehicle\nnab_0002: Sales / Trading Income"}
                style={{ width: '100%', height: 140, marginTop: 6, fontSize: 11.5, fontFamily: 'var(--mono)', padding: 10, borderRadius: 8, border: '1px solid var(--border-light)', resize: 'vertical' }} />
              <button className="btn-primary" style={{ marginTop: 10 }} disabled={busy || !pasteText.trim()} onClick={applyPaste}>
                {busy ? 'Applying…' : 'Apply Categories →'}
              </button>
            </div>
          )}

          {result && (
            <div className="card card-pad">
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                <span style={{ color: 'var(--green)' }}>✓ {result.applied} applied</span>
                {result.errors.length > 0 && <span style={{ color: 'var(--amber)', marginLeft: 12 }}>{result.errors.length} skipped</span>}
              </div>
              {result.errors.length > 0 && (
                <div style={{ marginTop: 8, maxHeight: 200, overflowY: 'auto' }}>
                  {result.errors.map((e, i) => (
                    <div key={i} style={{ fontSize: 11.5, color: 'var(--text-muted)', padding: '3px 0', borderBottom: '1px solid var(--border-light)' }}>
                      <code>{e.line}</code> — {e.reason}
                    </div>
                  ))}
                </div>
              )}
              <button className="btn-secondary" style={{ marginTop: 12 }} onClick={() => setPage('categorize')}>Review in Categorize →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
