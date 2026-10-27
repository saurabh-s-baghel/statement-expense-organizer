"use client";

import type { PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import type { Page as OcrPage } from "tesseract.js";

export const EXTRACTION_LIMITS = { bytes: 20 * 1024 * 1024, pages: 10, pixels: 16_000_000 };
export type Crop = { left: number; top: number; width: number; height: number };
export type ExtractionProgress = { page: number; pages: number; fraction: number; status: string };
export type ExtractedPage = { page: number; method: "pdf-text" | "ocr"; lines: string[]; confidence?: number };
export type ExtractionResult = { text: string; provenance: string; pages: ExtractedPage[] };
export type ExtractionOptions = {
  signal: AbortSignal;
  rotation?: number;
  crop?: Crop;
  forceOcr?: boolean;
  onProgress?: (progress: ExtractionProgress) => void;
};

export function documentKind(file: File): "pdf" | "image" {
  if (!file.size) throw new Error("This file is empty. Choose a PDF or image with content.");
  if (file.size > EXTRACTION_LIMITS.bytes) throw new Error("Choose a file no larger than 20 MB.");
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
  if (/^image\/(png|jpeg|webp|bmp)$/.test(file.type) || /\.(png|jpe?g|webp|bmp)$/i.test(file.name)) return "image";
  throw new Error("Choose a PDF, PNG, JPEG, WebP, or BMP file. Convert other formats first.");
}

function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Extraction cancelled", "AbortError");
}

function cancellable<Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Extraction cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

type OcrReply = { jobId: string; status: "progress" | "resolve" | "reject"; data: unknown };

function ocrJob<Value>(worker: Worker, action: string, payload: object, signal: AbortSignal, progress: (status: string, fraction: number) => void): Promise<Value> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const jobId = crypto.randomUUID();
    const clean = () => {
      clearTimeout(timeout);
      worker.removeEventListener("message", receive);
      worker.removeEventListener("error", failure);
      worker.removeEventListener("messageerror", failure);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => { clean(); reject(new DOMException("Extraction cancelled", "AbortError")); };
    const failure = () => { clean(); reject(new Error("Local OCR failed. Check the vendor worker, core, and English language assets, then retry.")); };
    const receive = (event: MessageEvent<OcrReply>) => {
      if (event.data.jobId !== jobId) return;
      if (event.data.status === "progress") {
        const update = event.data.data as { status: string; progress: number };
        progress(update.status, update.progress);
      } else {
        clean();
        if (event.data.status === "resolve") resolve(event.data.data as Value);
        else reject(new Error("OCR could not process this page. Check local assets or try a sharper, smaller image."));
      }
    };
    const timeout = setTimeout(() => { clean(); reject(new Error("OCR timed out after 120 seconds. Try a smaller image or split the document.")); }, 120_000);
    worker.addEventListener("message", receive);
    worker.addEventListener("error", failure);
    worker.addEventListener("messageerror", failure);
    signal.addEventListener("abort", abort, { once: true });
    try { worker.postMessage({ workerId: "document-import", jobId, action, payload }); }
    catch { failure(); }
  });
}

export function pdfTextLines(items: readonly TextItem[]): string[] {
  const rows: { y: number; height: number; items: TextItem[] }[] = [];
  for (const item of [...items].sort((first, second) => second.transform[5] - first.transform[5] || first.transform[4] - second.transform[4])) {
    if (!item.str.trim()) continue;
    const height = Math.max(1, Math.abs(item.height));
    const row = rows.find((candidate) => Math.abs(candidate.y - item.transform[5]) <= Math.max(1, Math.min(candidate.height, height) * 0.35));
    if (row) row.items.push(item);
    else rows.push({ y: item.transform[5], height, items: [item] });
  }
  return rows.map((row) => {
    const ordered = row.items.sort((first, second) => first.transform[4] - second.transform[4]);
    return ordered.map((item, index) => {
      if (!index) return item.str;
      const previous = ordered[index - 1];
      const gap = item.transform[4] - previous.transform[4] - previous.width;
      const characterWidth = Math.max(1, previous.width / Math.max(1, previous.str.length));
      const separator = gap > characterWidth * 2 ? "\t" : gap > characterWidth * 0.2 && !/\s$/.test(previous.str) && !/^\s/.test(item.str) ? " " : "";
      return separator + item.str;
    }).join("").trim();
  }).filter(Boolean);
}

