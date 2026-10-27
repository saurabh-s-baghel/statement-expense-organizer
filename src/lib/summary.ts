import type { Transaction, Currency } from './ledger';

export function money(cents: number, currency: Currency = 'CAD') {
  if (!Number.isSafeInteger(cents)) return 'Amount out of range';
  const exact = BigInt(cents);
  const absolute = exact < BigInt(0) ? -exact : exact;
  const whole = absolute / BigInt(100);
  const signedWhole = exact < BigInt(0) ? whole === BigInt(0) ? -0 : -whole : whole;
  const fraction = String(absolute % BigInt(100)).padStart(2, '0');
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(signedWhole).map(part => part.type === 'fraction' ? fraction : part.value).join('');
}

export function summarize(transactions: readonly Transaction[], currency: Currency) {
  const eligible = transactions.filter(transaction => transaction.currency === currency && !transaction.needsReview && transaction.amountCents !== null && transaction.date);
  const totals = { spending: BigInt(0), income: BigInt(0), refunds: BigInt(0), transfers: BigInt(0) };
  const categories = new Map<string, bigint>();
  for (const transaction of eligible) {
    const cents = BigInt(transaction.amountCents!);
    if (transaction.type === 'expense') { totals.spending -= cents; const category = transaction.category ?? 'Uncategorized'; categories.set(category, (categories.get(category) ?? BigInt(0)) - cents); }
    if (transaction.type === 'income') totals.income += cents;
    if (transaction.type === 'refund') totals.refunds += cents;
    if (transaction.type === 'transfer') totals.transfers += cents;
  }
  const net = totals.income + totals.refunds - totals.spending;
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  const overflow = [...Object.values(totals), net, ...categories.values()].some(value => value > limit || value < -limit);
  return {
    spending: overflow ? 0 : Number(totals.spending), income: overflow ? 0 : Number(totals.income), refunds: overflow ? 0 : Number(totals.refunds), transfers: overflow ? 0 : Number(totals.transfers),
    confirmed: eligible.length, net: overflow ? 0 : Number(net), overflow,
    categories: overflow ? [] as [string, number][] : [...categories].map(([category, cents]): [string, number] => [category, Number(cents)]).sort((first, second) => second[1] - first[1])
  };
}
