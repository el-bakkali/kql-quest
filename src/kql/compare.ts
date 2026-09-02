import { canonical } from './interpreter';
import type { ResultTable, Row } from './types';

export interface Verdict {
  ok: boolean;
  reason?: string;
}

function rowKey(row: Row, columns: string[]): string {
  return columns.map((name) => `${name}=${canonical(pick(row, name))}`).join('\u0001');
}

function pick(row: Row, name: string) {
  if (name in row) return row[name];
  const lower = name.toLowerCase();
  const match = Object.keys(row).find((k) => k.toLowerCase() === lower);
  return match ? row[match] : null;
}

/** Ordering only matters when the expected answer actually asked for an order. */
export function ordersMatter(query: string): boolean {
  return /\|\s*(sort|order)\s+by\b|\|\s*top\s+\d/i.test(query);
}

export function compareResults(
  actual: ResultTable,
  expected: ResultTable,
  ordered: boolean,
): Verdict {
  const actualNames = actual.columns.map((c) => c.name);
  const expectedNames = expected.columns.map((c) => c.name);

  const actualSet = new Set(actualNames.map((n) => n.toLowerCase()));
  const expectedSet = new Set(expectedNames.map((n) => n.toLowerCase()));

  const missing = expectedNames.filter((n) => !actualSet.has(n.toLowerCase()));
  const extra = actualNames.filter((n) => !expectedSet.has(n.toLowerCase()));

  if (missing.length || extra.length) {
    const parts: string[] = [];
    if (missing.length) parts.push(`missing ${missing.map((n) => `"${n}"`).join(', ')}`);
    if (extra.length) parts.push(`unexpected ${extra.map((n) => `"${n}"`).join(', ')}`);
    return { ok: false, reason: `Column mismatch — ${parts.join(' and ')}.` };
  }

  if (actual.rows.length !== expected.rows.length) {
    return {
      ok: false,
      reason: `Columns are right, but the row count is off: expected ${expected.rows.length}, got ${actual.rows.length}.`,
    };
  }

  const actualKeys = actual.rows.map((r) => rowKey(r, expectedNames));
  const expectedKeys = expected.rows.map((r) => rowKey(r, expectedNames));

  if (ordered) {
    for (let i = 0; i < expectedKeys.length; i++) {
      if (actualKeys[i] !== expectedKeys[i]) {
        return {
          ok: false,
          reason: `Right shape, wrong data or order — first difference is on row ${i + 1}.`,
        };
      }
    }
    return { ok: true };
  }

  const sortedActual = [...actualKeys].sort();
  const sortedExpected = [...expectedKeys].sort();
  for (let i = 0; i < sortedExpected.length; i++) {
    if (sortedActual[i] !== sortedExpected[i]) {
      return { ok: false, reason: 'Right shape, but the values do not match the expected result.' };
    }
  }

  return { ok: true };
}
