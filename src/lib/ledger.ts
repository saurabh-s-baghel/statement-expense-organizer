import Papa from "papaparse";
import { DEFAULT_CONFIG } from "./config";

export type Currency = "CAD" | "USD" | "EUR" | "GBP";
export type TransactionType = "expense" | "income" | "refund" | "transfer";
export type DateFormat = "ISO" | "MDY" | "DMY";
export type SignConvention = "negative-expense" | "positive-expense";
export interface ImportIssue {
  code: string;
  message: string;
  row?: number;
  field?: string;
}
export interface ParsedRow {
  cells: string[];
  sourceText: string;
  row: number;
  issues: ImportIssue[];
}
export interface ParsedCsv {
  headers: string[];
  rows: ParsedRow[];
  issues: ImportIssue[];
}
export interface Mapping {
  date: string;
  description: string;
  amount?: string;
  debit?: string;
  credit?: string;
  dateFormat: DateFormat;
  signConvention: SignConvention;
  currency?: string;
  type?: string;
  category?: string;
}
export type ColumnMapping = Mapping;
export interface Transaction {
  id: string;
  date: string | null;
  description: string;
  amountCents: number | null;
  currency: Currency;
  originalCurrency?: string;
  type: TransactionType;
  category: string | null;
  suggestedCategory: string | null;
  needsReview: boolean;
  issues: ImportIssue[];
  duplicateOf: string | null;
  duplicateAcknowledgedFingerprint?: string;
  sourceText: string;
  row: number;
  fileName: string | null;
  note?: string;
}
export interface ImportOptions {
  fileName?: string;
  currency?: Currency;
}
export interface ImportResult {
  transactions: Transaction[];
  issues: ImportIssue[];
}

const currencies: readonly string[] = ["CAD", "USD", "EUR", "GBP"];
const transactionTypes: readonly string[] = ["expense", "income", "refund", "transfer"];

export function parseCsv(text: string): ParsedCsv {
  const records: ParsedRow[] = [];
  const issues: ImportIssue[] = [];
  let previousCursor = 0;
  let physicalRow = 1;
  const input = text.replace(/^\uFEFF/, "");
  Papa.parse<string[]>(input, {
    skipEmptyLines: false,
    step(result) {
      const sourceText = input.slice(previousCursor, result.meta.cursor);
      const row = physicalRow;
      physicalRow += (sourceText.match(/\r\n|\r|\n/g) ?? []).length;
      previousCursor = result.meta.cursor;
      const rowIssues = result.errors.map((error) => ({
        code: `csv-${error.code}`,
        message: error.message,
        row,
      }));
      records.push({ cells: result.data, sourceText, row, issues: rowIssues });
    },
  });
  if (records.at(-1)?.sourceText === "") records.pop();
  const header = records.shift();
  if (!header || input.trim() === "") {
    return { headers: [], rows: [], issues: [{ code: "empty-csv", message: "The CSV is empty." }] };
  }
  const headers = header.cells.map((value) => value.trim());
  issues.push(...header.issues);
  if (headers.some((value) => value === "")) {
    issues.push({ code: "empty-header", message: "Every column needs a nonempty header.", row: header.row });
  }
  if (new Set(headers).size !== headers.length) {
    issues.push({ code: "duplicate-header", message: "Duplicate column names must be corrected before mapping.", row: header.row });
  }
  for (const record of records) {
    if (record.cells.length !== headers.length) {
      record.issues.push({ code: "column-count", message: "Row has a different number of cells than the header.", row: record.row });
    }
  }
  return { headers, rows: records, issues };
}

function moneyParts(value: string): { normalized: string; parenthesized: boolean; currencyCodes: string[] } {
  let normalized = value.trim();
  const parenthesized = normalized.startsWith("(") && normalized.endsWith(")");
  if (parenthesized) normalized = normalized.slice(1, -1).trim();
  const currencyCodes: string[] = [];
  const collectCurrency = (_match: string, code: string) => {
    currencyCodes.push(code);
    return "";
  };
  normalized = normalized.replace(/^(CAD|USD|EUR|GBP)\s*/i, collectCurrency).replace(/\s*(CAD|USD|EUR|GBP)$/i, collectCurrency);
  return { normalized, parenthesized, currencyCodes };
}

