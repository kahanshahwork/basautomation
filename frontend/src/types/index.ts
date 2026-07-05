// ── Core domain types (verified against live Flask API) ──────────────────

export interface Advisor {
  id: number;
  name: string;
  firm?: string | null;
  email?: string | null;
  client_count?: number;
  created_at?: string;
}

export interface Client {
  id: number;
  name: string;
  business_type: string;
  advisor_id?: number | null;
  created_at?: string;
}

export interface BusinessType {
  code: string;
  label: string;
  description?: string;
}

export interface Quarter {
  id: number;
  client_id: number;
  year?: string | null;
  label: string;
  period_start: string | null;
  period_end: string | null;
}

export interface YearGroup {
  year: string;
  quarters: Quarter[];
  quarter_count: number;
}

export interface Statement {
  id: number;
  quarter_id?: number;
  bank_id: string;
  statement_name: string | null;
  filename: string | null;
  status: 'parsed' | 'approved' | 'categorized' | 'gst_reviewed' | 'finalized' | string;
  txn_count?: number;
  created_at?: string;
}

// A parsed/stored transaction. IMPORTANT: two ids exist —
//   `id`             = numeric DB primary key → used by categorize/patch/suggest
//   `transaction_id` = string parser id       → used only for parse-page display/ambiguous
export interface Transaction {
  id?: number;                 // DB id (present once saved to a statement)
  transaction_id: string;      // parser id
  date: string;
  description: string;
  amount: number;
  balance?: number | null;
  source_page?: number;
  row_top?: number;
  confidence?: number | null;
  group_key?: string;
  category_id?: number | null;
  category_name?: string | null;
  pnl_group?: string | null;
  gst_amount?: number | null;
  gst_applicable?: boolean;
  gst_rate?: number;
  net_amount?: number | null;
  bas_label?: string | null;
  approved?: number;
}

export interface AmbiguousTransaction {
  transaction_id: string;
  description: string;
  amount: number;
  source_page?: number;
}

export interface ParseResult {
  transactions: Transaction[];
  ambiguous?: AmbiguousTransaction[];
  bank_id: string;
  tmp_token?: string;
  meta?: { pages?: number };
  page_count?: number;
  error?: string;
}

export interface DetectResult {
  bank_id: string | null;
  display_name: string | null;
  confidence: number;
  tmp_token: string;
}

export interface Parser {
  bank_id: string;
  display_name: string;
}

export interface Category {
  id: number;
  code: string;
  name: string;
  pnl_group: 'Income' | 'Direct Cost' | 'Expense' | 'Excluded' | string;
  gst_applicable: 0 | 1;
  gst_rate: number;
  bas_label: string;
  sort_order?: number;
  is_active?: 0 | 1;
  is_new?: 0 | 1;
}

export interface VendorMemoryEntry {
  id: number;
  pattern: string;
  category_id: number;
  category_name: string;
  pnl_group: string;
  gst_applicable: number;
  hit_count: number;
  updated_at: string;
}

// ── Groups (categorize grouped view) ─────────────────────────────────────
export interface GroupTxn {
  id: number;
  date: string;
  description: string;
  amount: number;
  category_id: number | null;
}
export interface TxnGroup {
  group_key: string;
  sample_description: string;
  count: number;
  total: number;
  dominant_category_id: number | null;
  transactions: GroupTxn[];
}
export interface GroupsResponse {
  credit: TxnGroup[];
  debit: TxnGroup[];
}

// ── GST ──────────────────────────────────────────────────────────────────
export interface BasSummary {
  G1: number; G10: number; G11: number;
  '1A': number; '1B': number;
  net_gst_payable: number;
  [k: string]: number;
}
export interface GstCategoryRow {
  category: string;
  pnl_group: string;
  bas_label: string;
  gross: number;
  gst: number;
  net: number;
  count: number;
  gst_applicable?: boolean;
}
export interface GstResponse {
  transactions: Transaction[];
  summary: {
    bas: BasSummary;
    by_category: GstCategoryRow[];
    gst_collected: number;
    gst_paid: number;
    net_gst_payable: number;
  };
}

// ── P&L ──────────────────────────────────────────────────────────────────
export interface PnlCategoryRow {
  category: string;
  pnl_group: string;
  amount: number;       // gross
  net_amount: number;   // gst-adjusted
  count: number;
}
export interface PnlData {
  gross_category_rows: PnlCategoryRow[];
  gross_total_income: number;
  gross_total_expense: number;
  gross_total_direct_cost: number;
  gross_net_profit: number;
  gross_profit: number;
  gross_profit_gross: number;
  total_income: number;
  total_expense: number;
  net_profit: number;
}

// ── CSV import ───────────────────────────────────────────────────────────
export interface ImportHeadersResponse {
  headers: string[];
  sample: Record<string, unknown>[];
  row_count?: number;
  error?: string;
}
export interface ImportCsvResponse {
  statement_id: number;
  transactions: Transaction[];
  error?: string;
}

// ── UI helper types ──────────────────────────────────────────────────────
export type AmbDecision = 'cr' | 'dr' | 'skip';
export type SortCol = 'transaction_id' | 'date' | 'description' | 'amount' | 'source_page';
export type SortDir = 1 | -1;

// ── Consolidation ────────────────────────────────────────────────────────
export interface ConsolidatedData {
  gst: GstResponse['summary'];
  pnl: PnlData;
}

export interface PerStatementSummary {
  id: number;
  bank_id: string;
  statement_name: string;
  status: string;
  txn_count: number;
  categorized: number;
  created_at?: string;
  gst: GstResponse['summary'];
  pnl: PnlData;
}

export interface ConsolidationSummary {
  quarter_id: number;
  quarter_label: string;
  client_id: number;
  statement_count: number;
  txn_count: number;
  consolidated: ConsolidatedData;
  per_statement: PerStatementSummary[];
  error?: string;
}

export interface PerQuarterSummary {
  quarter_id: number;
  quarter_label: string;
  statement_count: number;
  txn_count: number;
  gst: GstResponse['summary'];
  pnl: PnlData;
}

export interface AnnualConsolidation {
  id?: number;
  client_id: number;
  label: string;
  quarter_count?: number;
  txn_count: number;
  consolidated: ConsolidatedData;
  per_quarter: PerQuarterSummary[];
  created_at?: string;
}

// ── Potential duplicate categories (from BAS import) ──────────────────────
export interface DuplicateMatch {
  category: Pick<Category, 'id' | 'name' | 'code' | 'pnl_group' | 'bas_label' | 'is_new' | 'gst_applicable'>;
  shared_words: string[];
}
export interface PotentialDuplicatePair {
  new_category: Pick<Category, 'id' | 'name' | 'code' | 'pnl_group' | 'bas_label' | 'is_new' | 'gst_applicable'>;
  matches: DuplicateMatch[];
}
