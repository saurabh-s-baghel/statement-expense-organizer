'use client';

import { useRef, useState } from 'react';
import { Camera, FileSpreadsheet, FileText, UploadCloud } from 'lucide-react';
import { normalizeRows, parseCsv, type Currency, type Mapping, type ParsedCsv, type Transaction } from '@/lib/ledger';
import { DocumentImport } from './document-import';
import { Modal } from './modal';

export function ImportWizard({ onImport, onClose }: { onImport: (transactions: Transaction[], documentSource?: string) => void; onClose: () => void }) {
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [fileName, setFileName] = useState('Pasted data');
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [sourceColumn, setSourceColumn] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [currency, setCurrency] = useState<Currency>('CAD');
  const [mode, setMode] = useState('amount');
  const [mappingConfirmed, setMappingConfirmed] = useState(false);
  const [mapping, setMapping] = useState<Mapping>({ date: '', description: '', amount: '', dateFormat: 'ISO', signConvention: 'negative-expense' });
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  function prepareCsv(value: string) {
    const result = parseCsv(value);
    setError('');
    if (result.issues.length) { setError(result.issues.map(issue => issue.message).join(' ')); return; }
    if (!result.rows.length) { setError('Include a header row and at least one transaction row.'); return; }
    if (result.rows.length > 10000) { setError('This version supports up to 10,000 rows per import. Split the file into smaller parts.'); return; }
    const match = (...names: string[]) => result.headers.find(header => names.includes(header.toLowerCase())) ?? '';
    setMapping({ date: match('date', 'transaction date'), description: match('description', 'merchant', 'details'), amount: match('amount'), dateFormat: 'ISO', signConvention: 'negative-expense', currency: match('currency'), type: match('type'), category: match('category') });
    setMode('amount');
    setMappingConfirmed(false);
    setParsed(result);
  }

  function resetInput(nextFileName: string) {
    setSource('');
    setSourceColumn('');
    setParsed(null);
    setDocumentFile(null);
    setText('');
    setPasteMode(false);
    setMappingConfirmed(false);
    setError('');
    setFileName(nextFileName);
  }

  async function chooseFile(file?: File) {
    if (!file) return;
    resetInput(file.name);
    if (file.size > 20 * 1024 * 1024) { setError('Choose a file smaller than 20 MB.'); return; }
    if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
      setBusy(true);
      try { prepareCsv(await file.text()); } catch { setError('The file could not be read. Try selecting it again.'); } finally { setBusy(false); }
    } else if (file.type.startsWith('image/') || file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) { setDocumentFile(file); }
    else setError('Choose a CSV, PDF, PNG, JPEG, or WebP file. Convert HEIC photos to JPEG if your browser cannot decode them.');
  }

  const selectColumn = (label: string, field: keyof Mapping, required = false) => <label>{label}<select aria-label={label} required={required} value={mapping[field] ?? ''} onChange={event => setMapping({ ...mapping, [field]: event.target.value })}><option value="">{required ? 'Choose column…' : 'Not mapped'}</option>{parsed?.headers.map(header => <option key={header}>{header}</option>)}</select></label>;
  const ready = parsed && mapping.date && mapping.description && (mode === 'amount' ? mapping.amount : mapping.debit && mapping.credit);

  return <Modal title={parsed ? 'Map your columns' : 'Import a statement'} subtitle={parsed ? 'Confirm the source format before creating your review queue.' : 'Your file is processed on this device. No account required.'} onClose={onClose}>
    <div className="modal-body">
      {error && <p className="alert" role="alert">{error}</p>}
      {documentFile ? <DocumentImport file={documentFile} onCancel={() => setDocumentFile(null)} onText={(value, provenance) => { setSource(`${provenance}\n\n${value}`); setText('Date,Description,Amount,Source line\n'); setPasteMode(true); setDocumentFile(null); }} /> : parsed ? <>
        <div className="alert success">{parsed.rows.length} source rows retained. Review dates, signs, and transaction types before confirming each transaction.</div>
        <form id="mapping-form" onSubmit={event => { event.preventDefault(); if (!ready || !mappingConfirmed) return; const activeMapping = mode === 'amount' ? { ...mapping, debit: undefined, credit: undefined } : { ...mapping, amount: undefined }; const result = normalizeRows(parsed, activeMapping, { fileName, currency }); if (result.issues.length) { setError(result.issues.map(issue => issue.message).join(' ')); return; } onImport(result.transactions.map((transaction, index) => ({ ...transaction, id: crypto.randomUUID(), needsReview: true, sourceText: source ? `${transaction.sourceText}\nDocument reference: ${sourceColumn ? parsed.rows[index].cells[parsed.headers.indexOf(sourceColumn)] || 'Not supplied — compare full extracted source' : 'Not supplied — compare full extracted source'}. Manually transcribed from ${fileName}.` : transaction.sourceText })), source || undefined); }}>
          <div className="form-grid">
            {selectColumn('Date column', 'date', true)}{selectColumn('Description column', 'description', true)}
            <label>Date format<select value={mapping.dateFormat} onChange={event => setMapping({ ...mapping, dateFormat: event.target.value as Mapping['dateFormat'] })}><option value="ISO">YYYY-MM-DD</option><option value="MDY">MM/DD/YYYY</option><option value="DMY">DD/MM/YYYY</option></select></label>
            <label>Amount layout<select value={mode} onChange={event => setMode(event.target.value)}><option value="amount">One signed amount column</option><option value="split">Separate debit and credit columns</option></select></label>
            {mode === 'amount' ? <>{selectColumn('Amount column', 'amount', true)}<label>Amount convention<select value={mapping.signConvention} onChange={event => setMapping({ ...mapping, signConvention: event.target.value as Mapping['signConvention'] })}><option value="negative-expense">Negative = money out</option><option value="positive-expense">Positive = money out</option></select></label></> : <>{selectColumn('Debit column', 'debit', true)}{selectColumn('Credit column', 'credit', true)}</>}
            {selectColumn('Currency column', 'currency')}{selectColumn('Transaction type column', 'type')}
            <label>Currency when no column is mapped<select value={currency} onChange={event => setCurrency(event.target.value as Currency)}>{['CAD', 'USD', 'EUR', 'GBP'].map(value => <option key={value}>{value}</option>)}</select></label>
            {selectColumn('Category column', 'category')}
            {source && <label>Source page/line column<select value={sourceColumn} onChange={event => setSourceColumn(event.target.value)}><option value="">Not mapped — manual source comparison</option>{parsed.headers.map(header => <option key={header}>{header}</option>)}</select></label>}
          </div>
          <label className="check-label" style={{ marginTop: 18 }}><input type="checkbox" checked={mappingConfirmed} onChange={event => setMappingConfirmed(event.target.checked)}/>I verified the date format, amount convention, and column mapping.</label>
        </form>
        <p className="help-text" style={{ marginTop: 18 }}>First 4 rows · source values are preserved, including malformed rows.</p>
        <div className="mapping-preview"><table><thead><tr>{parsed.headers.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{parsed.rows.slice(0, 4).map(row => <tr key={row.row}>{row.cells.map((cell, index) => <td key={index}>{cell || '—'}</td>)}</tr>)}</tbody></table></div>
      </> : pasteMode ? <>
        {source && <><h3>Extracted source · unverified</h3><pre className="source-context">{source}</pre><p className="alert">This version extracts text but does not infer bank layouts. Transcribe every transaction into CSV below, keeping dates and signs exactly as shown. Compare the row count and source totals before review. No extracted lines are silently converted.</p></>}
        <label className="form-label">CSV with a header row<textarea rows={8} spellCheck={false} value={text} placeholder={'Date,Description,Amount\n2026-10-24,Synthetic market,-86.42'} onChange={event => setText(event.target.value)} /></label>
        <p className="help-text" style={{ marginTop: 8 }}>Only use statement data on a trusted device. Your work clears when this page closes or reloads.</p>
      </> : <>
        <div className="dropzone" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void chooseFile(event.dataTransfer.files[0]); }}><UploadCloud size={34} color="#64866a"/><h3>Bring your statement into focus</h3><p className="muted">Drop a file here, or choose one from your device.</p><button className="button" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? 'Reading file…' : 'Choose a file'}</button><span className="help-text">CSV, PDF, or photo · up to 20 MB</span></div>
        <div className="format-row"><button className="secondary" onClick={() => { resetInput('Pasted data'); setPasteMode(true); }}><FileSpreadsheet/>Paste CSV</button><button className="secondary" onClick={() => cameraRef.current?.click()}><Camera/>Take a photo</button><a className="secondary" href="/synthetic-statement.csv" download><FileText/>Sample CSV</a></div>
        <p className="help-text">Photos and scanned PDFs use English OCR on your device. Recognition can be wrong; extracted text always needs manual comparison and correction. Camera access opens only when you choose it on a supported mobile device.</p>
      </>}
      <input className="visually-hidden" ref={fileRef} type="file" aria-label="Statement file" accept=".csv,.pdf,image/png,image/jpeg,image/webp" onChange={event => void chooseFile(event.target.files?.[0])}/>
      <input className="visually-hidden" ref={cameraRef} type="file" aria-label="Statement camera" accept="image/*" capture="environment" onChange={event => void chooseFile(event.target.files?.[0])}/>
    </div>
    {!documentFile && <div className="modal-footer"><button className="secondary" type="button" onClick={() => { if (parsed) { setParsed(null); setError(''); } else if (pasteMode) setPasteMode(false); else onClose(); }}>{parsed || pasteMode ? 'Back' : 'Cancel'}</button>{parsed ? <button key="confirm-mapping" className="button" type="submit" form="mapping-form" disabled={!ready || !mappingConfirmed}>Add {parsed.rows.length} rows to review</button> : pasteMode ? <button key="preview-csv" className="button" type="button" onClick={event => { event.preventDefault(); prepareCsv(text); }}>Preview columns</button> : <span className="help-text">Private by design. Reviewed by you.</span>}</div>}
  </Modal>;
}
