import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '@/lib/config';
import type { Transaction } from '@/lib/ledger';
import { summarize } from '@/lib/summary';
import { TransactionEditor } from './transaction-editor';

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'synthetic-row', date: '2026-10-01', description: 'Synthetic coffee',
    amountCents: -450, currency: 'CAD', type: 'expense', category: 'Uncategorized',
    suggestedCategory: 'Food & Dining', needsReview: true,
    issues: [{ code: 'ocr', message: 'Check the source amount.', row: 2 }],
    duplicateOf: null, sourceText: '2026-10-01,Synthetic coffee,-4.50', row: 2,
    fileName: 'synthetic.csv', note: '', ...overrides,
  };
}

function setup(value = transaction(), documentSource?: string) {
  const onSave = vi.fn<(value: Transaction) => void>();
  const onClose = vi.fn();
  render(<TransactionEditor transaction={value} config={DEFAULT_CONFIG} documentSource={documentSource} onSave={onSave} onClose={onClose} />);
  return { user: userEvent.setup(), onSave, onClose };
}

describe('TransactionEditor', () => {
  it.each([
    { type: 'expense', amount: '4.50' },
    { type: 'income', amount: '-4.50' },
    { type: 'refund', amount: '-4.50' },
  ])('blocks an invalid $type sign even after confirmation', async ({ type, amount }) => {
    const { user, onSave } = setup();
    await user.selectOptions(screen.getByLabelText('Transaction type'), type);
    await user.clear(screen.getByLabelText('Signed amount'));
    await user.type(screen.getByLabelText('Signed amount'), amount);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Save transaction' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Expenses must be zero or negative');
  });

  it.each(['1.234', 'not money'])('blocks an invalid amount: %s', async (amount) => {
    const { user, onSave } = setup();
    await user.clear(screen.getByLabelText('Signed amount'));
    await user.type(screen.getByLabelText('Signed amount'), amount);
    await user.click(screen.getByRole('button', { name: 'Save transaction' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('up to two decimal places');
  });

  it.each(['EUR10.00', '10.00 EUR', '€10.00', '$10.00', 'CAD10.00', '£10.00', '(EUR10.00)'])('blocks embedded currency in an edited amount: %s', async (amount) => {
    const { user, onSave } = setup(transaction({ type: 'transfer', needsReview: false, issues: [] }));
    await user.clear(screen.getByLabelText('Signed amount'));
    await user.type(screen.getByLabelText('Signed amount'), amount);
    await user.click(screen.getByRole('button', { name: 'Save transaction' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Currency')).toHaveValue('CAD');
    expect(screen.getByRole('alert')).toHaveTextContent('without currency symbols or codes. Select the currency separately.');
  });

  it.each([
    { amount: '-1,234.56', cents: -123456 },
    { amount: '+1,234.56', cents: 123456 },
    { amount: '(1,234.56)', cents: -123456 },
    { amount: ' ( 10.00 ) ', cents: -1000 },
    { amount: '10', cents: 1000 },
    { amount: '0.1', cents: 10 },
  ])('accepts currency-free numeric syntax: $amount', async ({ amount, cents }) => {
    const { user, onSave } = setup(transaction({ type: 'transfer' }));
    await user.clear(screen.getByLabelText('Signed amount'));
    await user.type(screen.getByLabelText('Signed amount'), amount);
    await user.click(screen.getByRole('button', { name: 'Save transaction' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ amountCents: cents, currency: 'CAD' });
  });

  it('allows correction by entering a numeric amount and selecting its currency separately', async () => {
    const { user, onSave } = setup(transaction({ type: 'income' }));
    const amount = screen.getByLabelText('Signed amount');
    await user.clear(amount);
    await user.type(amount, 'EUR10.00');
    await user.click(screen.getByRole('button', { name: 'Save transaction' }));
    expect(onSave).not.toHaveBeenCalled();
    await user.clear(amount);
    await user.type(amount, '10.00');
    await user.selectOptions(screen.getByLabelText('Currency'), 'EUR');
    await user.click(screen.getByRole('checkbox', { name: /I checked this row against the source/ }));
    await user.click(screen.getByRole('button', { name: 'Save transaction' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ amountCents: 1000, currency: 'EUR', needsReview: false });
  });

  it('keeps unconfirmed updates pending and excluded from totals', async () => {
    const { user, onSave } = setup();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    await user.clear(screen.getByLabelText('Description'));
    await user.type(screen.getByLabelText('Description'), 'Corrected synthetic coffee');
    await user.click(screen.getByRole('button', { name: 'Save transaction' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved).toMatchObject({ description: 'Corrected synthetic coffee', needsReview: true,
      issues: [{ code: 'manual-review', message: 'Awaiting source confirmation.', row: 2 }] });
    expect(summarize([saved], 'CAD')).toMatchObject({ spending: 0, confirmed: 0 });
  });

  it('requires source confirmation to clear review and saves edited fields with provenance', async () => {
    const original = transaction({ duplicateOf: 'synthetic-original' });
    const before = structuredClone(original);
    const { user, onSave } = setup(original);
    expect(screen.getByText(original.sourceText)).toBeInTheDocument();
    expect(screen.getByText(/Possible duplicate retained/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Description'));
    await user.type(screen.getByLabelText('Description'), '  Corrected merchant  ');
    await user.clear(screen.getByLabelText('Signed amount'));
    await user.type(screen.getByLabelText('Signed amount'), '-12.34');
    await user.selectOptions(screen.getByLabelText('Category'), 'Food & Dining');
    await user.selectOptions(screen.getByLabelText('Currency'), 'USD');
    await user.type(screen.getByLabelText('Note'), 'Checked synthetic source');
    await user.click(screen.getByRole('checkbox', { name: /I checked this row against the source/ }));
    await user.click(screen.getByRole('button', { name: 'Save transaction' }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ ...original, description: 'Corrected merchant',
      amountCents: -1234, currency: 'USD', category: 'Food & Dining', note: 'Checked synthetic source',
      suggestedCategory: null, needsReview: false, issues: [] });
    expect(summarize([onSave.mock.calls[0][0]], 'USD')).toMatchObject({ spending: 1234, confirmed: 1 });
    expect(original).toEqual(before);
  });

  it.each([-125, 125])('accepts a confirmed transfer of %i cents without treating it as spending', async (amountCents) => {
    const { user, onSave } = setup(transaction({ type: 'transfer', amountCents }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Save transaction' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(summarize([onSave.mock.calls[0][0]], 'CAD')).toMatchObject({ spending: 0, income: 0, net: 0, transfers: amountCents });
  });

  it('allows an already confirmed row to be returned to review', async () => {
    const { user, onSave } = setup(transaction({ needsReview: false, issues: [] }));
    expect(screen.getByRole('checkbox')).toBeChecked();
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Save transaction' }));
    expect(onSave.mock.calls[0][0]).toMatchObject({ needsReview: true,
      issues: [{ code: 'manual-review', message: 'Awaiting source confirmation.', row: 2 }] });
  });

  it('cancels edits without saving', async () => {
    const { user, onClose, onSave } = setup();
    await user.type(screen.getByLabelText('Note'), 'Unsaved change');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it.each(['invalid-currency', 'currency-conflict'])('requires explicit currency verification for %s independently of row confirmation', async (code) => {
    const original = transaction({ issues: [{ code, message: 'Verify synthetic source currency.', row: 2 }] });
    const { user, onSave } = setup(original);
    await user.selectOptions(screen.getByLabelText('Currency'), 'USD');
    await user.click(screen.getByRole('checkbox', { name: /I checked this row against the source/ }));
    await user.click(screen.getByRole('button', { name: 'Save transaction' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Resolve the source currency before saving');
    await user.click(screen.getByRole('checkbox', { name: /I verified that the selected currency matches the source amount/ }));
    await user.click(screen.getByRole('button', { name: 'Save transaction' }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ ...original, currency: 'USD',
      suggestedCategory: null, needsReview: false, issues: [] });
  });

  it('does not treat currency verification alone as row confirmation', async () => {
    const { user, onSave } = setup(transaction({ issues: [{ code: 'invalid-currency', message: 'Verify currency.' }] }));
    await user.click(screen.getByRole('checkbox', { name: /I verified that the selected currency matches the source amount/ }));
    await user.click(screen.getByRole('button', { name: 'Save transaction' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].needsReview).toBe(true);
    expect(summarize([onSave.mock.calls[0][0]], 'CAD')).toMatchObject({ confirmed: 0, spending: 0 });
  });

  it.each([
    { amountCents: Number.MAX_SAFE_INTEGER, amount: '90071992547409.91' },
    { amountCents: -Number.MAX_SAFE_INTEGER, amount: '-90071992547409.91' },
  ])('preserves exact cents when displaying and saving $amount', async ({ amountCents, amount }) => {
    const { user, onSave } = setup(transaction({ type: 'transfer', amountCents }));
    expect(screen.getByLabelText('Signed amount')).toHaveValue(amount);
    await user.click(screen.getByRole('button', { name: 'Save transaction' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].amountCents).toBe(amountCents);
  });

  it('offers full extracted source for comparison without copying it into saved row provenance', async () => {
    const documentSource = 'Synthetic full document\n<img src=x onerror=alert(1)>\nOther synthetic row';
    const original = transaction();
    const { user, onSave } = setup(original, documentSource);
    const disclosure = screen.getByText('Compare full extracted document (unverified)');
    expect(disclosure.closest('details')).not.toHaveAttribute('open');
    await user.click(disclosure);
    expect(disclosure.closest('details')).toHaveAttribute('open');
    expect(screen.getByText(/Synthetic full document/).textContent).toBe(documentSource);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save transaction' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved.sourceText).toBe(original.sourceText);
    expect(saved).not.toHaveProperty('documentSource');
    expect(JSON.stringify(saved)).not.toContain(documentSource);
  });

  it('omits the full-document disclosure when no document source is provided', () => {
    setup();
    expect(screen.queryByText('Compare full extracted document (unverified)')).not.toBeInTheDocument();
  });
});