export async function imageCanvas(file: File, signal: AbortSignal, rotation = 0, crop?: Crop): Promise<HTMLCanvasElement> {
  checkAbort(signal);
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await cancellable(image.decode(), signal);
    const angle = ((rotation % 360) + 360) % 360;
    if (![0, 90, 180, 270].includes(angle)) throw new Error("Use rotation in 90 degree steps.");
    const width = angle % 180 ? image.naturalHeight : image.naturalWidth;
    const height = angle % 180 ? image.naturalWidth : image.naturalHeight;
    if (!width || !height || width * height > EXTRACTION_LIMITS.pixels) throw new Error("Image exceeds 16 million pixels. Resize it before importing.");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not create an image canvas.");
    context.fillStyle = "white";
    context.fillRect(0, 0, width, height);
    context.translate(width / 2, height / 2);
    context.rotate(angle * Math.PI / 180);
    context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
    if (!crop) return canvas;
    if (![crop.left, crop.top, crop.width, crop.height].every(Number.isFinite) || crop.left < 0 || crop.top < 0 || crop.width <= 0 || crop.height <= 0 || crop.left + crop.width > 100 || crop.top + crop.height > 100) {
      canvas.width = canvas.height = 0;
      throw new Error("Crop percentages must describe a positive rectangle inside the rotated image.");
    }
    const cropped = document.createElement("canvas");
    cropped.width = Math.max(1, Math.round(width * crop.width / 100));
    cropped.height = Math.max(1, Math.round(height * crop.height / 100));
    const croppedContext = cropped.getContext("2d");
    if (!croppedContext) throw new Error("Your browser could not create a crop canvas.");
    croppedContext.drawImage(canvas, width * crop.left / 100, height * crop.top / 100, width * crop.width / 100, height * crop.height / 100, 0, 0, cropped.width, cropped.height);
    canvas.width = canvas.height = 0;
    return cropped;
  } finally {
    image.src = "";
    URL.revokeObjectURL(url);
  }
}

