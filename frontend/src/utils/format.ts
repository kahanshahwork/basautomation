/**
 * utils/format.ts
 * Matches fmt() and esc() from original index.html exactly.
 */

/** Format a number as Australian dollar string (e.g. "$1,234.56" or "-$1,234.56") */
export function fmt(n: number | null | undefined): string {
  const v = n ?? 0;
  return (v < 0 ? '-$' : '$') +
    Math.abs(v).toLocaleString('en-AU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
}

/** Safe HTML escape */
export function esc(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Export transactions to CSV (matches original exportBtn logic) */
export function exportToCsv(
  rows: Array<{
    transaction_id: string;
    date: string;
    description: string;
    source_page?: number;
    amount: number;
  }>
): void {
  const data = [
    ['ID', 'Date', 'Description', 'Page', 'Amount', 'Type'],
    ...rows.map((t) => [
      t.transaction_id,
      t.date,
      t.description,
      t.source_page,
      t.amount,
      t.amount > 0 ? 'CR' : 'DR',
    ]),
  ];
  const csv = data.map((r) => r.map((c) => JSON.stringify(c ?? '')).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'transactions.csv';
  a.click();
}
