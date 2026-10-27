'use client';

import { useState } from 'react';
import { formatCents, parseMoneyToCents, parseTransactionDate, type Transaction, type TransactionType, type Currency } from '@/lib/ledger';
import { type AppConfig } from '@/lib/config';
import { ConfiguredForm } from './configured-form';
import { Modal } from './modal';

export function TransactionEditor({ transaction, config, documentSource, onSave, onClose }: { transaction: Transaction; config: AppConfig; documentSource?: string; onSave: (value: Transaction) => void; onClose: () => void }) {
  const [date, setDate] = useState(transaction.date ?? '');
  const [description, setDescription] = useState(transaction.description);
  const [amount, setAmount] = useState(transaction.amountCents === null ? '' : formatCents(transaction.amountCents));
  const [currency, setCurrency] = useState(transaction.currency);
  const [type, setType] = useState(transaction.type);
  const [values, setValues] = useState({ category: transaction.category ?? 'Uncategorized', note: transaction.note ?? '' });
  const [confirmed, setConfirmed] = useState(!transaction.needsReview);
  const [error, setError] = useState('');
  const [currencyConfirmed, setCurrencyConfirmed] = useState(!transaction.issues.some(issue => issue.code === 'invalid-currency' || issue.code === 'currency-conflict'));
  return <Modal title="Review transaction" subtitle="Compare each value with the original source before confirming." onClose={onClose}>
    <form onSubmit={event => {
      event.preventDefault();
      if (!/^(?:[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?|\(\s*(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?\s*\))$/.test(amount.trim())) {
        setError('Enter a numeric amount with up to two decimal places, without currency symbols or codes. Select the currency separately.');
        return;
      }
      const cents = parseMoneyToCents(amount);
      const validDate = parseTransactionDate(date, 'ISO');
      if (!validDate || !description.trim() || cents === null) { setError('Enter a valid date, description, and amount with up to two decimal places.'); return; }
      if ((type === 'expense' && cents > 0) || ((type === 'income' || type === 'refund') && cents < 0)) { setError('Expenses must be zero or negative. Income and refunds must be zero or positive. Transfers can use either sign.'); return; }
      if (!config.categories.includes(values.category)) { setError('Select a listed category.'); return; }
      if (!currencyConfirmed) { setError('Resolve the source currency before saving. This app does not convert currencies.'); return; }
      onSave({ ...transaction, date: validDate, description: description.trim(), amountCents: cents, currency, type, category: values.category, note: values.note, suggestedCategory: null, needsReview: !confirmed, issues: confirmed ? [] : [{ code: 'manual-review', message: 'Awaiting source confirmation.', row: transaction.row }] });
    }}>
      <div className="modal-body">
        {!!transaction.issues.length && <div className="alert"><strong>Check these source details</strong><ul className="issue-list">{transaction.issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul></div>}
        {transaction.suggestedCategory && <p className="help-text" style={{ marginBottom: 16 }}>Suggested category: {transaction.suggestedCategory}. Choose a category below to accept or correct it.</p>}
        {!currencyConfirmed && <div className="alert"><p>The source currency is unsupported or conflicts with your selection. Confirm the actual currency from the statement. Do not relabel a value that needs conversion.</p><label className="check-label"><input type="checkbox" checked={currencyConfirmed} onChange={event => setCurrencyConfirmed(event.target.checked)}/>I verified that the selected currency matches the source amount.</label></div>}
        <div className="form-grid"><label>Date<input type="date" required value={date} onChange={event => setDate(event.target.value)}/></label><label>Transaction type<select value={type} onChange={event => setType(event.target.value as TransactionType)}>{['expense', 'income', 'refund', 'transfer'].map(value => <option key={value}>{value}</option>)}</select></label><label className="full-width">Description<input type="text" required maxLength={500} value={description} onChange={event => setDescription(event.target.value)}/></label><label>Signed amount<input type="text" inputMode="decimal" required value={amount} onChange={event => setAmount(event.target.value)}/></label><label>Currency<select value={currency} onChange={event => setCurrency(event.target.value as Currency)}>{['CAD', 'USD', 'EUR', 'GBP'].map(value => <option key={value}>{value}</option>)}</select></label><div className="full-width"><ConfiguredForm config={config.form} values={values} onChange={(field, value) => setValues(previous => ({ ...previous, [field]: value }))}/></div></div>
        <h3 style={{ marginTop: 20, marginBottom: 7 }}>Original source · row {transaction.row}</h3><pre className="source-context">{transaction.sourceText}</pre>
        {documentSource && <details><summary className="help-text">Compare full extracted document (unverified)</summary><pre className="source-context">{documentSource}</pre><p className="help-text">The full extraction stays in this workspace and is not repeated in each exported row. Exports retain your CSV row and source reference.</p></details>}
        {transaction.duplicateOf && <p className="alert">Possible duplicate retained. Confirm only if this is a separate transaction or intentionally retained entry.</p>}
        <label className="check-label" style={{ marginTop: 18 }}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>I checked this row against the source, including its sign and type.</label>
        {error && <p role="alert" className="alert">{error}</p>}
      </div>
      <div className="modal-footer"><button className="secondary" type="button" onClick={onClose}>Cancel</button><button className="button" type="submit">Save transaction</button></div>
    </form>
  </Modal>;
}
