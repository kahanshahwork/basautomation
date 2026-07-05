/**
 * api/client.ts — typed fetch wrappers. URLs match Flask routes EXACTLY.
 * Vite proxies /api, /parse, /detect, /parsers, /pdf_page → localhost:5051
 *
 * Key contract notes (verified against the live backend):
 *  - categorize/patch/suggest use the numeric transaction DB id (`Transaction.id`).
 *  - categorize body is { transaction_ids: number[], category_id: number|null }.
 *  - suggest returns { [numericTxnId]: categoryId }.
 *  - update-vendor-memory accepts { transaction_id } or { all: true }.
 */

import type {
  Advisor, Client, BusinessType, Quarter, YearGroup, Statement,
  Transaction, ParseResult, DetectResult, Parser,
  Category, VendorMemoryEntry, PnlData, GroupsResponse,
  GstResponse, ImportHeadersResponse, ImportCsvResponse,
  ConsolidationSummary, AnnualConsolidation,
  PotentialDuplicatePair,
} from '../types';

// ── Base helpers ─────────────────────────────────────────────────────────
async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
}
async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `POST ${url} → ${res.status}`;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}
async function postForm<T>(url: string, form: FormData): Promise<T> {
  const res = await fetch(url, { method: 'POST', body: form });
  if (!res.ok) {
    let msg = `POST ${url} → ${res.status}`;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}
async function patch<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${url} → ${res.status}`);
  return res.json();
}
async function del<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE ${url} → ${res.status}`);
  return res.json();
}

// ── Advisors (top of hierarchy) ──────────────────────────────────────────
export const advisorsApi = {
  list: () => get<Advisor[]>('/api/advisors'),
  create: (name: string, firm?: string, email?: string) =>
    post<Advisor>('/api/advisors', { name, firm, email }),
  update: (id: number, body: Partial<Pick<Advisor, 'name' | 'firm' | 'email'>>) =>
    patch<Advisor>(`/api/advisors/${id}`, body),
  delete: (id: number) => del<{ deleted: number }>(`/api/advisors/${id}`),
};

// ── Clients ──────────────────────────────────────────────────────────────
export const clientsApi = {
  list: (advisorId?: number) =>
    get<Client[]>(advisorId != null ? `/api/clients?advisor_id=${advisorId}` : '/api/clients'),
  create: (name: string, business_type: string, advisor_id?: number) =>
    post<{ id: number }>('/api/clients', { name, business_type, advisor_id }),
  update: (id: number, body: Partial<Pick<Client, 'name' | 'business_type' | 'advisor_id'>>) =>
    patch<Client>(`/api/clients/${id}`, body),
  years: (clientId: number) => get<YearGroup[]>(`/api/clients/${clientId}/years`),
  businessTypes: () =>
    get<BusinessType[]>('/api/business-types').catch(() => [] as BusinessType[]),
};

// ── Quarters ─────────────────────────────────────────────────────────────
export const quartersApi = {
  list: (clientId: number, year?: string) =>
    get<Quarter[]>(`/api/quarters?client_id=${clientId}${year ? `&year=${encodeURIComponent(year)}` : ''}`),
  create: (clientId: number, label: string, period_start: string, period_end: string, year?: string) =>
    post<{ id: number; year: string }>('/api/quarters', { client_id: clientId, label, period_start, period_end, year }),
};

// ── Statements ───────────────────────────────────────────────────────────
export const statementsApi = {
  list: (quarterId: number) =>
    get<Statement[]>(`/api/quarters/${quarterId}/statements`).catch(() => [] as Statement[]),
  create: (body: {
    transactions: Transaction[];
    bank_id: string;
    filename: string;
    quarter_id: number | null;
    statement_name: string | null;
  }) => post<{ statement_id: number; count: number }>('/api/statements', body),
  delete: (id: number) => del(`/api/statements/${id}`),
  rename: (id: number, name: string) => patch(`/api/statements/${id}/name`, { name }),
  transactions: (id: number) => get<Transaction[]>(`/api/statements/${id}/transactions`),
  approve: (id: number) => post(`/api/statements/${id}/approve`, {}),
  finalizeCategorize: (id: number) => post(`/api/statements/${id}/finalize_categorize`, {}),
  finalizeGst: (id: number) => post(`/api/statements/${id}/finalize_gst`, {}),
  finalizePnl: (id: number) => post(`/api/statements/${id}/finalize_pnl`, {}),
};

// ── Transactions (approve/gst editing) ───────────────────────────────────
export const transactionsApi = {
  patch: (id: number, fields: Partial<Pick<Transaction, 'date' | 'description' | 'amount'>>) =>
    patch(`/api/transactions/${id}`, fields),
  add: (statementId: number, body: { date: string; description: string; amount: number }) =>
    post<Transaction>(`/api/statements/${statementId}/transactions`, body),
  delete: (id: number) => del<{ deleted: number }>(`/api/transactions/${id}`),
};

