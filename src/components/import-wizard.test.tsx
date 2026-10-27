import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from '@/lib/ledger';
import { ImportWizard } from './import-wizard';

vi.mock('./document-import', () => ({
  DocumentImport: ({ onText }: { onText: (text: string, provenance: string) => void }) => <button onClick={() => onText('[P1:L1] Synthetic document A', 'synthetic-document-A.pdf; user confirmed review')}>Use synthetic reviewed document</button>,
}));

const validCsv = 'Date,Description,Amount,Category,Type\n2026-10-01,Synthetic Alpha,-12.34,Uncategorized,expense\n2026-10-02,Synthetic Beta,25.00,Uncategorized,income';

function setup() {
  const onImport = vi.fn<(transactions: Transaction[], documentSource?: string) => void>();
  const onClose = vi.fn();
  render(<ImportWizard onImport={onImport} onClose={onClose} />);
  return { user: userEvent.setup(), onImport, onClose };
}

async function pasteCsv(user: ReturnType<typeof userEvent.setup>, csv: string) {
  await user.click(screen.getByRole('button', { name: 'Paste CSV' }));
  await user.click(screen.getByRole('textbox', { name: 'CSV with a header row' }));
  await user.paste(csv);
  await user.click(screen.getByRole('button', { name: 'Preview columns' }));
}

