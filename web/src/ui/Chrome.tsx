import { useEffect, useRef, useState } from 'react';
import {
  Menu, Sun, Moon, Undo2, Redo2, ZoomIn, ZoomOut, Scan, Download, Upload, ImageDown, Trash2, Keyboard, Grid3x3, MessageSquare, Eye, FilePlus,
} from 'lucide-react';
import { store, useStore, toast } from '../store';
import { E } from '../engineRef';
import { renderToCanvas } from '../render/renderer';
import { clearRenderCache } from '../render/renderer';

export function Brand() {
  const [open, setOpen] = useState(false);
  const theme = useStore((s) => s.theme);
  const grid = useStore((s) => s.gridSnap);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const exportPng = () => {
    const s = store.get();
    if (!s.elements.length) return toast('Nothing to export yet');
    const c = renderToCanvas(s.elements, s.theme, { scale: 2 });
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = `system-design-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
  };
  const saveJson = () => {
    const blob = new Blob([JSON.stringify({ type: 'sysdesign-board', version: 1, elements: store.get().elements }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `system-design-${new Date().toISOString().slice(0, 10)}.sdboard.json`;
    a.click();
  };
  const loadJson = async (f: File) => {
    try {
      const d = JSON.parse(await f.text());
      if (!Array.isArray(d.elements)) throw new Error();
      E.current?.loadElements(d.elements);
      E.current?.commit();
      setTimeout(() => E.current?.fit(), 0);
    } catch {
      toast('That file is not a board');
    }
  };
  const item = (icon: any, label: string, fn: () => void, hint?: string, cls?: string) => {
    const I = icon;
    return (
      <button className={cls} onClick={() => { setOpen(false); fn(); }}>
        <I size={16} /> {label} {hint && <span className="hint">{hint}</span>}
      </button>
    );
  };

  return (
    <>
      <div className="float brand" onPointerDown={(e) => e.stopPropagation()}>
        <button className={`icon-btn ${open ? 'active' : ''}`} onClick={() => setOpen(!open)} title="Menu">
          <Menu size={18} />
        </button>
        <div className="logo">
          sketch<em>/</em>design
        </div>
      </div>
      {open && (
        <div className="float menu" onPointerDown={(e) => e.stopPropagation()}>
          {item(FilePlus, 'New board', () => {
            if (store.get().elements.length && !confirm('Clear the board? You can undo this.')) return;
            E.current?.clearAll();
          })}
          {item(Upload, 'Open…', () => fileRef.current?.click())}
          {item(Download, 'Save to file', saveJson)}
          {item(ImageDown, 'Export PNG', exportPng)}
          <hr />
          {item(theme === 'light' ? Moon : Sun, theme === 'light' ? 'Chalkboard mode' : 'Paper mode', () => {
            clearRenderCache();
            store.set({ theme: theme === 'light' ? 'dark' : 'light' });
          })}
          {item(Grid3x3, `Snap to grid: ${grid ? 'on' : 'off'}`, () => store.set({ gridSnap: !grid }), 'G')}
          {item(Keyboard, 'Keyboard shortcuts', () => store.set({ helpOpen: true }), '?')}
          <hr />
          {item(Trash2, 'Clear board', () => E.current?.clearAll(), undefined, 'danger')}
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadJson(f);
          e.target.value = '';
        }}
      />
    </>
  );
}

export function TopRight() {
  const panel = useStore((s) => s.panelOpen);
  const aiActive = useStore((s) => s.aiActive);
  const conn = useStore((s) => s.connection);
  const unread = useStore((s) => s.messages.length);
  if (panel) return null;
  return (
    <div className="topright" onPointerDown={(e) => e.stopPropagation()}>
      <button className="pill" style={{ cursor: 'pointer' }} onClick={() => store.set({ panelOpen: true })} title="Show interview panel (I)">
        <span className={`dot ${conn === 'online' ? (aiActive ? 'ai' : 'on') : ''}`} />
        <MessageSquare size={14} /> Interview {unread ? `· ${unread}` : ''}
      </button>
    </div>
  );
}

export function ZoomBar() {
  const zoom = useStore((s) => s.cam.zoom);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const lib = useStore((s) => s.libraryOpen);
  return (
    <div className="float zoombar" style={{ left: lib ? 268 : 14 }} onPointerDown={(e) => e.stopPropagation()}>
      <button className="icon-btn" onClick={() => E.current?.setZoom(zoom / 1.2)} title="Zoom out (⌘−)">
        <ZoomOut size={16} />
      </button>
      <button className="z" onClick={() => E.current?.setZoom(1)} title="Reset zoom (⌘0)">
        {Math.round(zoom * 100)}%
      </button>
      <button className="icon-btn" onClick={() => E.current?.setZoom(zoom * 1.2)} title="Zoom in (⌘+)">
        <ZoomIn size={16} />
      </button>
      <button className="icon-btn" onClick={() => E.current?.fit()} title="Fit everything (⇧1)">
        <Scan size={16} />
      </button>
      <div className="sep" />
      <button className="icon-btn" disabled={!canUndo} onClick={() => E.current?.undo()} title="Undo (⌘Z)">
        <Undo2 size={16} />
      </button>
      <button className="icon-btn" disabled={!canRedo} onClick={() => E.current?.redo()} title="Redo (⇧⌘Z)">
        <Redo2 size={16} />
      </button>
    </div>
  );
}

export function Toast() {
  const t = useStore((s) => s.toast);
  const [, force] = useState(0);
  useEffect(() => {
    if (!t) return;
    const id = setTimeout(() => force((x) => x + 1), 2400);
    return () => clearTimeout(id);
  }, [t]);
  if (!t || Date.now() - t.at > 2300) return null;
  return <div className="toast" key={t.at}>{t.text}</div>;
}

export function AiEye() {
  const a = useStore((s) => s.aiActivity);
  if (!a || a.what !== 'looking') return null;
  return (
    <div className="ai-eye">
      <Eye size={14} /> The interviewer is looking at your board
    </div>
  );
}

export function EmptyHint() {
  const n = useStore((s) => s.elements.length);
  if (n) return null;
  return (
    <div className="hint-empty">
      <svg width="120" height="60" viewBox="0 0 120 60" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M10 50 C 30 10, 70 0, 104 16" />
        <path d="M92 8 L105 16 L93 26" />
      </svg>
      <div className="big">Sketch your system here</div>
      <div className="small">Drag components from the left · press A to connect · double-click to write</div>
    </div>
  );
}

const KEYS: [string, string][] = [
  ['Select', 'V  1'], ['Hand / pan', 'H  or hold Space'], ['Rectangle', 'R  2'], ['Diamond', 'D  3'], ['Ellipse', 'O  4'], ['Arrow', 'A  5'],
  ['Line', 'L  6'], ['Pen', 'P  7'], ['Text', 'T  8'], ['Sticky note', 'N  9'], ['Zone / frame', 'F'], ['Eraser', 'E  0'], ['Laser pointer', 'K'],
  ['Components panel', 'C'], ['Interview panel', 'I'], ['Tool lock', 'Q'], ['Snap to grid', 'G'], ['Edit label', 'Enter / double-click'],
  ['Undo / redo', '⌘Z  ⇧⌘Z'], ['Duplicate', '⌘D'], ['Copy / paste', '⌘C  ⌘V'], ['Select all', '⌘A'], ['Zoom', '⌘+  ⌘−  pinch'],
  ['Fit to content', '⇧1'], ['Front / back', '⌘]  ⌘['], ['Nudge', 'Arrows (⇧ ×10)'], ['Constrain', 'hold ⇧ while drawing'],
];

export function Help() {
  const open = useStore((s) => s.helpOpen);
  if (!open) return null;
  return (
    <div className="modal-back" onPointerDown={() => store.set({ helpOpen: false })}>
      <div className="float modal" onPointerDown={(e) => e.stopPropagation()}>
        <h3>Keyboard shortcuts</h3>
        <div className="keys">
          {KEYS.map(([a, b]) => (
            <div key={a}>
              <span>{a}</span>
              <span>
                {b.split('  ').map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