export function parseMoneyToCents(value: string): number | null {
  const parts = moneyParts(value);
  let normalized = parts.normalized;
  const { parenthesized } = parts;
  if (!normalized) return null;
  normalized = normalized.replace(/^([+-]?)\s*[$€£]\s*/, "$1").trim();
  if (parenthesized && /^[+-]/.test(normalized)) return null;
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(normalized)) return null;
  const negative = parenthesized || normalized.startsWith("-");
  const unsigned = normalized.replace(/^[+-]/, "").replace(/,/g, "");
  const [whole, fraction = ""] = unsigned.split(".");
  const exactCents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  if (exactCents > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const cents = Number(exactCents);
  return cents === 0 ? 0 : negative ? -cents : cents;
}

export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError("Amount must be safe integer cents.");
  const absolute = BigInt(Math.abs(cents));
  return `${cents < 0 ? "-" : ""}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, "0")}`;
}

export function parseTransactionDate(value: string, format: DateFormat): string | null {
  const normalized = value.trim();
  const match = format === "ISO"
    ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized)
    : /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(normalized);
  if (!match) return null;
  const year = Number(format === "ISO" ? match[1] : match[3]);
  const month = Number(format === "ISO" ? match[2] : format === "MDY" ? match[1] : match[2]);
  const day = Number(format === "ISO" ? match[3] : format === "MDY" ? match[2] : match[1]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > days[month - 1]) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function suggestCategory(description: string, type: TransactionType = "expense"): string | null {
  if (type === "transfer") return "Transfer";
  if (type === "income") return /\b(payroll|salary|paycheque|paycheck)\b/i.test(description) ? "Income" : null;
  const rules: Array<[RegExp, string]> = [
    [/\b(grocery|groceries|supermarket)\b/i, "Groceries"],
    [/\b(cafe|coffee|restaurant|pizza)\b/i, "Food & Dining"],
    [/\b(transit|bus|uber|lyft|taxi|fuel|gas station)\b/i, "Transport"],
    [/\b(rent|mortgage)\b/i, "Housing"],
    [/\b(electric|electricity|water bill|internet|utility)\b/i, "Utilities"],
  ];
  return rules.find(([pattern]) => pattern.test(description))?.[1] ?? null;
}

