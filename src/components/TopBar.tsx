'use client';

import { useEffect, useRef, useState } from 'react';

import type { Filter } from '@/lib/bulk';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'needs', label: 'Needs picture' },
  { id: 'unchosen', label: 'No choice yet' },
  { id: 'all', label: 'All' },
];

export function TopBar(props: {
  filter: Filter;
  onFilter: (filter: Filter) => void;
  chosen: number;
  total: number;
  /** Counts over every imported word, for the export menu. */
  exportAll: number;
  exportChanged: number;
  hasWords: boolean;
  canGenerate: boolean;
  emptySlots: number;
  running: boolean;
  /** Pictures still to make in the current run. */
  left: number;
  importing: boolean;
  onImport: (file: File) => void;
  onExport: (scope: 'all' | 'changed') => void;
  onGenerateAll: () => void;
  onStop: () => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  // The export menu closes on a tap anywhere else and on Escape.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!menu.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [open]);

  return (
    <header className="topbar">
      <div className="bar-row">
        <strong className="brand">Bulk image generator</strong>
        <div className="grow" />
        <input
          ref={file}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(e) => {
            const picked = e.target.files?.[0];
            e.target.value = '';
            if (picked) props.onImport(picked);
          }}
        />
        <button type="button" className="btn" disabled={props.importing || props.running} onClick={() => file.current?.click()}>
          {props.importing ? 'Importing…' : 'Import words'}
        </button>
        <div className="menu-wrap" ref={menu}>
          <button type="button" className="btn primary" disabled={!props.exportAll} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            Export zip
          </button>
          {open && (
            <div className="menu" role="menu">
              <button type="button" role="menuitem" className="menu-item" onClick={() => { setOpen(false); props.onExport('all'); }}>
                All chosen pictures ({props.exportAll})
              </button>
              <button type="button" role="menuitem" className="menu-item" disabled={!props.exportChanged} onClick={() => { setOpen(false); props.onExport('changed'); }}>
                Changed since last export ({props.exportChanged})
              </button>
            </div>
          )}
        </div>
      </div>
      {props.hasWords && (
        <div className="bar-row">
          <div className="filters" role="group" aria-label="Which words to show">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" className={`chip ${props.filter === f.id ? 'on' : ''}`} aria-pressed={props.filter === f.id} onClick={() => props.onFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <span className="progress" aria-live="polite">{props.chosen} of {props.total}<span className="wide"> chosen</span></span>
          <div className="grow" />
          {props.running ? (
            <button type="button" className="btn danger" onClick={props.onStop}>Stop ({props.left}<span className="wide"> left</span>)</button>
          ) : (
            <button type="button" className="btn" disabled={!props.canGenerate || !props.emptySlots} onClick={props.onGenerateAll}>
              Generate all<span className="wide"> missing</span>
            </button>
          )}
        </div>
      )}
    </header>
  );
}
