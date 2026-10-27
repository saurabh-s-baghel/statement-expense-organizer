import { cp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.join(process.cwd(), 'public/vendor');
await mkdir(root, { recursive: true });
await cp(require.resolve('pdfjs-dist/build/pdf.worker.min.mjs'), path.join(root, 'pdf.worker.min.mjs'));
await cp(require.resolve('tesseract.js/dist/worker.min.js'), path.join(root, 'worker.min.js'));
await cp(path.dirname(require.resolve('tesseract.js-core/package.json')), path.join(root, 'tesseract-core'), { recursive: true });
const languageRoot = path.dirname(require.resolve('@tesseract.js-data/eng/package.json'));
await mkdir(path.join(root, 'lang'), { recursive: true });
await cp(path.join(languageRoot, '4.0.0/eng.traineddata.gz'), path.join(root, 'lang/eng.traineddata.gz'));