export async function extractDocument(file: File, options: ExtractionOptions): Promise<ExtractionResult> {
  const { signal } = options;
  checkAbort(signal);
  const kind = documentKind(file);
  let loading: PDFDocumentLoadingTask | undefined;
  let rendering: RenderTask | undefined;
  let worker: Worker | undefined;
  let pageNumber = 1;
  let pageCount = 1;
  const pages: ExtractedPage[] = [];
  const progress = (status: string, fraction = 0) => {
    if (!signal.aborted) options.onProgress?.({ page: pageNumber, pages: pageCount, fraction: Math.max(0, Math.min(1, fraction)), status });
  };
  const stop = () => {
    rendering?.cancel();
    if (loading) void loading.destroy().catch(() => {});
    worker?.terminate();
  };
  signal.addEventListener("abort", stop, { once: true });
  const recognize = async (canvas: HTMLCanvasElement): Promise<ExtractedPage> => {
    try {
      if (!worker) {
        progress("Loading local English OCR assets");
        worker = new Worker("/vendor/worker.min.js");
        await ocrJob(worker, "load", { options: { lstmOnly: true, corePath: new URL("/vendor/tesseract-core/", location.origin).href, logging: false } }, signal, progress);
        await ocrJob(worker, "loadLanguage", { langs: "eng", options: { langPath: new URL("/vendor/lang/", location.origin).href, gzip: true, cacheMethod: "none", lstmOnly: true } }, signal, progress);
        await ocrJob(worker, "initialize", { langs: "eng", oem: 1, config: {} }, signal, progress);
        await ocrJob(worker, "setParameters", { params: { preserve_interword_spaces: "1" } }, signal, progress);
      }
      checkAbort(signal);
      progress("Recognizing text; verify every amount and date");
      const blob = await cancellable(new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not prepare image for OCR.")), "image/png")), signal);
      const image = new Uint8Array(await cancellable(blob.arrayBuffer(), signal));
      const result = await ocrJob<OcrPage>(worker, "recognize", { image, options: {}, output: { text: true } }, signal, progress);
      return { page: pageNumber, method: "ocr", confidence: result.confidence, lines: result.text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd()).filter((line) => line.trim()) };
    } finally {
      canvas.width = canvas.height = 0;
    }
  };
  try {
    if (kind === "image") {
      pages.push(await recognize(await imageCanvas(file, signal, options.rotation, options.crop)));
    } else {
      progress("Opening PDF locally");
      const pdfjs = await cancellable(import("pdfjs-dist"), signal);
      pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs";
      const data = new Uint8Array(await cancellable(file.arrayBuffer(), signal));
      loading = pdfjs.getDocument({ data, useSystemFonts: true });
      const pdf = await cancellable(loading.promise, signal);
      pageCount = pdf.numPages;
      if (pageCount > EXTRACTION_LIMITS.pages) throw new Error("PDF exceeds the 10-page limit. Split it into smaller documents and retry.");
      for (pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
        checkAbort(signal);
        progress("Reading PDF text positions");
        const page = await cancellable(pdf.getPage(pageNumber), signal);
        try {
          const content = await cancellable(page.getTextContent(), signal);
          const lines = pdfTextLines(content.items.filter((item): item is TextItem => "str" in item));
          if (lines.length && !options.forceOcr) pages.push({ page: pageNumber, method: "pdf-text", lines });
          else {
            progress("Rendering scanned page for OCR");
            const base = page.getViewport({ scale: 1 });
            const scale = Math.min(2, Math.sqrt(EXTRACTION_LIMITS.pixels / (base.width * base.height)));
            const viewport = page.getViewport({ scale });
            if (!Number.isFinite(viewport.width * viewport.height) || viewport.width <= 0 || viewport.height <= 0) throw new Error("PDF page has invalid dimensions.");
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.floor(viewport.width));
            canvas.height = Math.max(1, Math.floor(viewport.height));
            try {
              rendering = page.render({ canvas, viewport });
              await cancellable(rendering.promise, signal);
              rendering = undefined;
              pages.push(await recognize(canvas));
            } finally {
              canvas.width = canvas.height = 0;
            }
          }
        } finally {
          page.cleanup();
        }
      }
    }
    checkAbort(signal);
    if (!pages.some((page) => page.lines.length)) throw new Error("No readable text found. Try a sharper image, rotate/crop it, or paste CSV for explicit column mapping.");
    const text = pages.map((page) => `[Page ${page.page} | ${page.method === "ocr" ? "OCR — verify" : "PDF text"}]\n${page.lines.map((line, index) => `[P${page.page}:L${index + 1}] ${line}`).join("\n") || "[No readable lines — review this page manually]"}`).join("\n\n");
    const provenance = `${file.name}; ${pages.length} page(s); ${pages.map((page) => `page ${page.page}: ${page.method}${page.confidence === undefined ? "" : ` (${Math.round(page.confidence)}% OCR confidence)`}`).join("; ")}${kind === "image" ? `; rotation ${options.rotation ?? 0}°${options.crop ? `; crop ${JSON.stringify(options.crop)}%` : ""}` : ""}; manually reviewed source required`;
    pageNumber = pageCount;
    progress("Extraction complete; review before continuing", 1);
    return { text, provenance, pages };
  } catch (error) {
    checkAbort(signal);
    if (error instanceof Error && error.name === "PasswordException") throw new Error("This PDF is password protected. Export an unlocked copy locally and retry.");
    throw error;
  } finally {
    signal.removeEventListener("abort", stop);
    rendering?.cancel();
    worker?.terminate();
    if (loading) await loading.destroy().catch(() => {});
  }
}