export function normalizeRows(parsed: ParsedCsv, mapping: Mapping, options: ImportOptions = {}): ImportResult {
  const globalIssues = [...parsed.issues];
  const mappedFields = ["date", "description", "amount", "debit", "credit", "currency", "type", "category"] as const;
  for (const field of mappedFields) {
    const column = mapping[field];
    if ((field === "date" || field === "description") && !column) {
      globalIssues.push({ code: "missing-mapping", message: `Select a ${field} column.`, field });
    } else if (column && parsed.headers.filter((header) => header === column).length !== 1) {
      globalIssues.push({ code: "invalid-mapping", message: `Column "${column}" must exist exactly once.`, field });
    }
  }
  if (Boolean(mapping.amount) === Boolean(mapping.debit || mapping.credit) || (!mapping.amount && (!mapping.debit || !mapping.credit))) {
    globalIssues.push({ code: "amount-mapping", message: "Map either one amount column or both debit and credit columns.", field: "amount" });
  }
  if (mapping.debit && mapping.debit === mapping.credit) {
    globalIssues.push({ code: "amount-mapping", message: "Debit and credit must use different columns.", field: "amount" });
  }
  if (!["ISO", "MDY", "DMY"].includes(mapping.dateFormat)) {
    globalIssues.push({ code: "date-format", message: "Choose ISO, MDY, or DMY explicitly.", field: "date" });
  }
  if (!["negative-expense", "positive-expense"].includes(mapping.signConvention)) {
    globalIssues.push({ code: "sign-convention", message: "Choose an explicit amount sign convention.", field: "amount" });
  }
  const importId = globalThis.crypto.randomUUID();
  const transactions = parsed.rows.map((record, index): Transaction => {
    const issues = [...record.issues, ...globalIssues.map((issue) => ({ ...issue, row: record.row }))];
    const cell = (column?: string) => column ? record.cells[parsed.headers.indexOf(column)]?.trim() ?? "" : "";
    const addIssue = (code: string, message: string, field: string) => issues.push({ code, message, field, row: record.row });
    const date = parseTransactionDate(cell(mapping.date), mapping.dateFormat);
    if (!date) addIssue("invalid-date", "Date is missing or invalid for the selected format.", "date");
    const description = cell(mapping.description);
    if (!description) addIssue("missing-description", "Description is required.", "description");
    let amountCents: number | null = null;
    if (mapping.amount) {
      const amount = parseMoneyToCents(cell(mapping.amount));
      amountCents = amount === null ? null : mapping.signConvention === "positive-expense" ? -amount : amount;
    } else {
      const debitText = cell(mapping.debit);
      const creditText = cell(mapping.credit);
      const debit = debitText ? parseMoneyToCents(debitText) : 0;
      const credit = creditText ? parseMoneyToCents(creditText) : 0;
      if (debit !== null && credit !== null && debit >= 0 && credit >= 0 && !(debit > 0 && credit > 0) && (debitText || creditText)) {
        amountCents = credit - debit;
      } else {
        addIssue("invalid-debit-credit", "Use nonnegative debit/credit values with only one nonzero side.", "amount");
      }
    }
    if (amountCents === null) addIssue("invalid-amount", "Amount is missing, malformed, or outside safe integer cents.", "amount");
    if (globalIssues.some((issue) => ["amount-mapping", "sign-convention"].includes(issue.code))) amountCents = null;
    const sourceCurrency = mapping.currency ? cell(mapping.currency) : options.currency ?? "CAD";
    const rawCurrency = sourceCurrency.toUpperCase();
    const currency = currencies.includes(rawCurrency) ? rawCurrency as Currency : options.currency ?? "CAD";
    let originalCurrency: string | undefined;
    if (!currencies.includes(rawCurrency)) {
      originalCurrency = sourceCurrency;
      addIssue("invalid-currency", "Currency must be CAD, USD, EUR, or GBP; explicitly replace the original currency before confirming.", "currency");
    }
    const amountFields = mapping.amount ? [mapping.amount] : [mapping.debit, mapping.credit];
    for (const field of amountFields) {
      const value = cell(field);
      const embeddedCodes = [...new Set([...moneyParts(value).currencyCodes, ...value.match(/(?<![A-Za-z])[A-Za-z]{3}(?![A-Za-z])/g) ?? []])];
      const unsupportedCodes = embeddedCodes.filter((code) => !currencies.includes(code.toUpperCase()));
      if (unsupportedCodes.length) {
        originalCurrency ??= unsupportedCodes.join(", ");
        addIssue("invalid-currency", `Amount contains unsupported currency: ${unsupportedCodes.join(", ")}.`, "currency");
      }
      const conflictingCode = embeddedCodes.some((code) => currencies.includes(code.toUpperCase()) && code.toUpperCase() !== currency);
      const conflictingSymbol = (value.includes("€") && currency !== "EUR") ||
        (value.includes("£") && currency !== "GBP") ||
        (value.includes("$") && currency !== "CAD" && currency !== "USD");
      if (conflictingCode || conflictingSymbol) {
        addIssue("currency-conflict", `Amount currency conflicts with ${currency}; verify the original currency before confirming.`, "currency");
      }
    }
    const rawType = cell(mapping.type).toLowerCase();
    let type: TransactionType = amountCents !== null && amountCents > 0 ? "income" : "expense";
    if (transactionTypes.includes(rawType)) type = rawType as TransactionType;
    else if (rawType) addIssue("invalid-type", "Type must be expense, income, refund, or transfer.", "type");
    if (!rawType && /\b(refund|reversal|transfer|e-?transfer)\b/i.test(description)) {
      addIssue("review-type", "Description may indicate a refund or transfer; review the transaction type.", "type");
    }
    if (amountCents !== null && ((type === "expense" && amountCents > 0) || ((type === "income" || type === "refund") && amountCents < 0))) {
      addIssue("type-sign-mismatch", "Transaction type conflicts with its signed amount.", "type");
    }
    const category = cell(mapping.category) || null;
    if (category !== null && !DEFAULT_CONFIG.categories.includes(category)) {
      addIssue("invalid-category", "Category must be a listed category or empty; review the original value.", "category");
    }
    const suggestedCategory = category ? null : suggestCategory(description, type);
    if (suggestedCategory) addIssue("category-suggestion", "Suggested category requires your review before accepting.", "category");
    return {
      id: `${importId}-row-${record.row}-${index + 1}`,
      date, description, amountCents, currency, originalCurrency, type, category, suggestedCategory,
      needsReview: issues.length > 0, issues, duplicateOf: null,
      sourceText: record.sourceText, row: record.row, fileName: options.fileName ?? null,
    };
  });
  return { transactions: flagDuplicates(transactions), issues: globalIssues };
}

