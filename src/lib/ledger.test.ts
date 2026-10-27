import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import { DEFAULT_CONFIG } from "./config";
import { exportCsv, exportXlsx, flagDuplicates, formatCents, importCsv, normalizeRows, parseCsv, parseMoneyToCents, parseTransactionDate, reconcileDuplicates, suggestCategory, transactionFingerprint, type Mapping } from "./ledger";

const mapping: Mapping = {
  date: "Date", description: "Description", amount: "Amount",
  dateFormat: "ISO", signConvention: "negative-expense",
};

describe("integer money", () => {
  it.each([
    ["0.29", 29], ["-1,234.56", -123456], ["($12.30)", -1230],
    ["CAD 20.1", 2010], ["+£2.00", 200], ["-0.00", 0],
    ["1,23", null], ["1.234", null], ["1e3", null], ["", null],
    ["(-1.00)", null], ["90071992547410.00", null], ["12abc", null],
    ["90071992547409.90", 9007199254740990], ["90071992547409.91", Number.MAX_SAFE_INTEGER],
  ])("parses %s safely", (value, expected) => {
    expect(parseMoneyToCents(value as string)).toBe(expected);
  });
  it.each([0, -0, 1, -1, 29, -229, 9007199254740990, -9007199254740990, Number.MAX_SAFE_INTEGER])("formats %s cents without changing the amount", (cents) => {
    expect(parseMoneyToCents(formatCents(cents))).toBe(cents === 0 ? 0 : cents);
  });
  it("keeps two decimal places and rejects invalid domain amounts", () => {
    expect(formatCents(9007199254740990)).toBe("90071992547409.90");
    expect(formatCents(-1)).toBe("-0.01");
    expect(formatCents(-0)).toBe("0.00");
    for (const cents of [0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => formatCents(cents)).toThrow("safe integer cents");
    }
  });
});

describe("explicit dates", () => {
  it("uses the selected order instead of guessing", () => {
    expect(parseTransactionDate("03/04/2026", "MDY")).toBe("2026-03-04");
    expect(parseTransactionDate("03/04/2026", "DMY")).toBe("2026-04-03");
    expect(parseTransactionDate("03/04/2026", "ISO")).toBeNull();
  });
  it("rejects calendar overflow, invalid leap days, and two-digit years", () => {
    expect(parseTransactionDate("2024-02-29", "ISO")).toBe("2024-02-29");
    for (const value of ["2026-02-29", "2026-04-31", "0000-01-01", "2026-13-01"]) {
      expect(parseTransactionDate(value, "ISO")).toBeNull();
    }
    expect(parseTransactionDate("1/2/26", "MDY")).toBeNull();
  });
});

