import { expect, test } from '@playwright/test';

test('synthetic overview, search, sorting, mobile layout, and clear', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A clearer picture.' })).toBeVisible();
  await expect(page.getByText('You’re exploring a synthetic demo.')).toBeVisible();
  await expect(page.getByText('$405.83', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(13);
  await page.getByRole('searchbox', { name: 'Search transactions' }).fill('Coffee');
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(3);
  await page.getByRole('searchbox').fill('not a real merchant');
  await expect(page.getByRole('heading', { name: 'No matching transactions' })).toBeVisible();
  await page.getByRole('searchbox').fill('');
  await page.getByRole('button', { name: 'Date', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Date' })).toHaveAttribute('aria-sort', 'ascending');
  await expect(page.locator('html')).toHaveJSProperty('scrollWidth', await page.locator('html').evaluate(element => element.clientWidth));
  await page.screenshot({ path: testInfo.outputPath(`overview-${testInfo.project.name}.png`), fullPage: true });
  await page.getByRole('button', { name: 'Clear workspace' }).click();
  await page.getByRole('button', { name: 'Clear all data' }).click();
  await expect(page.getByRole('heading', { name: 'A fresh start' })).toBeVisible();
  await expect(page.getByText('Your file')).toHaveCount(0);
});

test('CSV import retains invalid and duplicate rows, edits change totals, exports are private', async ({ page }) => {
  const outbound: string[] = [];
  page.on('request', request => {
    if (!request.url().startsWith('http://127.0.0.1:3000') && !request.url().startsWith('blob:') && !request.url().startsWith('data:')) outbound.push(request.url());
    if (request.method() !== 'GET') outbound.push(`${request.method()} ${request.url()}`);
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Import statement', exact: true }).first().click();
  const csv = 'Date,Description,Amount,Currency,Type\n2026-10-24,"Synthetic grocery, west",-10.25,CAD,expense\n2026-10-24,"Synthetic grocery, west",-10.25,CAD,expense\n2026-02-30,Bad row,unknown,CAD,expense';
  await page.getByLabel('Statement file', { exact: true }).setInputFiles({ name: 'synthetic.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByRole('heading', { name: 'Map your columns' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'I verified the date format' }).check();
  await page.getByRole('button', { name: 'Add 3 rows to review' }).click();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(4);
  await expect(page.getByText('Check date', { exact: true })).toBeVisible();
  await expect(page.getByText('Check amount', { exact: true })).toBeVisible();
  await expect(page.getByText('Totals use 0 confirmed CAD rows', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Synthetic grocery, west row 2', exact: true }).click();
  await page.getByLabel('Category', { exact: true }).selectOption('Groceries');
  await page.getByRole('checkbox', { name: 'I checked this row' }).check();
  await page.getByRole('button', { name: 'Save transaction' }).click();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(3);
  await expect(page.getByText('Totals use 1 confirmed CAD rows', { exact: false })).toBeVisible();
  await page.getByRole('tab', { name: 'All transactions' }).click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV', exact: true }).click();
  expect((await csvDownload).suggestedFilename()).toBe('tallytrail-transactions.csv');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const xlsxDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download XLSX', exact: true }).click();
  expect((await xlsxDownload).suggestedFilename()).toBe('tallytrail-transactions.xlsx');
  expect(outbound).toEqual([]);
});

test('public configuration and safe fallback form work', async ({ page, request }) => {
  const response = await request.get('/api/config');
  expect(response.ok()).toBeTruthy();
  const config = await response.json();
  expect(config.form.fields.map((field: { name: string }) => field.name)).toEqual(['category', 'note']);
  await page.route('**/api/config', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"categories":[],"form":{"fields":[]}}' }));
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('built-in category form');
  await page.getByRole('button', { name: 'Edit Juniper Market row 2', exact: true }).click();
  await expect(page.getByLabel('Category', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
