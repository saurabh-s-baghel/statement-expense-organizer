import type { Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';

export const syntheticLines = [
  'SYNTHETIC STATEMENT - TEST DATA ONLY',
  '2026-10-24 Synthetic Market -86.42',
  '2026-10-25 Synthetic Refund +12.50',
];

function pdf(objects: Buffer[]): Buffer {
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.concat(chunks).length);
    chunks.push(Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n'));
  }
  const start = Buffer.concat(chunks).length;
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

function stream(data: Buffer, properties = ''): Buffer {
  return Buffer.concat([Buffer.from(`<< /Length ${data.length} ${properties} >>\nstream\n`), data, Buffer.from('\nendstream')]);
}

export function syntheticTextPdf(): Buffer {
  const content = Buffer.from(`BT /F1 18 Tf 40 300 Td ${syntheticLines.map((line, index) => `${index ? '0 -48 Td ' : ''}(${line}) Tj`).join('\n')} ET`);
  return pdf([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 350] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    stream(content),
  ]);
}

export async function syntheticImageFixtures(page: Page) {
  const image = await page.evaluate((lines) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1400;
    canvas.height = 700;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#d6d8d7';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#fffefa';
    context.fillRect(24, 24, 1352, 652);
    context.fillStyle = '#111111';
    context.font = '36px Arial';
    lines.forEach((line, index) => context.fillText(line, 80, 140 + index * 96));
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const rgb = new Uint8Array(canvas.width * canvas.height * 3);
    for (let pixel = 0; pixel < rgba.length / 4; pixel++) {
      rgb.set(rgba.subarray(pixel * 4, pixel * 4 + 3), pixel * 3);
    }
    let binary = '';
    for (let offset = 0; offset < rgb.length; offset += 8192) {
      binary += String.fromCharCode(...rgb.subarray(offset, offset + 8192));
    }
    return { png: canvas.toDataURL('image/png').split(',')[1], rgb: btoa(binary) };
  }, syntheticLines);
  const scanned = pdf([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 350] /Resources << /XObject << /Scan 4 0 R >> >> /Contents 5 0 R >>'),
    stream(deflateSync(Buffer.from(image.rgb, 'base64')), '/Type /XObject /Subtype /Image /Width 1400 /Height 700 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode'),
    stream(Buffer.from('q 700 0 0 350 0 0 cm /Scan Do Q')),
  ]);
  return { photo: Buffer.from(image.png, 'base64'), scanned };
}