describe("CSV import and review", () => {
  it("retains quoted commas, multiline text, raw source and physical row numbers", () => {
    const text = 'Date,Description,Amount\r\n2026-01-01,"Store,\r\nDowntown",-2.29\r\n2026-01-02,Other,-1\r\n';
    const parsed = parseCsv(text);
    expect(parsed.headers).toEqual(["Date", "Description", "Amount"]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].cells[1]).toBe("Store,\r\nDowntown");
    expect(parsed.rows[0].sourceText).toBe('2026-01-01,"Store,\r\nDowntown",-2.29\r\n');
    expect(parsed.rows[1].row).toBe(4);
    const result = normalizeRows(parsed, mapping, { fileName: "synthetic.csv", currency: "USD" });
    expect(result.transactions[0]).toMatchObject({ amountCents: -229, currency: "USD", row: 2, fileName: "synthetic.csv" });
  });
  it("keeps malformed and blank interior rows with issues", () => {
    const result = importCsv("Date,Description,Amount\nwrong,Test,nope\n\n2026-01-01,Missing\n", mapping);
    expect(result.transactions).toHaveLength(3);
    expect(result.transactions.every((transaction) => transaction.needsReview)).toBe(true);
    expect(result.transactions[0]).toMatchObject({ date: null, amountCents: null, sourceText: "wrong,Test,nope\n" });
    expect(result.transactions[2].issues.some((issue) => issue.code === "column-count")).toBe(true);
  });
  it("retains CSV syntax problems and duplicate headers", () => {
    const parsed = parseCsv('Date,Description,Amount\n2026-01-01,"Unclosed,-2');
    expect(parsed.rows[0].issues.some((issue) => issue.code.startsWith("csv-"))).toBe(true);
    const result = importCsv("Date,Description,Amount,Amount\n2026-01-01,Test,-1,-2", mapping);
    expect(result.issues.some((issue) => issue.code === "duplicate-header")).toBe(true);
    expect(result.transactions[0].needsReview).toBe(true);
    expect(parseCsv("").issues[0].code).toBe("empty-csv");
  });
  it("normalizes either amount convention", () => {
    const text = "Date,Description,Amount\n2026-01-01,Purchase,10\n2026-01-02,Deposit,-20";
    const result = importCsv(text, { ...mapping, signConvention: "positive-expense" });
    expect(result.transactions.map(({ amountCents, type }) => [amountCents, type])).toEqual([[-1000, "expense"], [2000, "income"]]);
  });
  it("supports debit and credit without silently netting ambiguous rows", () => {
    const { amount: unusedAmount, ...base } = mapping;
    void unusedAmount;
    const result = importCsv("Date,Description,Debit,Credit\n2026-01-01,Purchase,12.10,\n2026-01-02,Deposit,,20\n2026-01-03,Both,3,4\n2026-01-04,Negative,-2,", { ...base, debit: "Debit", credit: "Credit" });
    expect(result.transactions.map((transaction) => transaction.amountCents)).toEqual([-1210, 2000, null, null]);
    expect(result.transactions[2].issues.some((issue) => issue.code === "invalid-debit-credit")).toBe(true);
  });
  it("requires explicit valid column mappings", () => {
    const result = importCsv("Date,Description,Amount\n2026-01-01,Test,1", { ...mapping, date: "Missing", debit: "Amount", credit: "Amount" });
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["invalid-mapping", "amount-mapping"]));
    expect(result.transactions[0]).toMatchObject({ date: null, amountCents: null, needsReview: true });
  });
  it("keeps income, refund and transfer distinct and flags conflicting signs", () => {
    const result = importCsv("Date,Description,Amount,Type,Currency\n2026-01-01,Payroll,50,income,USD\n2026-01-02,Returned item,5,refund,EUR\n2026-01-03,Move funds,-10,transfer,GBP\n2026-01-04,Bad refund,-5,refund,JPY", { ...mapping, type: "Type", currency: "Currency" });
    expect(result.transactions.map((transaction) => transaction.type)).toEqual(["income", "refund", "transfer", "refund"]);
    expect(result.transactions[3].issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["invalid-currency", "type-sign-mismatch"]));
  });
  it.each([
    ["EUR 10.00", "CAD"], ["10.00 usd", "CAD"], ["€10.00", "USD"],
    ["-£10.00", "EUR"], ["$10.00", "GBP"], ["USD €10.00", "USD"],
    ["EUR10.00", "CAD"], ["10.00EUR", "CAD"], ["(EUR10.00)", "CAD"],
    ["(10.00eur)", "CAD"], ["CAD10.00EUR", "CAD"], ["EUR10.00CAD", "CAD"],
  ] as const)("flags embedded currency conflict in %s mapped as %s", (amount, currency) => {
    const transaction = importCsv(`Date,Description,Amount,Currency\n2026-01-01,Other,${amount},${currency}`, { ...mapping, currency: "Currency" }).transactions[0];
    expect(transaction.needsReview).toBe(true);
    expect(transaction.issues.some((issue) => issue.code === "currency-conflict")).toBe(true);
    expect(transaction.sourceText).toContain(amount);
  });
  it.each([
    ["CAD 10.00", "CAD"], ["10.00 usd", "USD"], ["€10.00", "EUR"],
    ["-£10.00", "GBP"], ["$10.00", "CAD"], ["$10.00", "USD"],
    ["EUR10.00", "EUR"], ["10.00eur", "EUR"], ["(EUR10.00)", "EUR"],
    ["(10.00EUR)", "EUR"], ["EUR10.00EUR", "EUR"],
  ] as const)("allows compatible embedded currency in %s mapped as %s", (amount, currency) => {
    const transaction = importCsv(`Date,Description,Amount,Currency\n2026-01-01,Other,${amount},${currency}`, { ...mapping, currency: "Currency" }).transactions[0];
    expect(transaction.needsReview).toBe(false);
    expect(transaction.originalCurrency).toBeUndefined();
  });
  it("checks fallback currency and both debit/credit fields for embedded conflicts", () => {
    const fallback = importCsv("Date,Description,Amount\n2026-01-01,Other,EUR 10.00", mapping).transactions[0];
    expect(fallback.issues.some((issue) => issue.code === "currency-conflict")).toBe(true);
    for (const [debit, credit] of [["€10.00", ""], ["", "£10.00"], ["EUR10.00", ""], ["", "10.00GBP"]]) {
      const transaction = importCsv(`Date,Description,Debit,Credit\n2026-01-01,Other,${debit},${credit}`, { ...mapping, amount: undefined, debit: "Debit", credit: "Credit" }).transactions[0];
      expect(transaction.issues.some((issue) => issue.code === "currency-conflict")).toBe(true);
    }
  });
  it("preserves unsupported original currency, including blank mapped values and embedded codes", () => {
    for (const original of ["JPY", "jpy", ""]) {
      const transaction = importCsv(`Date,Description,Amount,Currency\n2026-01-01,Other,10,${original}`, { ...mapping, currency: "Currency" }, { currency: "USD" }).transactions[0];
      expect(transaction).toMatchObject({ currency: "USD", originalCurrency: original, needsReview: true });
      expect(transaction.issues.some((issue) => issue.code === "invalid-currency")).toBe(true);
    }
    const embedded = importCsv("Date,Description,Amount\n2026-01-01,Other,JPY 10.00", mapping).transactions[0];
    expect(embedded).toMatchObject({ originalCurrency: "JPY", amountCents: null, needsReview: true });
    expect(embedded.issues.some((issue) => issue.code === "invalid-currency")).toBe(true);
    for (const amount of ["JPY10.00", "10.00JPY"]) {
      const adjacent = importCsv(`Date,Description,Amount\n2026-01-01,Other,${amount}`, mapping).transactions[0];
      expect(adjacent).toMatchObject({ originalCurrency: "JPY", amountCents: null, needsReview: true });
    }
  });
  it("validates imported categories against the configured list and permits null", () => {
    for (const category of [...DEFAULT_CONFIG.categories, ""]) {
      const transaction = importCsv(`Date,Description,Amount,Category\n2026-01-01,Other,-1,${category}`, { ...mapping, category: "Category" }).transactions[0];
      expect(transaction.category).toBe(category || null);
      expect(transaction.needsReview).toBe(false);
    }
    for (const category of ["Not a category", "=1+1", "@SUM(A1)", "groceries"]) {
      const transaction = importCsv(`Date,Description,Amount,Category\n2026-01-01,Other,-1,${category}`, { ...mapping, category: "Category" }).transactions[0];
      expect(transaction).toMatchObject({ category, needsReview: true });
      expect(transaction.issues.some((issue) => issue.code === "invalid-category")).toBe(true);
    }
  });
  it("leaves inferred categories unaccepted and uncertain types for review", () => {
    const result = importCsv("Date,Description,Amount\n2026-01-01,Coffee,-3\n2026-01-02,Refund,3\n2026-01-03,Transfer,-3", mapping);
    expect(result.transactions[0]).toMatchObject({ category: null, suggestedCategory: "Food & Dining", needsReview: true });
    expect(result.transactions[1].issues.some((issue) => issue.code === "review-type")).toBe(true);
    expect(result.transactions[2].issues.some((issue) => issue.code === "review-type")).toBe(true);
  });
  it("flags duplicates without removing rows, mutating inputs or crossing currencies", () => {
    const result = importCsv("Date,Description,Amount,Currency\n2026-01-01,Other,-1,CAD\n2026-01-01,OTHER,-1,CAD\n2026-01-01,Other,-1,USD", { ...mapping, currency: "Currency" });
    expect(result.transactions).toHaveLength(3);
    expect(result.transactions[1].duplicateOf).toBe(result.transactions[0].id);
    expect(result.transactions[2].duplicateOf).toBeNull();
    const original = structuredClone(result.transactions);
    expect(flagDuplicates(result.transactions)).toEqual(original);
    expect(result.transactions).toEqual(original);
  });
  it("gives independent imports unique IDs so duplicates can reference another row", () => {
    const text = "Date,Description,Amount\n2026-01-01,Other,-1";
    const first = importCsv(text, mapping).transactions[0];
    const second = importCsv(text, mapping).transactions[0];
    expect(first.id).not.toBe(second.id);
    expect(flagDuplicates([first, second])[1].duplicateOf).toBe(first.id);
  });
  it("uses the application's reviewable category vocabulary", () => {
    expect(suggestCategory("Payroll", "income")).toBe("Income");
    expect(suggestCategory("Move funds", "transfer")).toBe("Transfer");
    expect(suggestCategory("Taxi")).toBe("Transport");
  });
});

