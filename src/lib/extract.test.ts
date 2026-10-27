import { describe, expect, it } from 'vitest';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { documentKind, extractDocument, EXTRACTION_LIMITS, pdfTextLines } from './extract';

function item(str: string, horizontal: number, vertical: number, width = str.length * 5, height = 10): TextItem {
  return { str, dir: 'ltr', width, height, transform: [1, 0, 0, 1, horizontal, vertical], fontName: 'synthetic', hasEOL: false };
}

describe('document validation', () => {
  it.each([
    ['synthetic.pdf', 'application/pdf', 'pdf'],
    ['synthetic.PDF', '', 'pdf'],
    ['synthetic.png', 'image/png', 'image'],
    ['synthetic.JPEG', '', 'image'],
    ['synthetic.webp', 'image/webp', 'image'],
    ['synthetic.bmp', 'image/bmp', 'image'],
  ])('accepts %s', (name, type, expected) => {
    expect(documentKind(new File(['synthetic test content'], name, { type }))).toBe(expected);
  });

  it('rejects empty, oversized, and unsupported synthetic inputs', () => {
    expect(() => documentKind(new File([], 'synthetic.pdf'))).toThrow(/empty/);
    expect(() => documentKind(new File(['synthetic'], 'synthetic.heic', { type: 'image/heic' }))).toThrow(/Choose a PDF/);
    const oversized = new File(['synthetic'], 'synthetic.pdf');
    Object.defineProperty(oversized, 'size', { value: EXTRACTION_LIMITS.bytes + 1 });
    expect(() => documentKind(oversized)).toThrow(/20 MB/);
  });

  it('aborts before loading any document assets', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(extractDocument(new File(['synthetic'], 'synthetic.pdf'), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('PDF positional text reconstruction', () => {
  it('sorts rows top to bottom and columns left to right without mutating input', () => {
    const items = [item('-86.42', 200, 100), item('Synthetic Market', 10, 100), item('SYNTHETIC STATEMENT', 10, 150)];
    const original = [...items];
    expect(pdfTextLines(items)).toEqual(['SYNTHETIC STATEMENT', 'Synthetic Market\t-86.42']);
    expect(items).toEqual(original);
  });

  it('joins nearby fragments, preserves signs and decimal points, and separates words', () => {
    expect(pdfTextLines([item('-', 0, 100), item('86', 5, 100), item('.', 15, 100), item('42', 20, 100), item('CAD', 34, 100)])).toEqual(['-86.42 CAD']);
  });

  it('groups small baseline variations but retains distinct transaction rows', () => {
    expect(pdfTextLines([item('Synthetic', 0, 100), item('Market', 50, 98), item('Refund +12.50', 0, 85), item('  ', 0, 200)])).toEqual(['Synthetic Market', 'Refund +12.50']);
    expect(pdfTextLines([])).toEqual([]);
  });
});