describe('ImportWizard', () => {
  it.each(['CSV file', 'independent paste'] as const)('clears reviewed document provenance when switching to a new %s', async (input) => {
    const { user, onImport } = setup();
    await user.upload(screen.getByLabelText('Statement file'), new File(['Synthetic document A'], 'synthetic-document-A.pdf', { type: 'application/pdf' }));
    await user.click(screen.getByRole('button', { name: 'Use synthetic reviewed document' }));
    const documentCsv = screen.getByRole('textbox', { name: 'CSV with a header row' });
    await user.clear(documentCsv);
    await user.type(documentCsv, 'Date,Description,Amount,Source line\n2026-10-01,Synthetic document A,-12.34,P1:L1');
    await user.click(screen.getByRole('button', { name: 'Preview columns' }));
    await user.selectOptions(screen.getByRole('combobox', { name: /Source page\/line column/ }), 'Source line');
    await user.click(screen.getByRole('checkbox', { name: /I verified the date format/ }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(documentCsv).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    if (input === 'CSV file') {
      const csv = new File([validCsv], 'synthetic-B.csv', { type: 'text/csv' });
      Object.defineProperty(csv, 'text', { value: vi.fn().mockResolvedValue(validCsv) });
      await user.upload(screen.getByLabelText('Statement file'), csv);
    } else {
      await user.click(screen.getByRole('button', { name: 'Paste CSV' }));
      expect(screen.getByRole('textbox', { name: 'CSV with a header row' })).toHaveValue('');
      expect(screen.queryByText('Extracted source · unverified')).not.toBeInTheDocument();
      await user.click(screen.getByRole('textbox', { name: 'CSV with a header row' }));
      await user.paste(validCsv);
      await user.click(screen.getByRole('button', { name: 'Preview columns' }));
    }
    expect(screen.queryByRole('combobox', { name: /Source page\/line column/ })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /I verified the date format/ })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: /I verified the date format/ }));
    await user.click(screen.getByRole('button', { name: 'Add 2 rows to review' }));
    expect(onImport).toHaveBeenCalledTimes(1);
    const [rows, documentSource] = onImport.mock.calls[0];
    expect(documentSource).toBeUndefined();
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.fileName === (input === 'CSV file' ? 'synthetic-B.csv' : 'Pasted data'))).toBe(true);
    for (const row of rows) {
      expect(row.sourceText).not.toContain('Document reference:');
      expect(row.sourceText).not.toContain('Synthetic document A');
    }
  });

  it('preserves reviewed document provenance for its own manual transcription', async () => {
    const { user, onImport } = setup();
    await user.upload(screen.getByLabelText('Statement file'), new File(['Synthetic document A'], 'synthetic-document-A.pdf', { type: 'application/pdf' }));
    await user.click(screen.getByRole('button', { name: 'Use synthetic reviewed document' }));
    expect(screen.getByText('Extracted source · unverified')).toBeInTheDocument();
    const csv = screen.getByRole('textbox', { name: 'CSV with a header row' });
    expect(csv).toHaveValue('Date,Description,Amount,Source line\n');
    await user.click(csv);
    await user.paste('2026-10-01,Synthetic document A,-12.34,P1:L1');
    await user.click(screen.getByRole('button', { name: 'Preview columns' }));
    await user.selectOptions(screen.getByRole('combobox', { name: /Source page\/line column/ }), 'Source line');
    await user.click(screen.getByRole('checkbox', { name: /I verified the date format/ }));
    await user.click(screen.getByRole('button', { name: 'Add 1 rows to review' }));
    expect(onImport).toHaveBeenCalledTimes(1);
    const [rows, documentSource] = onImport.mock.calls[0];
    expect(documentSource).toBe('synthetic-document-A.pdf; user confirmed review\n\n[P1:L1] Synthetic document A');
    expect(rows[0]).toMatchObject({ fileName: 'synthetic-document-A.pdf' });
    expect(rows[0].sourceText).toContain('Document reference: P1:L1.');
  });

  it('previews mapping without importing and requires explicit verification before adding every row to review', async () => {
    const { user, onImport } = setup();
    await pasteCsv(user, validCsv);
    expect(screen.getByRole('heading', { name: 'Map your columns' })).toBeInTheDocument();
    expect(onImport).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Date column')).toHaveValue('Date');
    expect(screen.getByLabelText('Description column')).toHaveValue('Description');
    expect(screen.getByLabelText('Amount column')).toHaveValue('Amount');
    const add = screen.getByRole('button', { name: 'Add 2 rows to review' });
    const verification = screen.getByRole('checkbox', { name: /I verified the date format/ });
    expect(verification).not.toBeChecked();
    expect(add).toBeDisabled();
    await user.click(add);
    expect(onImport).not.toHaveBeenCalled();
    await user.click(verification);
    expect(add).toBeEnabled();
    expect(onImport).not.toHaveBeenCalled();
    await user.click(add);
    expect(onImport).toHaveBeenCalledTimes(1);
    const [rows, documentSource] = onImport.mock.calls[0];
    expect(rows).toHaveLength(2);
    expect(rows).toMatchObject([
      { description: 'Synthetic Alpha', date: '2026-10-01', amountCents: -1234,
        type: 'expense', currency: 'CAD', category: 'Uncategorized', needsReview: true, issues: [], row: 2 },
      { description: 'Synthetic Beta', date: '2026-10-02', amountCents: 2500,
        type: 'income', currency: 'CAD', category: 'Uncategorized', needsReview: true, issues: [], row: 3 },
    ]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
    expect(rows.every((row) => row.sourceText.includes(row.description))).toBe(true);
    expect(documentSource).toBeUndefined();
  });

  it('disables adding again when verification is revoked and resets verification after returning to paste', async () => {
    const { user, onImport } = setup();
    await pasteCsv(user, validCsv);
    const verification = screen.getByRole('checkbox', { name: /I verified the date format/ });
    await user.click(verification);
    expect(screen.getByRole('button', { name: 'Add 2 rows to review' })).toBeEnabled();
    await user.click(verification);
    expect(screen.getByRole('button', { name: 'Add 2 rows to review' })).toBeDisabled();
    await user.click(verification);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('textbox', { name: 'CSV with a header row' })).toHaveValue(validCsv);
    await user.click(screen.getByRole('button', { name: 'Preview columns' }));
    expect(screen.getByRole('checkbox', { name: /I verified the date format/ })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Add 2 rows to review' })).toBeDisabled();
    expect(onImport).not.toHaveBeenCalled();
  });

  it.each([
    { csv: 'Date,Description,Description\n2026-10-01,Synthetic,12.00', error: 'Duplicate column names must be corrected before mapping.' },
    { csv: 'Date,,Amount\n2026-10-01,Synthetic,12.00', error: 'Every column needs a nonempty header.' },
    { csv: 'Date,Description,Amount', error: 'Include a header row and at least one transaction row.' },
  ])('rejects invalid CSV preparation: $error', async ({ csv, error }) => {
    const { user, onImport } = setup();
    await pasteCsv(user, csv);
    expect(screen.getByRole('alert')).toHaveTextContent(error);
    expect(screen.queryByRole('heading', { name: 'Map your columns' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'CSV with a header row' })).toHaveValue(csv);
    expect(onImport).not.toHaveBeenCalled();
  });

  it('retains an internal blank row and a malformed amount for explicit review', async () => {
    const { user, onImport } = setup();
    await pasteCsv(user, 'Date,Description,Amount\n2026-10-01,Synthetic Alpha,-12.34\n\n2026-10-02,Synthetic Beta,not-money');
    expect(screen.getByText(/3 source rows retained/)).toBeInTheDocument();
    expect(onImport).not.toHaveBeenCalled();
    await user.click(screen.getByRole('checkbox', { name: /I verified the date format/ }));
    await user.click(screen.getByRole('button', { name: 'Add 3 rows to review' }));
    expect(onImport).toHaveBeenCalledTimes(1);
    const rows = onImport.mock.calls[0][0];
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.needsReview)).toBe(true);
    expect(rows.map((row) => row.row)).toEqual([2, 3, 4]);
    expect(rows[1]).toMatchObject({ date: null, description: '', amountCents: null, sourceText: '\n' });
    expect(rows[1].issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['invalid-date', 'missing-description', 'invalid-amount']));
    expect(rows[2]).toMatchObject({ description: 'Synthetic Beta', amountCents: null });
    expect(rows[2].sourceText).toContain('not-money');
    expect(rows[2].issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-amount' })]));
  });
});
