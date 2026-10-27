import { describe, expect, it } from 'vitest';
import type { Transaction } from './ledger';
import { money, summarize } from './summary';

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'synthetic-row', date: '2026-10-01', description: 'Synthetic groceries',
    amountCents: -1250, currency: 'CAD', type: 'expense', category: 'Groceries',
    suggestedCategory: null, needsReview: false, issues: [], duplicateOf: null,
    sourceText: '2026-10-01,Synthetic groceries,-12.50', row: 2, fileName: null,
    ...overrides,
  };
}

describe('summarize', () => {
  it('excludes unreviewed rows of every type from all totals and categories', () => {
    const pending = (['expense', 'income', 'refund', 'transfer'] as const).map((type) =>
      transaction({ type, amountCents: type === 'expense' ? -9900 : 9900, needsReview: true, category: 'Pending' }));
    expect(summarize([transaction(), ...pending], 'CAD')).toEqual({
      spending: 1250, income: 0, refunds: 0, transfers: 0, confirmed: 1,
      net: -1250, categories: [['Groceries', 1250]], overflow: false,
    });
  });

  it('keeps currencies separate without converting or combining them', () => {
    const rows = [transaction(), transaction({ currency: 'USD', amountCents: -4000 }),
      transaction({ currency: 'EUR', type: 'income', amountCents: 5000 }),
      transaction({ currency: 'GBP', type: 'refund', amountCents: 600 })];
    expect(summarize(rows, 'CAD')).toMatchObject({ spending: 1250, income: 0, refunds: 0, confirmed: 1 });
    expect(summarize(rows, 'USD')).toMatchObject({ spending: 4000, net: -4000, confirmed: 1 });
    expect(summarize(rows, 'EUR')).toMatchObject({ spending: 0, income: 5000, net: 5000, confirmed: 1 });
    expect(summarize(rows, 'GBP')).toMatchObject({ spending: 0, refunds: 600, net: 600, confirmed: 1 });
  });

  it('reports refunds distinctly and excludes signed transfers from spending, income, and net', () => {
    const result = summarize([
      transaction({ amountCents: -5000 }),
      transaction({ type: 'income', amountCents: 20000, category: 'Income' }),
      transaction({ type: 'refund', amountCents: 1200 }),
      transaction({ type: 'transfer', amountCents: -9000, category: 'Transfer' }),
      transaction({ type: 'transfer', amountCents: 4000, category: 'Transfer' }),
    ], 'CAD');
    expect(result).toEqual({ spending: 5000, income: 20000, refunds: 1200, transfers: -5000,
      confirmed: 5, net: 16200, categories: [['Groceries', 5000]], overflow: false });
  });

  it('aggregates expense categories in descending order and retains uncategorized expenses', () => {
    const rows = [transaction({ amountCents: -101 }), transaction({ amountCents: -202 }),
      transaction({ category: 'Housing', amountCents: -10000 }),
      transaction({ category: null, amountCents: -77 })];
    const before = structuredClone(rows);
    expect(summarize(rows, 'CAD')).toMatchObject({ spending: 10380,
      categories: [['Housing', 10000], ['Groceries', 303], ['Uncategorized', 77]] });
    expect(rows).toEqual(before);
  });

  it('excludes missing dates and amounts even if a row is marked confirmed', () => {
    expect(summarize([transaction({ date: null }), transaction({ amountCents: null })], 'CAD'))
      .toEqual(summarize([], 'CAD'));
  });

  it('returns zero totals for empty input and counts a confirmed zero amount', () => {
    expect(summarize([], 'CAD')).toEqual({ spending: 0, income: 0, refunds: 0, transfers: 0,
      confirmed: 0, net: 0, categories: [], overflow: false });
    expect(summarize([transaction({ type: 'income', amountCents: 0 })], 'CAD'))
      .toMatchObject({ income: 0, confirmed: 1, net: 0, categories: [] });
  });

  it('does not flag the largest exactly representable integer-cent total', () => {
    expect(summarize([transaction({ amountCents: -Number.MAX_SAFE_INTEGER })], 'CAD'))
      .toMatchObject({ spending: Number.MAX_SAFE_INTEGER, net: -Number.MAX_SAFE_INTEGER, overflow: false });
  });

  it.each(['expense', 'income', 'refund', 'transfer'] as const)('flags %s aggregation overflow and returns zero sentinels', (type) => {
    const sign = type === 'expense' ? -1 : 1;
    const result = summarize([
      transaction({ type, amountCents: sign * Number.MAX_SAFE_INTEGER }),
      transaction({ type, amountCents: sign }),
    ], 'CAD');
    expect(result).toEqual({ spending: 0, income: 0, refunds: 0, transfers: 0,
      net: 0, confirmed: 2, overflow: true, categories: [] });
  });

  it('detects net overflow when individual income and refund totals are safe', () => {
    expect(summarize([
      transaction({ type: 'income', amountCents: Number.MAX_SAFE_INTEGER }),
      transaction({ type: 'refund', amountCents: 1 }),
    ], 'CAD')).toEqual({ spending: 0, income: 0, refunds: 0, transfers: 0,
      net: 0, confirmed: 2, overflow: true, categories: [] });
  });

  it('detects negative transfer overflow and suppresses otherwise valid totals', () => {
    expect(summarize([
      transaction({ type: 'transfer', amountCents: -Number.MAX_SAFE_INTEGER }),
      transaction({ type: 'transfer', amountCents: -1 }), transaction(),
    ], 'CAD')).toEqual({ spending: 0, income: 0, refunds: 0, transfers: 0,
      net: 0, confirmed: 3, overflow: true, categories: [] });
  });

  it('accumulates transfers exactly through intermediate overflow and cancellation regardless of row order', () => {
    const rows = [Number.MAX_SAFE_INTEGER, 2, -Number.MAX_SAFE_INTEGER].map((amountCents) =>
      transaction({ type: 'transfer', amountCents }));
    for (const ordered of [rows, [...rows].reverse(), [rows[0], rows[2], rows[1]]]) {
      expect(summarize(ordered, 'CAD')).toEqual({ spending: 0, income: 0, refunds: 0,
        transfers: 2, net: 0, confirmed: 3, overflow: false, categories: [] });
    }
  });

  it('does not let excluded review rows or other currencies trigger overflow', () => {
    expect(summarize([
      transaction({ amountCents: -Number.MAX_SAFE_INTEGER, needsReview: true }),
      transaction({ amountCents: -Number.MAX_SAFE_INTEGER, currency: 'USD' }),
      transaction(),
    ], 'CAD')).toMatchObject({ spending: 1250, confirmed: 1, overflow: false });
  });
});

describe('money', () => {
  it.each([
    [Number.MAX_SAFE_INTEGER, '$90,071,992,547,409.91'],
    [-Number.MAX_SAFE_INTEGER, '-$90,071,992,547,409.91'],
    [Number.MAX_SAFE_INTEGER - 1, '$90,071,992,547,409.90'],
    [-1, '-$0.01'], [1, '$0.01'], [0, '$0.00'],
  ])('preserves exact cents when formatting %s', (cents, formatted) => {
    expect(money(cents)).toBe(formatted);
  });

  it('uses the selected currency symbol without converting the amount', () => {
    expect(money(12345, 'USD')).toBe('$123.45');
    expect(money(12345, 'EUR')).toBe('€123.45');
    expect(money(-1, 'GBP')).toBe('-£0.01');
  });

  it.each([Number.MAX_SAFE_INTEGER + 1, -Number.MAX_SAFE_INTEGER - 1, 0.5, NaN, Infinity])('marks unsafe or non-integer cents unavailable: %s', (cents) => {
    expect(money(cents)).toBe('Amount out of range');
  });
});