// ── Parser / detect ──────────────────────────────────────────────────────
export const parserApi = {
  list: () => get<Parser[]>('/parsers'),
  detect: (file: File) => {
    const fd = new FormData();
    fd.append('pdf', file);
    return postForm<DetectResult>('/detect', fd);
  },
  parse: (opts: { tmpToken?: string; file?: File; bankId?: string }): Promise<ParseResult> => {
    if (opts.tmpToken) {
      return post<ParseResult>('/parse', { tmp_token: opts.tmpToken, bank_id: opts.bankId });
    }
    const fd = new FormData();
    fd.append('pdf', opts.file!);
    if (opts.bankId) fd.append('bank_id', opts.bankId);
    return postForm<ParseResult>('/parse', fd);
  },
  pdfPage: (tmpToken: string, page: number, highlight?: string | number) => {
    let url = `/pdf_page?tmp_token=${tmpToken}&page=${page}`;
    if (highlight) url += `&highlight=${highlight}`;
    return get<{ image: string }>(url);
  },
};

// ── Categories ───────────────────────────────────────────────────────────
export const categoryApi = {
  list: (activeOnly = true) =>
    get<Category[]>(`/api/categories${activeOnly ? '' : '?active_only=false'}`),
  create: (body: Partial<Category>) => post<Category>('/api/categories', body),
  update: (id: number, field: string, value: unknown) =>
    patch<Category>(`/api/categories/${id}`, { [field]: value }),
  delete: (id: number) => del<{ deleted?: number; deactivated?: boolean; message?: string }>(`/api/categories/${id}`),

  potentialDuplicates: () =>
    get<{ pairs: PotentialDuplicatePair[]; count: number }>('/api/categories/potential-duplicates'),
  merge: (fromId: number, intoId: number) =>
    post<{ merged: boolean; kept: string; removed: string; moved_transactions: number; moved_vendor_memory: number; error?: string }>('/api/categories/merge', { from_id: fromId, into_id: intoId }),
  dismissNew: (id: number) =>
    post<{ dismissed: number }>(`/api/categories/${id}/dismiss-new`, {}),
};

// ── Categorize ───────────────────────────────────────────────────────────
export const categorizeApi = {
  // transaction_ids = numeric DB ids
  set: (stmtId: number, txnIds: number[], catId: number | null, skipVm = false) =>
    post<{ updated: number; client_id: number | null }>(
      `/api/statements/${stmtId}/categorize`,
      { transaction_ids: txnIds, category_id: catId, skip_vendor_memory: skipVm },
    ),
  groups: (stmtId: number) => get<GroupsResponse>(`/api/statements/${stmtId}/groups`),
  suggest: (stmtId: number) =>
    get<Record<string, number>>(`/api/statements/${stmtId}/suggest`).catch(() => ({})),
  // explicit vendor-memory write (single or all)
  updateVendorMemory: (stmtId: number, txnId: number) =>
    post<{ updated: boolean; pattern?: string; category?: string }>(
      `/api/statements/${stmtId}/update-vendor-memory`, { transaction_id: txnId }),
  updateAllVendorMemory: (stmtId: number) =>
    post<{ updated: boolean; count: number }>(
      `/api/statements/${stmtId}/update-vendor-memory`, { all: true }),
};

// ── GST ──────────────────────────────────────────────────────────────────
export const gstApi = {
  get: (stmtId: number) => get<GstResponse>(`/api/statements/${stmtId}/gst`),
  // amount edit uses the generic transaction patch
  patchAmount: (txnId: number, amount: number) =>
    patch(`/api/transactions/${txnId}`, { amount }),
  exportUrl: (stmtId: number) => `/api/statements/${stmtId}/export/gst`,
};

// ── P&L ──────────────────────────────────────────────────────────────────
export const pnlApi = {
  get: (stmtId: number) => get<PnlData>(`/api/statements/${stmtId}/pnl`),
  exportUrl: (stmtId: number, view: 'gross' | 'net') =>
    view === 'net'
      ? `/api/statements/${stmtId}/export/pnl?view=net`
      : `/api/statements/${stmtId}/export/pnl`,
};

// ── Vendor Memory ────────────────────────────────────────────────────────
export const vendorMemoryApi = {
  list: (clientId: number) => get<VendorMemoryEntry[]>(`/api/clients/${clientId}/vendor-memory`),
  delete: (clientId: number, vmId: number) => del(`/api/clients/${clientId}/vendor-memory/${vmId}`),
  clearAll: (clientId: number) => del(`/api/clients/${clientId}/vendor-memory`),

  rebuild: (clientId: number) =>
    post<{ repaired_merchant_patterns: number; removed: number }>(`/api/clients/${clientId}/vendor-memory/rebuild`, {}),

  // Import vendor memory from a past BAS export. Phase 1 (file only) -> headers.
  basHeaders: (clientId: number, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return postForm<{ phase: number; headers: string[]; sample: Record<string, unknown>[]; row_count: number; error?: string }>(`/api/clients/${clientId}/import-bas-history`, fd);
  },
  // Phase 2 (file + mapping) -> learns patterns, auto-creates new categories.
  basImport: (clientId: number, file: File, descCol: string, catCol: string) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('mapping', JSON.stringify({ desc_col: descCol, cat_col: catCol, auto_create_categories: true }));
    return postForm<{ phase: number; learned: number; skipped: number; total_rows: number; created_categories: string[]; unknown_categories: string[]; error?: string }>(`/api/clients/${clientId}/import-bas-history`, fd);
  },
};

