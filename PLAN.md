# Statement Expense Organizer

Status: Local application implemented. Unit/component checks and interactive
QA are underway; remote CI and deployment are not yet verified.

## User Outcome
Turn a transaction CSV, PDF statement, or photo into a reviewable transaction
table, categorized monthly summary, and clean spreadsheet export.
The application is an import/review/export tool, not a bank integration,
payment service, financial advisor, or LLM chatbot.

## Delivery Stages
1. Create a polished responsive app shell with synthetic sample data.
2. Build CSV import, preview, explicit column mapping, normalization, and review.
3. Add search, sorting, categories, edits, duplicate flags, totals, and exports.
4. Add a public configuration API and a small allowlisted schema-driven form.
5. Add PDF text extraction and photo/scanned-PDF OCR with correction UI.
6. Support mobile file selection and optional camera capture with user consent.
7. Add tests, CI, privacy checks, documentation, and real deployment verification.
8. Update BuildLens, personal portfolio, and resume in separate follow-up work.

All stages are requested scope. Deliver working stages in sequence and clearly
report remaining work rather than presenting a shell as the finished product.
Tonight is the target, not a promise of flawless arbitrary-bank OCR.

## File Input Flow
CSV -> CSV parser -> column mapping -> typed transaction candidates
Text PDF -> PDF.js -> positioned text -> layout mapping -> transaction candidates
Photo / scanned PDF -> image preview -> rotate/crop if needed -> OCR worker ->
positioned text -> layout mapping -> transaction candidates
All paths -> editable review -> validated transactions -> summaries -> CSV/XLSX

OCR is inherently fallible. Preserve row provenance and display source context.
Review ambiguous dates, amounts, sign conventions, and transaction boundaries.
Support a documented initial set of layouts and graceful manual correction.

## Completion Evidence
- A user can complete import -> mapping -> review/edit -> export.
- CSV and image/PDF workflows are tested with synthetic fixtures.
- Reviewable failures never silently corrupt totals or discard transactions.
- Desktop and mobile browser screenshots verified; no broken or decorative controls.
- No transaction payload leaves the browser; verify network behavior, not just comments.
- Tests and production build pass; deployed URL is manually exercised.
- Demo uses synthetic data and offers an explicit clear/reset action.
- No personal data, secrets, or private learning notes in Git/deployment.
- Public README explains limits, setup, architecture, and honest AI assistance.

## Hosting
Prefer a personal-use free hosting tier if compatible. No paid AI calls required.
Require the user's approval before paid services, account terms, or publishing
private/account-linked information. Keep OCR workers/assets configured safely.

## Implementation Status — October 27, 2026

- Implemented: responsive Folio workspace and synthetic fixtures; CSV preview,
  explicit mapping/date/sign confirmation, retained invalid rows, provenance;
  search/category/period filters, sorting, row editing and review; currency-specific
  confirmed totals; safe CSV/XLSX downloads; public allowlisted configuration API.
- Implemented: local positioned PDF extraction and English OCR for photos/scanned
  pages, progress/cancel/retry, photo rotation/crop, editable extracted text review,
  mobile file/capture inputs. Document transaction transcription is manual into
  CSV; automatic bank-layout recognition remains future work, explicitly disclosed.
- Implemented: unit/component tests, desktop/mobile Playwright specs, GitHub
  Actions workflow, deployment exclusions, and setup/limitations documentation.
- Interactive QA so far: mobile-width preview renders; malformed CSV rows and
  duplicates retained; confirmation changes totals; real synthetic photo OCR
  correctly extracted both transaction dates, signs, and amounts.
- Local automated E2E execution: blocked before browser launch by macOS sandbox
  Mach-port permission denial. Do not mark it passed. Dedicated local-tab desktop
  and mobile screenshots were captured safely; a full Brave-window capture was
  excluded because it included unrelated private content.
- Remote source: published at https://github.com/saurabh-s-baghel/statement-expense-organizer .
  Initial commit `8f7dc66` is public; the first real GitHub Actions run is underway.
  Vercel Hobby account creation/sign-in remains a user step. No purchases made.
- Latest local checks: privacy path check, lint, TypeScript, all 202 unit/component tests, and the
  patched PDF.js 6.4.299 production build pass. All 16 desktop/mobile E2E cases
  collect; execution remains blocked before browser launch.
- Production browser checks: scanned-PDF OCR accurately recognized both synthetic
  transaction lines; cancel returned to a retryable state. Text-PDF and photo
  OCR also worked in the earlier interactive development preview. Mobile
  screenshots captured safely in dedicated desktop and mobile app tabs.
- Dependency audit: no high/critical production advisories. Two moderate entries
  concern ExcelJS's transitive uuid dependency (v3/v5/v6 buffer API advisory);
  ExcelJS source uses uuid v4 without buffers. Do not claim zero advisories.
- User selected Vercel Hobby as candidate hosting. Personal account/public-demo
  publication is approved; account creation/sign-in is pending.
- Final review fixes cover attached currency-code conflicts, currency-free
  editor amounts, duplicate acknowledgment surviving unrelated imports, and
  clearing document provenance when choosing a different file or paste.
- Interactive CSV/XLSX downloads from the production browser were read back:
  both contain the correct two signed amounts and line references, and neither
  repeats the full document extraction in each row.
- Browser tests scope pre-import assertions to the active dialog, since the
  unchanged synthetic demo remains behind it until the import is confirmed.
- Initial remote tests exposed a mobile hidden-label overflow (594px content in
  a 390px viewport), long-dialog pointer interception, and a desktop dev-server
  reload during a click. Hidden labels are anchored, modal bodies scroll within
  stable headers/footers, and mobile mapping forms use one column. Interactive
  verification now reports 319px content in a 319px viewport and clickable mapping
  confirmation. CI browser tests now use the production build; rerun pending.
- Vercel build fix: production type checking now excludes test files and runner
  configs. A separate `tsconfig.test.json` explicitly loads DOM matcher types;
  `npm run typecheck` checks both programs. Verified all 202 tests, lint, both
  type checks, normal production build, and a separate deployment-shaped build
  with `tests/setup.ts` removed by `.vercelignore`. Actual Vercel rerun pending.