describe("duplicate reconciliation", () => {
  function duplicateRows() {
    return importCsv("Date,Description,Amount\n2026-01-01,Other,-1\n2026-01-01,Other,-1", mapping).transactions;
  }

  it("retains explicit acknowledgment through unrelated imports without mutating inputs", () => {
    const [first, duplicate] = duplicateRows();
    const acknowledged = { ...duplicate, issues: [], needsReview: false, duplicateAcknowledgedFingerprint: transactionFingerprint(duplicate) };
    const unrelated = importCsv("Date,Description,Amount\n2026-02-01,Unrelated,-2", mapping).transactions;
    const input = [first, acknowledged, ...unrelated];
    const before = structuredClone(input);
    const result = reconcileDuplicates(input);
    expect(result).toHaveLength(input.length);
    expect(result[1]).toMatchObject({ duplicateOf: first.id, needsReview: false, issues: [], duplicateAcknowledgedFingerprint: transactionFingerprint(duplicate) });
    expect(reconcileDuplicates(result)).toEqual(result);
    expect(input).toEqual(before);
  });

  it("does not treat existing confirmation without a fingerprint as duplicate acknowledgment", () => {
    const rows = duplicateRows().map((transaction) => ({ ...transaction, needsReview: false, issues: [] }));
    const result = reconcileDuplicates(rows);
    expect(result[1].needsReview).toBe(true);
    expect(result[1].issues.some((issue) => issue.code === "possible-duplicate")).toBe(true);
  });

  it("flags newly imported duplicates while preserving an existing acknowledgment", () => {
    const [first, duplicate] = duplicateRows();
    const acknowledged = { ...duplicate, issues: [], needsReview: false, duplicateAcknowledgedFingerprint: transactionFingerprint(duplicate) };
    const incoming = duplicateRows()[0];
    const result = reconcileDuplicates([first, acknowledged, incoming]);
    expect(result[1].needsReview).toBe(false);
    expect(result[2]).toMatchObject({ duplicateOf: first.id, needsReview: true });
    expect(result[2].duplicateAcknowledgedFingerprint).toBeUndefined();
  });

  it.each([
    { date: "2026-01-02" }, { description: "Changed" }, { amountCents: -200 },
    { currency: "USD" as const }, { type: "transfer" as const },
  ])("invalidates acknowledgment when fingerprint fields change: %j", (change) => {
    const [first, duplicate] = duplicateRows();
    const acknowledged = { ...duplicate, ...change, issues: [], needsReview: false, duplicateAcknowledgedFingerprint: transactionFingerprint(duplicate) };
    const result = reconcileDuplicates([{ ...first, ...change }, acknowledged]);
    expect(result[1]).toMatchObject({ duplicateOf: first.id, needsReview: true });
    expect(result[1].duplicateAcknowledgedFingerprint).toBeUndefined();
  });

  it("requires a fresh acknowledgment when the duplicate target changes", () => {
    const [first, duplicate] = duplicateRows();
    const acknowledged = { ...duplicate, issues: [], needsReview: false, duplicateAcknowledgedFingerprint: transactionFingerprint(duplicate) };
    const replacement = { ...first, id: "replacement-original" };
    const result = reconcileDuplicates([replacement, acknowledged]);
    expect(result[1]).toMatchObject({ duplicateOf: replacement.id, needsReview: true });
    expect(result[1].duplicateAcknowledgedFingerprint).toBeUndefined();
  });

  it("keeps other review issues and an explicit pending status", () => {
    const [first, duplicate] = duplicateRows();
    const acknowledged = { ...duplicate, issues: [{ code: "invalid-currency", message: "Verify currency." }], needsReview: false, duplicateAcknowledgedFingerprint: transactionFingerprint(duplicate) };
    expect(reconcileDuplicates([first, acknowledged])[1]).toMatchObject({ needsReview: true, issues: acknowledged.issues });
    expect(reconcileDuplicates([first, { ...acknowledged, issues: [], needsReview: true }])[1].needsReview).toBe(true);
  });

  it("shares duplicate normalization and ignores nonidentity fields in the fingerprint", () => {
    const original = duplicateRows()[0];
    expect(transactionFingerprint({ ...original, description: "  OTHER  " })).toBe(transactionFingerprint(original));
    const annotated = { ...original, note: "New note", category: "Other" };
    expect(transactionFingerprint(annotated)).toBe(transactionFingerprint(original));
    expect(reconcileDuplicates([])).toEqual([]);
    const invalid = { ...original, date: null, amountCents: null };
    expect(reconcileDuplicates([invalid, { ...invalid, id: "invalid-2" }]).every((transaction) => transaction.duplicateOf === null)).toBe(true);
  });
});

