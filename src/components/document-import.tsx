"use client";

import { useEffect, useId, useRef, useState } from "react";
import { documentKind, extractDocument, imageCanvas, type Crop, type ExtractionProgress, type ExtractionResult } from "@/lib/extract";

export type DocumentImportProps = {
  file: File;
  onText: (text: string, provenance: string) => void;
  onCancel: () => void;
};

export function DocumentImport({ file, onText, onCancel }: DocumentImportProps) {
  const [source, setSource] = useState({ file, version: 0 });
  if (source.file !== file) setSource({ file, version: source.version + 1 });
  return <DocumentImportSession key={source.version} file={file} onText={onText} onCancel={onCancel} />;
}

function DocumentImportSession({ file, onText, onCancel }: DocumentImportProps) {
  const id = useId();
  const preview = useRef<HTMLCanvasElement>(null);
  const operation = useRef<AbortController | null>(null);
  const [rotation, setRotation] = useState(0);
  const [cropEnabled, setCropEnabled] = useState(false);
  const [crop, setCrop] = useState<Crop>({ left: 0, top: 0, width: 100, height: 100 });
  const [forceOcr, setForceOcr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState<ExtractionProgress | null>(null);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [text, setText] = useState("");
  const [reviewed, setReviewed] = useState(false);
  let kind: "pdf" | "image" | undefined;
  let validation = "";
  try { kind = documentKind(file); } catch (cause) { validation = cause instanceof Error ? cause.message : "Unsupported file."; }

  useEffect(() => {
    return () => { operation.current?.abort(); operation.current = null; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    if (kind === "image") {
      void imageCanvas(file, controller.signal, rotation, cropEnabled ? crop : undefined).then((canvas) => {
        if (controller.signal.aborted) { canvas.width = canvas.height = 0; return; }
        setPreviewError("");
        const target = preview.current;
        if (target) {
          target.width = canvas.width;
          target.height = canvas.height;
          target.getContext("2d")?.drawImage(canvas, 0, 0);
        }
        canvas.width = canvas.height = 0;
      }).catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          if (preview.current) preview.current.width = preview.current.height = 0;
          setPreviewError(cause instanceof Error ? cause.message : "Could not preview this image.");
        }
      });
    }
    return () => controller.abort();
  }, [file, kind, rotation, cropEnabled, crop]);

  function clearResult() {
    setResult(null);
    setText("");
    setReviewed(false);
  }

  async function start() {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    setProgress(null);
    clearResult();
    try {
      const extracted = await extractDocument(file, {
        signal: controller.signal, rotation, crop: cropEnabled ? crop : undefined, forceOcr,
        onProgress: (next) => { if (operation.current === controller) setProgress(next); },
      });
      if (operation.current !== controller || controller.signal.aborted) return;
      setResult(extracted);
      setText(extracted.text);
    } catch (cause) {
      if (operation.current === controller && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Extraction failed. Try again or paste CSV instead.");
    } finally {
      if (operation.current === controller) { operation.current = null; setBusy(false); }
    }
  }

  function cancelProcessing() {
    operation.current?.abort();
    operation.current = null;
    setBusy(false);
    setProgress(null);
    setNotice("Extraction cancelled. You can adjust the file and retry.");
  }

  return (
    <section className="panel" aria-labelledby={`${id}-title`} style={{ display: "grid", gap: 16, minWidth: 0 }}>
      <h2 id={`${id}-title`}>Review document text</h2>
      <p style={{ overflowWrap: "anywhere" }}>{file.name}</p>
      <p className="muted">Files are processed in this browser using local PDF and English OCR assets. Maximum 20 MB, 10 PDF pages, and 16 million pixels per image. OCR can misread dates, decimal points, and signs.</p>
      <p>Extracting text never creates transactions. Correct the text manually, then use explicit column mapping or paste CSV in the import flow. Unknown statement layouts require manual correction.</p>
      {validation && <p className="alert" role="alert">{validation}</p>}
      {kind === "image" && <>
        <fieldset disabled={busy} style={{ display: "grid", gap: 12 }}>
          <legend>Image preparation</legend>
          <button className="button secondary" type="button" onClick={() => { setRotation((value) => (value + 90) % 360); clearResult(); }}>Rotate clockwise ({rotation}°)</button>
          <label><input type="checkbox" checked={cropEnabled} onChange={(event) => { setCropEnabled(event.target.checked); clearResult(); }} /> Crop image</label>
          {cropEnabled && <>
            <p className="muted">Percentages refer to the rotated image. The preview shows the cropped area.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
              {(["left", "top", "width", "height"] as const).map((key) => <label key={key} htmlFor={`${id}-${key}`}>
                {key.charAt(0).toUpperCase() + key.slice(1)} (%)
                <input id={`${id}-${key}`} className="field" type="number" min={key === "width" || key === "height" ? 1 : 0} max={100} value={Number.isNaN(crop[key]) ? "" : crop[key]} onChange={(event) => { setCrop((previous) => ({ ...previous, [key]: event.target.valueAsNumber })); clearResult(); }} />
              </label>)}
            </div>
          </>}
        </fieldset>
        <canvas ref={preview} role="img" aria-label={`Image preview, rotated ${rotation} degrees${cropEnabled ? ", cropped" : ""}`} style={{ display: previewError ? "none" : "block", maxWidth: "100%", maxHeight: 480, width: "auto", height: "auto", objectFit: "contain", justifySelf: "center" }} />
        {previewError && <p className="alert" role="alert">{previewError}</p>}
      </>}
      {kind === "pdf" && <label><input type="checkbox" checked={forceOcr} disabled={busy} onChange={(event) => { setForceOcr(event.target.checked); clearResult(); }} /> OCR every page (use for incomplete or garbled PDF text layers)</label>}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button className="button" type="button" disabled={busy || !!validation || !!previewError} onClick={() => void start()}>{busy ? "Extracting…" : result || error ? "Extract again" : "Extract text"}</button>
        {busy && <button className="button secondary" type="button" onClick={cancelProcessing}>Stop extraction</button>}
        <button className="button secondary" type="button" onClick={() => { cancelProcessing(); onCancel(); }}>Cancel import</button>
      </div>
      <div role="status" aria-live="polite" aria-atomic="true">
        {busy && progress && <><p>Page {progress.page} of {progress.pages}: {progress.status}</p><progress aria-label="Current page progress" max={1} value={progress.fraction} /></>}
        {notice && <p>{notice}</p>}
        {result && <p>Extracted {result.pages.length} page(s). Review every line before continuing.</p>}
      </div>
      {error && <p className="alert" role="alert">{error} No transactions were created. Retry, choose another file, or use manual CSV paste and mapping.</p>}
      {result && <>
        <p className="muted" style={{ overflowWrap: "anywhere" }}>{result.provenance}</p>
        {result.pages.some((page) => !page.lines.length) && <p className="alert" role="alert">Some pages contain no readable text. Check the original and add missing rows manually.</p>}
        <label htmlFor={`${id}-text`}>Extracted text — editable, with page and line references</label>
        <textarea id={`${id}-text`} className="field" rows={16} value={text} onChange={(event) => { setText(event.target.value); setReviewed(false); }} spellCheck={false} style={{ width: "100%", boxSizing: "border-box", fontFamily: "monospace" }} />
        <label><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /> I checked this text against the original, including dates, amounts, signs, and missing lines.</label>
        <button className="button" type="button" disabled={!reviewed || !text.trim()} onClick={() => onText(text !== result.text ? `Original extraction:\n${result.text}\n\nUser-corrected text:\n${text}` : text, `${result.provenance}; user confirmed review${text !== result.text ? "; manually edited" : ""}`)}>Use reviewed text for manual mapping</button>
      </>}
    </section>
  );
}