export function importCsv(text: string, mapping: Mapping, options: ImportOptions = {}): ImportResult {
  return normalizeRows(parseCsv(text), mapping, options);
}

export function transactionFingerprint(transaction: Pick<Transaction, "date" | "description" | "amountCents" | "currency" | "type">): string {
  return JSON.stringify([transaction.date, transaction.description.trim().toLowerCase().replace(/\s+/g, " "), transaction.amountCents, transaction.currency, transaction.type]);
}

export function flagDuplicates(transactions: readonly Transaction[]): Transaction[] {
  const seen = new Map<string, string>();
  return transactions.map((transaction) => {
    const issues = transaction.issues.filter((issue) => issue.code !== "possible-duplicate");
    let duplicateOf: string | null = null;
    if (transaction.date && transaction.amountCents !== null && transaction.description.trim()) {
      const key = transactionFingerprint(transaction);
      duplicateOf = seen.get(key) ?? null;
      if (duplicateOf) issues.push({ code: "possible-duplicate", message: "Possible duplicate retained for review.", row: transaction.row });
      else seen.set(key, transaction.id);
    }
    return { ...transaction, duplicateOf, issues, needsReview: transaction.needsReview || issues.length > 0 };
  });
}

export function reconcileDuplicates(transactions: readonly Transaction[]): Transaction[] {
  return flagDuplicates(transactions).map((transaction, index) => {
    const original = transactions[index];
    const acknowledged = !original.needsReview && transaction.duplicateOf !== null &&
      original.duplicateOf === transaction.duplicateOf &&
      original.duplicateAcknowledgedFingerprint === transactionFingerprint(transaction);
    if (!acknowledged) return { ...transaction, duplicateAcknowledgedFingerprint: undefined };
    const issues = transaction.issues.filter((issue) => issue.code !== "possible-duplicate");
    return { ...transaction, issues, needsReview: issues.length > 0 };
  });
}

function safeSpreadsheetText(value: string): string {
  return /^[\s\u0000-\u001f]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
}

const exportHeaders = ["Date", "Description", "Amount", "Currency", "Type", "Category", "Suggested category (review required)", "Needs review", "Issues", "Duplicate of", "Source row", "Source file", "Source text", "Note", "Original currency"];

function exportRows(transactions: readonly Transaction[]): Array<Array<string | number>> {
  return transactions.map((transaction) => [
    transaction.date ?? "", safeSpreadsheetText(transaction.description),
    transaction.amountCents === null ? "" : transaction.amountCents / 100,
    transaction.currency, transaction.type, safeSpreadsheetText(transaction.category ?? ""),
    safeSpreadsheetText(transaction.suggestedCategory ?? ""), transaction.needsReview ? "Yes" : "No",
    safeSpreadsheetText(transaction.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")),
    safeSpreadsheetText(transaction.duplicateOf ?? ""), transaction.row,
    safeSpreadsheetText(transaction.fileName ?? ""), safeSpreadsheetText(transaction.sourceText),
    safeSpreadsheetText(transaction.note ?? ""),
    safeSpreadsheetText(transaction.originalCurrency ?? ""),
  ]);
}

export function exportCsv(transactions: readonly Transaction[]): string {
  const rows = exportRows(transactions).map((row, index) => {
    const cents = transactions[index].amountCents;
    if (cents !== null) row[2] = formatCents(cents);
    return row;
  });
  return Papa.unparse({ fields: exportHeaders, data: rows }, { newline: "\r\n" });
}

export async function exportXlsx(transactions: readonly Transaction[]): Promise<Uint8Array> {
  if (transactions.some(({ amountCents }) => amountCents !== null && (!Number.isSafeInteger(amountCents) || Math.abs(amountCents) > 99999999999999))) {
    throw new Error("XLSX export supports amounts up to 99,999,999,999,999 cents in either direction to preserve cent precision. Use CSV for larger amounts; CSV preserves exact integer cents.");
  }
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  const worksheet = workbook.addWorksheet("Transactions");
  worksheet.addRow(exportHeaders);
  worksheet.addRows(exportRows(transactions));
  worksheet.getColumn(3).numFmt = "0.00";
  worksheet.getRow(1).font = { bold: true };
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
