'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, BookOpen, CheckCheck, CircleHelp, Download, FileText, FolderOpen, LayoutDashboard, ReceiptText, LockKeyhole, Plus, RotateCcw, ShieldCheck, Upload, Wallet, X } from 'lucide-react';
import { DEFAULT_CONFIG, parseConfig } from '@/lib/config';
import { createDemo } from '@/lib/demo';
import { exportCsv, exportXlsx, reconcileDuplicates, transactionFingerprint, type Currency, type Transaction } from '@/lib/ledger';
import { money, summarize } from '@/lib/summary';
import { ImportWizard } from './import-wizard';
import { Modal } from './modal';
import { TransactionEditor } from './transaction-editor';
import { TransactionTable, type SortKey } from './transaction-table';

const colors = ['#47775a', '#91b483', '#c2cc8f', '#d7ad73', '#9faca3', '#bbcbbe'];

function saveFile(content: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Workspace() {
  const [transactions, setTransactions] = useState<Transaction[]>(createDemo);
  const [isDemo, setIsDemo] = useState(true);
  const [sourceDocuments, setSourceDocuments] = useState<{ rowIds: string[]; text: string }[]>([]);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [configStatus, setConfigStatus] = useState('loading');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [tab, setTab] = useState('all');
  const [currency, setCurrency] = useState<Currency>('CAD');
  const [month, setMonth] = useState('all');
  const [sort, setSortState] = useState<{ key: SortKey; direction: number }>({ key: 'date', direction: -1 });
  const [modal, setModal] = useState<'import' | 'export' | 'clear' | 'help' | 'demo' | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [notice, setNotice] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportScope, setExportScope] = useState('confirmed');
  const [exportError, setExportError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/config', { signal: controller.signal }).then(response => { if (!response.ok) throw new Error('Configuration unavailable'); return response.json(); }).then(value => { setConfig(parseConfig(value)); setConfigStatus('ready'); }).catch(() => { if (!controller.signal.aborted) setConfigStatus('fallback'); });
    return () => controller.abort();
  }, []);

  const months = [...new Set(transactions.flatMap(transaction => transaction.date ? [transaction.date.slice(0, 7)] : []))].sort().reverse();
  const periodTransactions = useMemo(() => transactions.filter(transaction => month === 'all' || transaction.date?.startsWith(month)), [transactions, month]);
  const reviewCount = periodTransactions.filter(transaction => transaction.needsReview).length;
  const summary = summarize(periodTransactions, currency);
  const visible = useMemo(() => periodTransactions.filter(transaction =>
    (tab === 'all' || (tab === 'review' ? transaction.needsReview : !transaction.needsReview)) &&
    (category === 'all' || (transaction.category ?? 'Uncategorized') === category) &&
    `${transaction.description} ${transaction.category ?? ''} ${transaction.note ?? ''}`.toLowerCase().includes(search.toLowerCase())
  ).sort((first, second) => {
    const firstValue = sort.key === 'amount' ? first.amountCents ?? Number.MIN_SAFE_INTEGER : sort.key === 'date' ? first.date ?? '' : first.description.toLowerCase();
    const secondValue = sort.key === 'amount' ? second.amountCents ?? Number.MIN_SAFE_INTEGER : sort.key === 'date' ? second.date ?? '' : second.description.toLowerCase();
    return (firstValue < secondValue ? -1 : firstValue > secondValue ? 1 : 0) * sort.direction;
  }), [periodTransactions, tab, category, search, sort]);
  const legend = summary.categories.length > 5 ? [...summary.categories.slice(0, 4), ['Other categories', summary.categories.slice(4).reduce((sum, entry) => sum + entry[1], 0)] as [string, number]] : summary.categories;
  const gradient = legend.map((entry, index) => { const start = summary.spending ? legend.slice(0, index).reduce((sum, value) => sum + value[1], 0) / summary.spending * 360 : 0; const end = start + (summary.spending ? entry[1] / summary.spending * 360 : 0); return `${colors[index % colors.length]} ${start}deg ${end}deg`; }).join(',');

  function resetFilters() { setSearch(''); setCategory('all'); setTab('all'); setMonth('all'); }
  function importTransactions(incoming: Transaction[], documentSource?: string) {
    setTransactions(previous => reconcileDuplicates([...(isDemo ? [] : previous), ...incoming]));
    if (documentSource) setSourceDocuments(previous => [...(isDemo ? [] : previous), { rowIds: incoming.map(transaction => transaction.id), text: documentSource }]);
    setIsDemo(false);
    resetFilters();
    setTab('review');
    setModal(null);
    setNotice(`${incoming.length} rows added to review. Confirm each row against its source before it enters totals.`);
  }
  function updateTransaction(updated: Transaction) {
    setTransactions(previous => {
      const acknowledged = { ...updated, duplicateAcknowledgedFingerprint: !updated.needsReview && updated.duplicateOf ? transactionFingerprint(updated) : undefined };
      return reconcileDuplicates(previous.map(transaction => transaction.id === updated.id ? acknowledged : transaction));
    });
    setEditing(null);
    setNotice(updated.needsReview ? 'Changes saved. This row still needs your confirmation.' : 'Transaction confirmed. Totals have been updated.');
  }

  async function download(format: 'csv' | 'xlsx') {
    const rows = exportScope === 'confirmed' ? visible.filter(transaction => !transaction.needsReview) : visible;
    setExportBusy(true);
    setExportError('');
    try {
      if (format === 'csv') saveFile(exportCsv(rows), 'text/csv;charset=utf-8', 'tallytrail-transactions.csv');
      else { const bytes = await exportXlsx(rows); saveFile(bytes as BlobPart, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'tallytrail-transactions.xlsx'); }
      setNotice(`Exported ${rows.length} ${exportScope === 'confirmed' ? 'confirmed' : 'visible'} rows as ${format.toUpperCase()}.`);
      setModal(null);
    } catch (error) { setExportError(error instanceof Error ? error.message : 'Export could not finish. Your data is still here; try CSV or retry.'); } finally { setExportBusy(false); }
  }

  return <div className="app-shell">
    <a className="visually-hidden focus:not-sr-only" href="#main-content">Skip to workspace</a>
    <aside className="sidebar" aria-label="Workspace navigation"><div><div className="brand"><span className="brand-symbol"><ReceiptText size={22}/></span>TallyTrail<span style={{ color: '#a7c78f' }}>.</span></div><div className="brand-sub">A little more clarity</div></div><nav><div className="nav-label">WORKSPACE</div><button className={`nav-item ${tab !== 'review' ? 'active' : ''}`} onClick={resetFilters}><LayoutDashboard size={17}/>Overview</button><button className={`nav-item ${tab === 'review' ? 'active' : ''}`} onClick={() => { setTab('review'); setCategory('all'); setSearch(''); }}><CheckCheck size={17}/>Review queue<span className="nav-count">{transactions.filter(transaction => transaction.needsReview).length}</span></button><button className="nav-item" onClick={() => setModal('import')}><FolderOpen size={17}/>Import statement</button><div className="nav-label" style={{ marginTop: 30 }}>RESOURCES</div><button className="nav-item" onClick={() => setModal('help')}><BookOpen size={17}/>How it works</button><button className="nav-item" onClick={() => setModal(isDemo ? 'help' : 'demo')}><RotateCcw size={17}/>Explore demo</button></nav><div className="sidebar-note"><ShieldCheck size={22}/><h3>Your data, your device.</h3><p>Statements are processed locally. You decide what to export.</p></div><div className="sidebar-footer"><span className="avatar">T</span><div>Personal workspace<div style={{ color: '#8caea6', fontSize: 10 }}>No account needed</div></div></div></aside>
    <main className="main" id="main-content"><header className="topbar"><div className="breadcrumb"><span>Workspace</span><span>/</span><strong style={{ color: '#3e5248', fontWeight: 500 }}>Overview</strong></div><div className="mobile-brand"><ReceiptText size={22}/>TallyTrail.</div><div className="actions"><span className="privacy-pill"><LockKeyhole size={12}/>Private on your device</span><button className="ghost" aria-label="Help and privacy" onClick={() => setModal('help')}><CircleHelp size={17}/></button></div></header>
      <div className="content"><div className="page-heading"><div><div className="eyebrow">YOUR FINANCIAL WORKSPACE</div><h1>A clearer picture.</h1><p className="subtitle">From statement to organized expenses, one review at a time.</p></div><div className="actions"><button className="secondary" onClick={() => { setExportError(''); setModal('export'); }} disabled={!visible.length}><Download/>Export</button><button className="button" onClick={() => setModal('import')}><Plus/>Import statement</button></div></div>
        {isDemo ? <div className="demo-banner"><ReceiptText size={17}/><span><strong>You’re exploring a synthetic demo.</strong> All names and transactions are fictional. Import a statement to start your own workspace.</span><a href="/synthetic-statement.csv" download>Get sample CSV ↗</a></div> : <div className="demo-banner"><ShieldCheck size={17}/><span><strong>Local workspace.</strong> Export before closing or reloading; transactions are held in memory only.</span><button className="ghost" onClick={() => setModal('clear')}>Clear all</button></div>}
        {notice && <div role="status" className="alert success" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>{notice}<button className="ghost" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={14}/></button></div>}
        {configStatus === 'fallback' && <p role="status" className="alert">Public configuration could not load. The built-in category form is available; reload to retry.</p>}
        <div className="actions" style={{ marginBottom: 15, justifyContent: 'space-between' }}><div className="actions"><label className="help-text" htmlFor="month-filter">Period</label><select id="month-filter" value={month} onChange={event => setMonth(event.target.value)}><option value="all">All dates</option>{months.map(value => <option key={value} value={value}>{new Date(`${value}-15T12:00:00`).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })}</option>)}</select></div><div className="actions"><label className="help-text" htmlFor="currency-summary">Summary currency</label><select id="currency-summary" value={currency} onChange={event => setCurrency(event.target.value as Currency)}>{['CAD', 'USD', 'EUR', 'GBP'].map(value => <option key={value}>{value}</option>)}</select></div></div>
        <section className="stats" aria-label="Confirmed transaction totals">{[
          { label: 'Total spending', value: summary.overflow ? 'Out of range' : money(summary.spending, currency), detail: `Gross expenses · ${currency}`, icon: <ArrowUpRight size={17}/> },
          { label: 'Income', value: summary.overflow ? 'Out of range' : money(summary.income, currency), detail: 'Confirmed money coming in', icon: <ArrowDownLeft size={17}/> },
          { label: 'Net cash flow', value: summary.overflow ? 'Out of range' : money(summary.net, currency), detail: 'Income + refunds − spending', icon: <Wallet size={17}/> },
          { label: 'Needs your review', value: String(reviewCount).padStart(2, '0'), detail: reviewCount ? 'Excluded from confirmed totals' : 'Everything is looking organized', icon: <CheckCheck size={17}/> }
        ].map((stat, index) => <article key={stat.label} className={`stat ${index === 3 ? 'emphasis' : ''}`}><div className="stat-top"><span>{stat.label}</span><span className="stat-icon">{stat.icon}</span></div><div className="stat-value">{stat.value}</div><div className="stat-bottom">{stat.detail}</div></article>)}</section>
        {summary.overflow ? <p className="alert" role="alert">Combined amounts exceed the supported summary range. Filter to a smaller period or export exact amounts as CSV. Totals and breakdown are unavailable.</p> : <p className="help-text" style={{ marginTop: -13, marginBottom: 19 }}>Totals use {summary.confirmed} confirmed {currency} rows in this period. Refunds: {money(summary.refunds, currency)}. Transfers: {money(summary.transfers, currency)} (excluded). Search and category filters affect the table and exports only.</p>}
        <div className="dashboard-grid"><TransactionTable transactions={visible} totalCount={periodTransactions.length} reviewCount={reviewCount} search={search} setSearch={setSearch} tab={tab} setTab={setTab} category={category} setCategory={setCategory} categories={[...new Set([...config.categories, ...transactions.flatMap(transaction => transaction.category ? [transaction.category] : [])])]} sort={sort} setSort={key => setSortState(previous => ({ key, direction: previous.key === key ? -previous.direction : key === 'description' ? 1 : -1 }))} onEdit={setEditing} onImport={() => setModal('import')}/>
          <aside className="insights" aria-label="Spending insights"><section className="panel category-panel"><div className="panel-heading"><div><h2>Spending breakdown</h2><p>Confirmed expenses · {currency}</p></div></div><div className="insight-body"><div className="donut" role="img" aria-label={`Spending total ${money(summary.spending, currency)}. Breakdown listed below.`} style={{ background: gradient ? `conic-gradient(${gradient})` : '#edf1eb' }}><div className="donut-inner"><strong>{money(summary.spending, currency)}</strong><span>Total spending</span></div></div><div>{legend.length ? legend.map(([name, amount], index) => <div className="legend-row" key={name}><span className="dot" style={{ background: colors[index % colors.length] }}/><span>{name}</span><strong>{money(amount, currency)}</strong></div>) : <p className="help-text">Confirm expense rows to see your breakdown.</p>}</div></div></section><section className="panel upload-panel"><div className="panel-heading"><h2>A place for every statement</h2></div><div className="insight-body"><div className="upload-card"><span className="upload-icon"><Upload size={20}/></span><h3>Less sorting. More clarity.</h3><p>CSV, PDF, or photo.<br/>Bring the details together.</p><button className="secondary" onClick={() => setModal('import')}>Import a statement<Plus size={12}/></button></div></div></section><section className="panel workflow-panel"><div className="panel-heading"><h3>YOUR NEXT THREE STEPS</h3></div><div className="insight-body"><ol className="workflow-list">{['Import and map your statement', 'Review the details, confirm each row', 'Export a clean spreadsheet'].map((step, index) => <li key={step}><span className="workflow-step">{index + 1}</span>{step}</li>)}</ol></div></section></aside></div>
        <footer className="bottom-note"><span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><LockKeyhole size={10}/>Your statement never leaves this device.</span><button className="ghost" style={{ fontSize: 10 }} onClick={() => setModal('clear')}><RotateCcw size={11}/>Clear workspace</button></footer>
      </div>
    </main>
    {modal === 'import' && <ImportWizard onClose={() => setModal(null)} onImport={importTransactions}/>}
    {editing && <TransactionEditor key={editing.id} transaction={editing} config={config} documentSource={sourceDocuments.find(document => document.rowIds.includes(editing.id))?.text} onClose={() => setEditing(null)} onSave={updateTransaction}/>}
    {modal === 'export' && <Modal title="Export your workspace" subtitle="Exports follow the current table filters, including period and review tab." onClose={() => !exportBusy && setModal(null)}><div className="modal-body"><label className="form-label">Rows to export<select value={exportScope} onChange={event => setExportScope(event.target.value)}><option value="confirmed">Confirmed visible rows ({visible.filter(transaction => !transaction.needsReview).length})</option><option value="all">All visible rows ({visible.length}), including review issues</option></select></label><p className="help-text" style={{ marginTop: 12 }}>Includes signed numeric amounts, currency, type, review status, issues, notes, and source provenance. Spreadsheet-like text is escaped to prevent formula execution. Source content is included; keep the downloaded file private.</p>{exportError && <p role="alert" className="alert">{exportError}</p>}<div className="format-row"><button className="button" disabled={exportBusy || (exportScope === 'confirmed' && !visible.some(transaction => !transaction.needsReview))} onClick={() => void download('csv')}><FileText/>{exportBusy ? 'Preparing…' : 'Download CSV'}</button><button className="secondary" disabled={exportBusy || (exportScope === 'confirmed' && !visible.some(transaction => !transaction.needsReview))} onClick={() => void download('xlsx')}><Download/>Download XLSX</button></div></div></Modal>}
    {(modal === 'clear' || modal === 'demo') && <Modal title={modal === 'clear' ? 'Clear this workspace?' : 'Replace with synthetic demo?'} subtitle="Export first if you want to keep your work. This cannot be undone." onClose={() => setModal(null)}><div className="modal-body"><p className="muted">{transactions.length} working rows will be removed from this tab. Your original files are unaffected.</p></div><div className="modal-footer"><button className="secondary" onClick={() => setModal(null)}>Keep working</button><button className={modal === 'clear' ? 'danger' : 'button'} onClick={() => { setTransactions(modal === 'demo' ? createDemo() : []); setSourceDocuments([]); setIsDemo(modal === 'demo'); resetFilters(); setModal(null); setNotice('Workspace reset.'); }}>{modal === 'clear' ? 'Clear all data' : 'Load synthetic demo'}</button></div></Modal>}
    {modal === 'help' && <Modal title="A little more clarity" subtitle="An import, review, and export workspace." onClose={() => setModal(null)}><div className="modal-body help-content"><h3>1. Import and map</h3><p>CSV files use a header row, decimal amounts, and an explicitly selected date and sign format. Separate debit and credit columns are supported. ISO dates avoid day/month ambiguity.</p><h3>2. Review with the source</h3><p>Every imported row needs confirmation. Invalid rows and possible duplicates stay visible. Correct fields, choose a category and type, then confirm against the original. Refunds and transfers are distinct from income and spending.</p><h3>3. Export before you leave</h3><p>Only confirmed rows enter summary totals, grouped by currency without conversion. Exports follow table filters. CSV and XLSX can include review issues and provenance. Work is held in memory and is lost on reload.</p><h3>PDFs and photos</h3><p>PDF.js reads positioned PDF text. Tesseract.js recognizes English photos and scanned PDF pages locally. This initial version requires manual transcription into CSV from the extracted source; it does not infer arbitrary bank layouts. Compare every source transaction and total. Rotate or crop photos if needed. Limits: 20 MB, 10 PDF pages, 10,000 CSV rows.</p><h3>Privacy and configuration</h3><p>Files, text, names, and transactions stay in this browser. Recognition assets load from this app, with no third-party OCR service. The public <a href="/api/config" target="_blank" rel="noreferrer">configuration API</a> serves category options and a small allowlisted form schema only. {configStatus === 'ready' ? 'The API configuration is loaded.' : configStatus === 'loading' ? 'The configuration is loading.' : 'The built-in configuration is active.'}</p><p className="help-text">Built with reviewed AI assistance. Synthetic demo only; no bank connection or shared storage.</p>{!isDemo && <button className="secondary" onClick={() => setModal('demo')}>Explore the synthetic demo</button>}</div></Modal>}
  </div>;
}
