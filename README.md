# Statement Expense Organizer

A frontend engineering project for turning statement files into reviewed,
categorized transactions and spreadsheet exports.

The local application is implemented as **Folio**. It includes a responsive
workspace, explicit CSV mapping, per-row review and corrections, separate
expense/income/refund/transfer handling, currency-specific totals, filtered
CSV/XLSX downloads, and a public category/form configuration API.

PDF text extraction and English photo/scanned-PDF OCR run locally. This initial
version uses **manual transcription from reviewed extracted text into CSV**;
it does not automatically identify arbitrary bank layouts or transaction boundaries.
Do not rely on extraction to find every row. Compare source row counts and totals.

## Run locally

Requires Node.js 22.13+ or a compatible newer LTS release and npm.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000. The development server binds to loopback only.
The webpack watcher uses polling for compatibility with restricted local environments.
The production server runs with `npm run build` followed by `npm start`.

Installation copies OCR workers, WASM cores, English language data, and the PDF
worker from installed packages to ignored `public/vendor/`. Keep these files
in the deployed build; `npm ci` recreates them. Recognition does not need a CDN.

## Try the complete flow

1. Explore the explicitly synthetic demo; download the sample CSV.
2. Import it, verify the detected columns, select date and sign conventions,
   and check the mapping confirmation.
3. Open each row, compare original values, select a category and transaction
   type, and check source confirmation. Malformed rows and duplicates remain visible.
4. Filter/search/sort, then export confirmed visible rows or all visible rows
   including issues. The review tab also filters exported rows.
5. Export before closing/reloading, or explicitly clear the workspace.

For PDFs/photos, choose a file, rotate/crop photos if needed, extract, and review
the editable page/line-labelled source. Transcribe each source transaction into
CSV with a `Source line` column, then map that reference column. The full extraction
is retained once in the working session for source comparison. Exports contain
the transcribed CSV row and supplied reference, not a repeated full document.

## Initial supported formats and limits

- CSV: unique nonempty headers; up to 10,000 rows and 20 MB. Quoted fields and
  separate debit/credit columns are supported. Dates: `YYYY-MM-DD`, `MM/DD/YYYY`,
  or `DD/MM/YYYY`, selected explicitly. Years must have four digits.
- Amounts: decimal point, up to two fractional digits, optional conventional
  thousands commas, signs, and negative parentheses. Unsupported locale formats
  remain review issues. Select whether positive or negative means money out.
- CAD, USD, EUR, GBP only, with no conversion. Embedded currency conflicts and
  unsupported currencies require explicit source verification/correction.
- PDF: up to 10 pages/20 MB; positioned text is grouped into lines. Scanned pages
  use English OCR; force OCR for incomplete/garbled text layers. Password-protected
  PDFs need an unlocked local copy. PDF rotation/crop is not implemented.
- Images: PNG, JPEG, WebP, BMP supported by the extraction layer; mobile capture
  depends on the device file picker. Convert HEIC to JPEG first. Maximum 16 million pixels.
- OCR may misread signs, decimals, dates, columns, or entire lines. It always
  requires human review and manual transaction transcription in this version.

## Correctness and privacy

- Money is represented in integer cents. Summaries accumulate with `BigInt` and
  show an unavailable state if totals exceed the safe display range. CSV uses
  exact decimal serialization. XLSX uses numeric cells and refuses values above
  its documented precision limit; use CSV for extreme amounts.
- Only confirmed, valid rows contribute to summaries. Income, gross spending,
  refunds, and transfers are separate. Net cash flow excludes transfers.
  Period/currency select the summary; search/category/review filters select
  table and export rows. Currencies are never added together.
- Possible duplicates are flagged and retained. Confirmation acknowledges a
  source comparison; it never deletes a row.
- Spreadsheet-like text is escaped in CSV/XLSX. Exports contain source text and
  filenames and should be treated as private financial documents.
- Files, names, extracted text, transactions, and edits remain in browser memory.
  No analytics, bank credentials, AI calls, upload endpoint, or remote persistence.
  No statement data is stored in localStorage or IndexedDB by this application;
  OCR language caching is disabled. Work is lost on reload/close.
- `GET /api/config` returns only categories and an allowlisted select/text form
  schema. The client validates it and falls back to built-in settings on failure.
  The server cannot send arbitrary executable UI, HTML, or transaction data.
- CSP restricts connections/assets to this origin (with local blob/data previews).
  Development permits eval for the framework/OCR runtime; do not interpret this
  as a hardened multi-tenant service security claim.
- `private/` is excluded by `.gitignore` and `.vercelignore`. Real inputs belong
  only there, never in public fixtures. Public examples and test media are synthetic.

## Verification

```sh
npm run lint
npm run privacy
npm run typecheck
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

Unit/component tests cover mapping, invalid/ambiguous values, currency conflicts,
duplicates, source review, totals, safe exports, and configuration allowlisting.
Production TypeScript checking excludes test files and test runner configuration.
`npm run typecheck` checks application code and then tests separately using
`tsconfig.test.json`, which explicitly loads the DOM matcher types. This keeps
production builds independent of test setup files excluded by `.vercelignore`.
Playwright specs cover desktop/mobile CSV workflows plus real PDF/photo/scanned
PDF extraction, cancellation, and same-origin GET-only network expectations.
Synthetic document fixtures are under `tests/fixtures/`.

The initial local automated browser run was blocked before tests could execute
by a macOS sandbox browser-launch permission error. Interactive browser QA is
recorded separately in `PLAN.md`; test code existing is not a passing E2E run.
GitHub Actions runs the same checks on pushes and pull requests. See the
[actual run results](https://github.com/saurabh-s-baghel/statement-expense-organizer/actions)
for remote status. No Vercel deployment is published yet.

## Deployment handoff

Use a Next.js-compatible Node host (for example Vercel), with `npm ci` installing
local recognition assets and `npm run build` producing the app. No secrets or
database are required. Confirm hosting account, source repository, audience,
and synthetic-only content before publishing. Recheck `git ls-files` and the
deployment manifest for private files, then exercise import/review/export and
OCR on the actual deployed URL. CI and deployed workflows remain unverified
until those real runs succeed.

## Implementation and learning

React/TypeScript, Next.js App Router, Tailwind CSS, Lucide, Papa Parse, PDF.js,
Tesseract.js, ExcelJS, Vitest/Testing Library, Playwright, and GitHub Actions.
`Workspace` owns transaction state; mapping and editor components have temporary
form state. Totals and filters are derived, never a second competing ledger.
The small configuration API demonstrates server-driven choices with strict
runtime validation rather than a general UI execution engine.

Developed with Codex assistance and reviewed through tests and interactive QA.
Libraries provide CSV parsing, PDF interpretation, OCR, and workbook encoding;
this project integrates them and implements review, normalization, and UI behavior.
No claims of model training, universal bank support, production users, or successful
remote CI/deployment. Local-only exercises and flow notes live in ignored `private/`.

See PLAN.md for stage status and remaining verification.
