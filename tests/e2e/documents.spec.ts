import { expect, test, type Page } from '@playwright/test';
import { syntheticImageFixtures, syntheticLines, syntheticTextPdf } from '../fixtures/documents';

let photo: Buffer;
let scanned: Buffer;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  try {
    ({ photo, scanned } = await syntheticImageFixtures(page));
  } finally {
    await page.close();
  }
});

test.beforeEach(async ({ context, page }, testInfo) => {
  test.setTimeout(180_000);
  const violations: string[] = [];
  const assets: string[] = [];
  const origin = new URL(String(testInfo.project.use.baseURL)).origin;
  context.on('request', request => {
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return;
    if (url.origin !== origin || request.method() !== 'GET') {
      violations.push(`${request.method()} ${url.origin}${url.pathname}`);
    }
  });
  context.on('response', response => {
    if (response.ok()) assets.push(new URL(response.url()).pathname);
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Import statement', exact: true }).first().click();
  testInfo.annotations.push({ type: 'privacy', description: 'Real vendor assets; browser and worker traffic must remain local and GET-only.' });
  privacyViolations.set(page, violations);
  loadedAssets.set(page, assets);
});

const privacyViolations = new WeakMap<Page, string[]>();
const loadedAssets = new WeakMap<Page, string[]>();

test.afterEach(async ({ page }) => {
  expect(privacyViolations.get(page) ?? []).toEqual([]);
});

async function choose(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.getByLabel('Statement file', { exact: true }).setInputFiles({ name, mimeType, buffer });
  await expect(page.getByRole('heading', { name: 'Review document text' })).toBeVisible();
  await page.getByRole('button', { name: 'Extract text', exact: true }).click();
}

async function reviewAndMap(page: Page, method: 'PDF text' | 'OCR — verify') {
  const text = page.getByLabel('Extracted text — editable, with page and line references', { exact: true });
  await expect(text).toBeVisible({ timeout: 120_000 });
  await expect(text).toHaveValue(new RegExp(`\\[Page 1 \\| ${method}\\]`));
  await expect(text).toHaveValue(/\[P1:L1\]/);
  for (const fragment of ['SYNTHETIC STATEMENT', '2026-10-24', 'Synthetic Market', '-86.42', '2026-10-25', 'Synthetic Refund', '12.50']) {
    await expect(text).toHaveValue(new RegExp(fragment.replace('.', '\\.')));
  }
  if (method === 'PDF text') {
    expect(await text.inputValue()).toBe(`[Page 1 | PDF text]\n${syntheticLines.map((line, index) => `[P1:L${index + 1}] ${line}`).join('\n')}`);
  }
  const extracted = await text.inputValue();
  const marketReference = extracted.split('\n').find(line => line.includes('Synthetic Market'))?.match(/^\[(P\d+:L\d+)\]/)?.[1];
  const refundReference = extracted.split('\n').find(line => line.includes('Synthetic Refund'))?.match(/^\[(P\d+:L\d+)\]/)?.[1];
  expect(marketReference).toBeTruthy();
  expect(refundReference).toBeTruthy();
  const useText = page.getByRole('button', { name: 'Use reviewed text for manual mapping' });
  await expect(useText).toBeDisabled();
  const checked = page.getByRole('checkbox', { name: 'I checked this text against the original', exact: false });
  await checked.check();
  await expect(useText).toBeEnabled();
  await text.fill(`${await text.inputValue()}\nManually checked synthetic source.`);
  await expect(checked).not.toBeChecked();
  await expect(useText).toBeDisabled();
  await checked.check();
  await useText.click();
  await expect(page.getByText('Extracted source · unverified', { exact: true })).toBeVisible();
  await expect(page.locator('.source-context')).toContainText('user confirmed review; manually edited');
  const csv = page.getByLabel('CSV with a header row');
  await expect(csv).toHaveValue('Date,Description,Amount,Source line\n');
  await expect(page.getByRole('dialog').locator('tbody tr')).toHaveCount(0);
  await csv.fill(`Date,Description,Amount,Source line\n2026-10-24,Synthetic Market,-86.42,${marketReference}\n2026-10-25,Synthetic Refund,12.50,${refundReference}`);
  await page.getByRole('button', { name: 'Preview columns', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Map your columns' })).toBeVisible();
  await expect(page.getByLabel('Date column', { exact: true })).toHaveValue('Date');
  await expect(page.getByLabel('Amount column', { exact: true })).toHaveValue('Amount');
  await page.getByRole('combobox', { name: 'Source page/line column', exact: false }).selectOption('Source line');
  const addRows = page.getByRole('button', { name: 'Add 2 rows to review', exact: true });
  const mappingConfirmation = page.getByRole('checkbox', { name: 'I verified the date format, amount convention, and column mapping.', exact: true });
  await expect(mappingConfirmation).not.toBeChecked();
  await expect(addRows).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Edit Synthetic Market row 2' })).toHaveCount(0);
  await mappingConfirmation.check();
  await expect(addRows).toBeEnabled();
  await mappingConfirmation.uncheck();
  await expect(addRows).toBeDisabled();
  await mappingConfirmation.check();
  await addRows.click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.locator('tbody')).toContainText('Synthetic Market');
  await page.getByRole('button', { name: 'Edit Synthetic Market row 2' }).click();
  const rowSource = page.locator('.source-context').first();
  await expect(rowSource).toContainText(`Document reference: ${marketReference}`);
  await expect(rowSource).not.toContainText('SYNTHETIC STATEMENT');
  const fullSource = page.locator('details .source-context');
  await expect(fullSource).not.toBeVisible();
  await page.getByText('Compare full extracted document (unverified)', { exact: true }).click();
  await expect(fullSource).toBeVisible();
  await expect(fullSource).toContainText(extracted);
  await expect(fullSource).toContainText('user confirmed review; manually edited');
  await expect(fullSource).toContainText('Manually checked synthetic source.');
}

test('extracts real PDF text and requires review before manual CSV mapping', async ({ page }) => {
  await choose(page, 'synthetic-text-statement.pdf', 'application/pdf', syntheticTextPdf());
  await reviewAndMap(page, 'PDF text');
  expect(loadedAssets.get(page)).toContain('/vendor/pdf.worker.min.mjs');
});

for (const kind of ['photo', 'scan'] as const) {
  test(`extracts a synthetic ${kind} with real local OCR and manual mapping`, async ({ page }) => {
    await choose(page, `synthetic-${kind}-statement.${kind === 'photo' ? 'png' : 'pdf'}`, kind === 'photo' ? 'image/png' : 'application/pdf', kind === 'photo' ? photo : scanned);
    await reviewAndMap(page, 'OCR — verify');
    expect(loadedAssets.get(page)).toContain('/vendor/worker.min.js');
    expect(loadedAssets.get(page)).toContain('/vendor/lang/eng.traineddata.gz');
    expect(loadedAssets.get(page)?.some(path => path.startsWith('/vendor/tesseract-core/'))).toBe(true);
  });
}

for (const cancelImport of [false, true]) {
  test(`cancels active OCR ${cancelImport ? 'by leaving import' : 'and retries successfully'}`, async ({ page }) => {
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const requested = new Promise<void>(resolve => { started = resolve; });
    await page.route('**/vendor/worker.min.js', async route => {
      started();
      await held;
      await route.continue().catch(() => {});
    }, { times: 1 });
    try {
      await choose(page, 'synthetic-cancellation.png', 'image/png', photo);
      await requested;
      await page.getByRole('button', { name: cancelImport ? 'Cancel import' : 'Stop extraction', exact: true }).click();
      await expect(page.getByLabel('Extracted text — editable, with page and line references', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('dialog').locator('tbody tr')).toHaveCount(0);
      if (cancelImport) {
        await expect(page.getByRole('button', { name: 'Choose a file', exact: true })).toBeVisible();
      } else {
        await expect(page.getByRole('status')).toContainText('Extraction cancelled');
        await expect(page.getByRole('button', { name: 'Extract text', exact: true })).toBeEnabled();
      }
    } finally {
      release();
    }
    if (cancelImport) {
      await choose(page, 'synthetic-retry.pdf', 'application/pdf', syntheticTextPdf());
      await reviewAndMap(page, 'PDF text');
    } else {
      await page.getByRole('button', { name: 'Extract text', exact: true }).click();
      await reviewAndMap(page, 'OCR — verify');
    }
    await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
  });
}
