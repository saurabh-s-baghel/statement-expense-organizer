import { normalizeRows, parseCsv, type Transaction } from './ledger';

export const DEMO_CSV = `Date,Description,Amount,Currency,Type,Category
2026-10-24,Juniper Market,-86.42,CAD,expense,Groceries
2026-10-23,Northline Payroll,2450.00,CAD,income,Income
2026-10-22,Elm Street Coffee,-6.75,CAD,expense,Food & Dining
2026-10-21,City Transit Pass,-112.00,CAD,expense,Transport
2026-10-20,Cloud Studio,-19.00,CAD,expense,Entertainment
2026-10-19,Juniper Market refund,12.50,CAD,refund,Groceries
2026-10-18,Transfer to savings,-400.00,CAD,transfer,Transfer
2026-10-17,Maple Kitchen,-42.80,CAD,expense,Food & Dining
2026-10-16,Westside Pharmacy,-24.16,CAD,expense,Health
2026-10-15,Home Internet,-79.00,CAD,expense,Utilities
2026-10-14,Paper & Pine Books,-28.95,CAD,expense,Shopping
2026-10-13,Elm Street Coffee,-6.75,CAD,expense,Food & Dining`;

export function createDemo(): Transaction[] {
  return normalizeRows(parseCsv(DEMO_CSV), { date: 'Date', description: 'Description', amount: 'Amount', currency: 'Currency', type: 'Type', category: 'Category', dateFormat: 'ISO', signConvention: 'negative-expense' }, { fileName: 'Synthetic demo' }).transactions.map(transaction => ({ ...transaction, needsReview: false, issues: [] }));
}
