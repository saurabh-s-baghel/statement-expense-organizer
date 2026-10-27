'use client';

import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

export function Modal({ title, subtitle, children, onClose }: { title: string; subtitle?: string; children: React.ReactNode; onClose: () => void }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, []);
  return <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} tabIndex={-1} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    if (event.key !== 'Tab') return;
    const elements = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]');
    if (!elements?.length) { event.preventDefault(); return; }
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus(); }
  }}><div className="modal-header"><div><h2 id={titleId}>{title}</h2>{subtitle && <p className="subtitle">{subtitle}</p>}</div><button className="ghost" aria-label="Close dialog" onClick={onClose}><X /></button></div>{children}</div></div>;
}