// ── CSV / Excel import ───────────────────────────────────────────────────
export const importApi = {
  headers: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return postForm<ImportHeadersResponse>('/api/import/headers', fd);
  },
  importCsv: (opts: {
    file: File;
    clientId: number | null;
    quarterId: number | null;
    name: string;
    mapping: Record<string, string>;
  }) => {
    const fd = new FormData();
    fd.append('file', opts.file);
    if (opts.clientId) fd.append('client_id', String(opts.clientId));
    if (opts.quarterId) fd.append('quarter_id', String(opts.quarterId));
    fd.append('name', opts.name);
    fd.append('mapping', JSON.stringify(opts.mapping));
    return postForm<ImportCsvResponse>('/api/statements/import-csv', fd);
  },
};

// ── Consolidation ────────────────────────────────────────────────────────
export const consolidationApi = {
  // Merge multiple statements (PDF/Excel) into one new consolidated statement (name required)
  mergeStatements: (quarterId: number, statementIds: number[], name: string) =>
    post<{ consolidated_statement_id?: number; txn_count?: number; name?: string; error?: string }>(
      `/api/quarters/${quarterId}/consolidate`, { statement_ids: statementIds, name }),

  // Live (unsaved) combined GST + P&L for a quarter, with per-statement breakdown
  quarterSummary: (quarterId: number) =>
    get<ConsolidationSummary>(`/api/quarters/${quarterId}/consolidate/summary`).catch((e) => {
      throw e;
    }),

  // Annual/yearly combined GST + P&L across multiple quarters, with per-quarter breakdown
  annualSummary: (clientId: number, label: string, quarterIds: number[]) =>
    post<AnnualConsolidation>(`/api/clients/${clientId}/consolidate/annual`,
      { client_id: clientId, label, quarter_ids: quarterIds }),

  annualList: (clientId: number) =>
    get<Array<{ id: number; label: string; quarter_ids: number[]; created_at: string }>>(
      `/api/clients/${clientId}/consolidate/annual`).catch(() => []),

  annualGet: (clientId: number, aid: number) =>
    get<AnnualConsolidation>(`/api/clients/${clientId}/consolidate/annual/${aid}`),
};

// ── AI Providers (Vision + Categorize) ───────────────────────────────────
export interface AiProvider { id: string; label: string; configured: boolean; vision: boolean; env_key: string; }

export interface ReviewItem { review_id: string; raw: string; reason: string; date: string; description: string; amount: number; }

export const aiApi = {
  providers: () => get<AiProvider[]>('/api/ai/providers'),

  visionPrompt: () => get<{ prompt: string }>('/api/ai/vision/prompt'),

  // Direct provider call — upload a document, get structured transactions back
  visionExtract: (file: File, provider: string) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('provider', provider);
    return postForm<{ transactions?: Transaction[]; review?: ReviewItem[]; count?: number; review_count?: number; provider?: string; raw?: string; error?: string }>('/api/ai/vision/extract', fd);
  },

  // Paste-back path — user ran our prompt elsewhere, pastes JSON back
  visionExtractText: (responseText: string) =>
    post<{ transactions?: Transaction[]; review?: ReviewItem[]; count?: number; review_count?: number; error?: string }>('/api/ai/vision/extract-text', { response_text: responseText }),

  // Categorize prompt (existing route) — returns batches of ready-to-run prompts
  categorizePrompt: (sid: number) =>
    get<{ batches: Array<{ batch_num: number; total_batches: number; count: number; label: string; prompt: string }>; total_uncategorized: number; message?: string }>(`/api/statements/${sid}/ai-categorize/prompt`),

  // Direct provider categorize — returns raw "id: Category" text
  categorizeViaProvider: (sid: number, provider: string) =>
    post<{ response_text?: string; provider?: string; error?: string }>(`/api/ai/categorize/${sid}`, { provider }),

  // Apply pasted/returned "id: Category" text (existing route)
  categorizeApply: (sid: number, responseText: string) =>
    post<{ applied: number; applied_detail: Array<{ id: string; description: string; category: string }>; errors: Array<{ line: string; reason: string }> }>(`/api/statements/${sid}/ai-categorize/apply`, { response_text: responseText }),
};