describe("safe exports", () => {
  it("escapes formula-like text while preserving signed numeric amounts and invalid rows", () => {
    const result = importCsv('Date,Description,Amount\n2026-01-01,"  =HYPERLINK(""test"")",-2.29\nwrong,@bad,bad', mapping, { fileName: "+file.csv" });
    const csv = exportCsv(result.transactions);
    const parsed = Papa.parse<string[]>(csv).data;
    expect(parsed).toHaveLength(3);
    expect(parsed[1][1]).toBe("'=HYPERLINK(\"test\")");
    expect(parsed[1][2]).toBe("-2.29");
    expect(parsed[1][11]).toBe("'+file.csv");
    expect(parsed[2][1]).toBe("'@bad");
    expect(parsed[2][2]).toBe("");
    expect(parsed[2][12]).toContain("wrong,@bad,bad");
  });
  it("exports notes safely and keeps large integer cents exact in CSV", () => {
    const transactions = importCsv("Date,Description,Amount\n2026-01-01,Large,-90071992547409.90", mapping).transactions;
    transactions[0].note = "\t=1+1";
    const rows = Papa.parse<string[]>(exportCsv(transactions)).data;
    expect(rows[0][13]).toBe("Note");
    expect(rows[1][13]).toBe("'\t=1+1");
    expect(rows[1][2]).toBe("-90071992547409.90");
  });
  it("preserves and escapes original currencies and unrecognized categories in exports", async () => {
    const transactions = importCsv("Date,Description,Amount,Currency,Category\n2026-01-01,Other,-1,=JPY,=1+1", { ...mapping, currency: "Currency", category: "Category" }).transactions;
    const rows = Papa.parse<string[]>(exportCsv(transactions)).data;
    expect(rows[0][14]).toBe("Original currency");
    expect(rows[1][14]).toBe("'=JPY");
    expect(rows[1][5]).toBe("'=1+1");
    const bytes = await exportXlsx(transactions);
    const { Workbook } = await import("exceljs");
    const workbook = new Workbook();
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    expect(workbook.getWorksheet("Transactions")!.getCell("O2").value).toBe("'=JPY");
    expect(workbook.getWorksheet("Transactions")!.getCell("F2").value).toBe("'=1+1");
  });
  it.each([100000000000000, -100000000000000, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER])("rejects XLSX precision loss for %s cents while CSV stays exact", async (amountCents) => {
    const transactions = importCsv("Date,Description,Amount\n2026-01-01,Other,-1", mapping).transactions;
    transactions[0].amountCents = amountCents;
    await expect(exportXlsx(transactions)).rejects.toThrow("Use CSV");
    expect(Papa.parse<string[]>(exportCsv(transactions)).data[1][2]).toBe(formatCents(amountCents));
  });
  it("allows both signs at the XLSX boundary and preserves null amounts", async () => {
    const transactions = importCsv("Date,Description,Amount\n2026-01-01,Other,999999999999.99\n2026-01-02,Other,-999999999999.99\n2026-01-03,Other,invalid", mapping).transactions;
    const bytes = await exportXlsx(transactions);
    const { Workbook } = await import("exceljs");
    const workbook = new Workbook();
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet("Transactions")!;
    expect(parseMoneyToCents((sheet.getCell("C2").value as number).toFixed(2))).toBe(99999999999999);
    expect(parseMoneyToCents((sheet.getCell("C3").value as number).toFixed(2))).toBe(-99999999999999);
    expect(sheet.getCell("C4").value).toBe("");
  });
  it("writes a real workbook with numeric amounts and inert text", async () => {
    const transactions = importCsv("Date,Description,Amount\n2026-01-01,=1+1,-12.34", mapping).transactions;
    transactions[0].note = "@review";
    const bytes = await exportXlsx(transactions);
    const { Workbook } = await import("exceljs");
    const workbook = new Workbook();
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet("Transactions")!;
    expect(sheet.getCell("B2").value).toBe("'=1+1");
    expect(sheet.getCell("C2").value).toBe(-12.34);
    expect(sheet.getCell("N2").value).toBe("'@review");
    expect(sheet.rowCount).toBe(2);
  });
});
