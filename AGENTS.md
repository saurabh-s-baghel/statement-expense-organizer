# Project Instructions

## Purpose
Build a working, deployed, accessible statement-to-expense organizer as a
frontend engineering portfolio project. Use synthetic inputs for all public
examples. The goal is inspectable code and explainable behavior, not inflated
resume claims or a decorative dashboard with nonfunctional controls.

## Architecture
- React and TypeScript, using Next.js for the app and a small configuration API.
- Tailwind CSS and Lucide icons; restrained, dense, business-tool styling.
- Use Papa Parse for CSV, PDF.js for PDFs, and Tesseract.js for image OCR.
- File content stays in the browser: do not send files, extracted text,
  transactions, filenames, or account details to APIs, logs, analytics, or AI.
- The API serves only public category and allowlisted form configuration data.
- Do not claim shared backend persistence when edits are browser-local.
- Use reusable, typed components; no giant component or general-purpose UI engine.

## Privacy And Learning Notes
- Maintain private/flow.md and private/explain.md as features are implemented.
- These are local-only learning notes. Keep private/ excluded from Git and deployment.
- Do not put personal statements or real exports anywhere outside private/.
- Never force-add ignored files, commit secrets, or upload private notes.
- Before publishing, inspect tracked files and deployment inputs for private data.
- Explain each completed feature: its purpose, important files, state flow,
  one test, and one small exercise for the user. Label plans vs. implemented code.

## Financial Data Correctness
- Track debit, credit, income, refund, and transfer separately. No financial advice.
- Use integer minor units for money; preserve currency, source text, and row provenance.
- Flag ambiguous date formats, possible duplicates, and uncertain OCR for review.
- Never silently drop malformed rows or automatically delete suspected duplicates.
- Protect spreadsheet exports from formula injection while retaining numeric amounts.
- Unknown statement layouts must fall back to explicit mapping/manual correction.
- Never advertise universal bank support or perfect OCR accuracy.

## Required Quality
- Keyboard-accessible forms, proper labels, visible focus, mobile layouts.
- Loading, error, cancellation/retry, empty, validation, and success states.
- Unit tests for parsing/normalization/categorization/export and component tests
  for mapping/filtering/editing; Playwright desktop/mobile end-to-end tests.
- Test negative amounts, refunds, transfers, duplicates, malformed dates,
  quoted CSV fields, formula-like text, and OCR ambiguity with synthetic fixtures.
- Run lint, type checking, tests, and production build; report failures honestly.
- Use GitHub Actions for checks. Do not mark CI as passing until its real run passes.
- Do not publish, push, purchase services, or accept account terms without user authorization.
- Do not add features to a resume until implemented and verified.


<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
