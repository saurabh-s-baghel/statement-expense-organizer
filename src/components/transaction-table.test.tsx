import type { ComponentProps } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from '@/lib/ledger';
import { TransactionTable } from './transaction-table';

const transactions: Transaction[] = [
  { id: 'coffee', date: '2026-10-01', description: 'Synthetic coffee', amountCents: -450,
    currency: 'CAD', type: 'expense', category: 'Food & Dining', suggestedCategory: null,
    needsReview: false, issues: [], duplicateOf: null, sourceText: 'Synthetic coffee,-4.50', row: 2, fileName: null },
  { id: 'refund', date: '2026-10-02', description: 'Synthetic refund', amountCents: 1200,
    currency: 'USD', type: 'refund', category: 'Shopping', suggestedCategory: null,
    needsReview: true, issues: [], duplicateOf: null, sourceText: 'Synthetic refund,12.00', row: 3, fileName: null },
];

function props(overrides: Partial<ComponentProps<typeof TransactionTable>> = {}): ComponentProps<typeof TransactionTable> {
  return { transactions, totalCount: 2, reviewCount: 1, search: '', setSearch: vi.fn(),
    tab: 'all', setTab: vi.fn(), category: 'all', setCategory: vi.fn(),
    categories: ['Food & Dining', 'Shopping'], sort: { key: 'date', direction: -1 },
    setSort: vi.fn(), onEdit: vi.fn(), onImport: vi.fn(), ...overrides };
}

describe('TransactionTable', () => {
  it('sends search and category changes to the parent and reflects updated filters', async () => {
    const user = userEvent.setup();
    const current = props();
    const { rerender } = render(<TransactionTable {...current} />);
    await user.type(screen.getByRole('searchbox', { name: 'Search transactions' }), 'x');
    expect(current.setSearch).toHaveBeenLastCalledWith('x');
    await user.selectOptions(screen.getByLabelText('Filter category'), 'Shopping');
    expect(current.setCategory).toHaveBeenLastCalledWith('Shopping');
    rerender(<TransactionTable {...current} search="refund" category="Shopping" transactions={[transactions[1]]} />);
    expect(screen.getByRole('searchbox')).toHaveValue('refund');
    expect(screen.getByLabelText('Filter category')).toHaveValue('Shopping');
    expect(screen.queryByText('Synthetic coffee')).not.toBeInTheDocument();
    expect(screen.getByText('Synthetic refund')).toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 2 transactions')).toBeInTheDocument();
  });

  it('emits all review-tab callbacks and reflects the parent-selected tab', async () => {
    const user = userEvent.setup();
    const current = props();
    const { rerender } = render(<TransactionTable {...current} />);
    for (const [name, value] of [[/Needs review/, 'review'], [/Confirmed/, 'confirmed'], [/All transactions/, 'all']] as const) {
      await user.click(screen.getByRole('tab', { name }));
      expect(current.setTab).toHaveBeenLastCalledWith(value);
    }
    rerender(<TransactionTable {...current} tab="review" transactions={[transactions[1]]} />);
    expect(screen.getByRole('tab', { name: /Needs review/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /All transactions/ })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: /Confirmed/ })).toHaveTextContent('1');
  });

  it('emits sort keys and reflects parent-sorted rows and accessible direction', async () => {
    const user = userEvent.setup();
    const current = props();
    const { rerender } = render(<TransactionTable {...current} />);
    expect(screen.getByRole('columnheader', { name: 'Date' })).toHaveAttribute('aria-sort', 'descending');
    for (const [name, key] of [['Date', 'date'], ['Description', 'description'], ['Amount', 'amount'], ['Sort by amount', 'amount']]) {
      await user.click(screen.getByRole('button', { name }));
      expect(current.setSort).toHaveBeenLastCalledWith(key);
    }
    rerender(<TransactionTable {...current} sort={{ key: 'amount', direction: 1 }} />);
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByRole('columnheader', { name: 'Date' })).toHaveAttribute('aria-sort', 'none');
    rerender(<TransactionTable {...current} sort={{ key: 'amount', direction: -1 }} transactions={[transactions[1], transactions[0]]} />);
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toHaveAttribute('aria-sort', 'descending');
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Synthetic refund')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Synthetic coffee')).toBeInTheDocument();
  });

  it('opens the exact source row for editing and displays currency, type, and review status', async () => {
    const user = userEvent.setup();
    const current = props();
    render(<TransactionTable {...current} />);
    await user.click(screen.getByRole('button', { name: 'Edit Synthetic refund row 3' }));
    expect(current.onEdit).toHaveBeenCalledExactlyOnceWith(transactions[1]);
    const row = screen.getByText('Synthetic refund').closest('tr')!;
    expect(within(row).getByText('USD')).toBeInTheDocument();
    expect(within(row).getByText('Refund · row 3')).toBeInTheDocument();
    expect(within(row).getByText('Review')).toBeInTheDocument();
  });

  it('distinguishes an empty ledger from no filter matches and offers import only for an empty ledger', async () => {
    const user = userEvent.setup();
    const current = props({ transactions: [], totalCount: 0, reviewCount: 0 });
    const { rerender } = render(<TransactionTable {...current} />);
    expect(screen.getByRole('heading', { name: 'A fresh start' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import statement' }));
    expect(current.onImport).toHaveBeenCalledOnce();
    rerender(<TransactionTable {...current} totalCount={2} reviewCount={1} search="no match" />);
    expect(screen.getByRole('heading', { name: 'No matching transactions' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import statement' })).not.toBeInTheDocument();
    expect(screen.getByText('Showing 0 of 2 transactions')).toBeInTheDocument();
  });

  it('keeps malformed rows visible for correction rather than silently hiding them', () => {
    const malformed: Transaction = { ...transactions[0], date: null, amountCents: null,
      description: '', category: null, needsReview: true };
    render(<TransactionTable {...props({ transactions: [malformed], totalCount: 1, reviewCount: 1 })} />);
    expect(screen.getByText('Check date')).toBeInTheDocument();
    expect(screen.getByText('Check amount')).toBeInTheDocument();
    expect(screen.getByText('Missing description')).toBeInTheDocument();
    expect(screen.getByText('Uncategorized')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit transaction row 2' })).toBeInTheDocument();
  });
});
