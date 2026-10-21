import rough from 'roughjs';
import type { RoughCanvas } from 'roughjs/bin/canvas';
import type { El, ComponentKind } from '../../shared/types';
import {
  type Pt,
  type Box,
  elBox,
  isLinear,
  isBindable,
  linearPath,
  distToSegment,
  rebindArrows,
  routeArrow,
  syncLinearBox,
  bendPoint,
  unionBox,
  pathMidpoint,
  boundsOfPts,
} from '../../shared/geometry';
import { store, toast, type Tool } from './store';
import { makeEl, makeComponent, measureText, uid, randSeed, lineHeight } from './elements';
import { drawElement, drawGrid, renderToCanvas, clearRenderCache } from './render/renderer';
import { THEME } from './palette';

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'p0' | 'p1' | 'bend';

type Mode =
  | null
  | { kind: 'pan'; sx: number; sy: number; cam0: { x: number; y: number } }
  | { kind: 'move'; start: Pt; orig: Map<string, El>; moved: boolean; clickedId: string; wasSelected: boolean }
  | { kind: 'resize'; handle: Handle; start: Pt; orig: Map<string, El>; box0: Box }
  | { kind: 'marquee'; start: Pt; cur: Pt; additive: boolean }
  | { kind: 'create'; id: string; start: Pt }
  | { kind: 'arrowEnd'; id: string; which: 0 | 1; isNew: boolean }
  | { kind: 'bend'; id: string }
  | { kind: 'pen'; id: string }
  | { kind: 'erase'; ids: Set<string>; last: Pt }
  | { kind: 'laser' };

const HANDLE = 9;
const isTextInput = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

export class Engine {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  rc: RoughCanvas;
  dpr = 1;
  width = 0;
  height = 0;
  mode: Mode = null;
  hoverId: string | null = null;
  bindTarget: string | null = null;
  pointer: Pt = { x: 0, y: 0 };
  spaceDown = false;
  laser: { x: number; y: number; t: number }[] = [];
  highlights = new Map<string, number>();
  private dirty = true;
  private raf = 0;
  private past: El[][] = [];
  private future: El[][] = [];
  private committed: El[];
  private clip: El[] = [];
  private pasteCount = 0;
  private unsub: () => void;
  onLocalChange: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.rc = rough.canvas(canvas);
    this.committed = store.get().elements;
    this.unsub = store.subscribe(() => (this.dirty = true));
    this.resize();
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('dblclick', this.onDbl);
    // mousedown's default focus change would blur a label editor opened on pointerdown
    canvas.addEventListener('mousedown', (e) => e.preventDefault());
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('pointerleave', () => {
      if (!this.mode) {
        this.hoverId = null;
        this.dirty = true;
      }
    });
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('resize', this.resize);
    window.addEventListener('paste', this.onPaste);
    document.fonts?.ready.then(() => {
      clearRenderCache();
      this.dirty = true;
    });
    const loop = () => {
      const animating = this.laser.length > 0 || this.highlights.size > 0;
      if (this.dirty || animating) {
        this.dirty = false;
        this.render();
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.unsub();
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('paste', this.onPaste);
  }

  // ---------- coordinates ----------
  get cam() {
    return store.get().cam;
  }
  toWorld(sx: number, sy: number): Pt {
    const c = this.cam;
    return { x: sx / c.zoom + c.x, y: sy / c.zoom + c.y };
  }
  toScreen(p: Pt): Pt {
    const c = this.cam;
    return { x: (p.x - c.x) * c.zoom, y: (p.y - c.y) * c.zoom };
  }
  private evPt(e: { clientX: number; clientY: number }) {
    const r = this.canvas.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }
  resize = () => {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.width = r.width;
    this.height = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    this.dirty = true;
  };
  invalidate() {
    this.dirty = true;
  }

  // ---------- elements & history ----------
  get elements() {
    return store.get().elements;
  }
  private setEls(elements: El[], opts: { commit?: boolean; remote?: boolean } = {}) {
    store.set({ elements, updatedAt: Date.now() });
    if (opts.commit) this.commit();
    if (!opts.remote) this.onLocalChange?.();
  }
  commit() {
    const cur = this.elements;
    if (cur === this.committed) return;
    this.past.push(this.committed);
    if (this.past.length > 150) this.past.shift();
    this.future = [];
    this.committed = cur;
    store.set({ canUndo: true, canRedo: false });
  }
  undo = () => {
    if (!this.past.length) return;
    this.future.push(this.elements);
    const prev = this.past.pop()!;
    this.committed = prev;
    const ids = new Set(prev.map((e) => e.id));
    store.set((s) => ({ selectedIds: s.selectedIds.filter((i) => ids.has(i)), canUndo: this.past.length > 0, canRedo: true }));
    this.setEls(prev);
  };
  redo = () => {
    if (!this.future.length) return;
    this.past.push(this.elements);
    const next = this.future.pop()!;
    this.committed = next;
    store.set({ canUndo: true, canRedo: this.future.length > 0 });
    this.setEls(next);
  };
  private patch(ids: Set<string> | string[], fn: (e: El) => El, opts: { commit?: boolean } = {}) {
    const set = ids instanceof Set ? ids : new Set(ids);
    let els = this.elements.map((e) => (set.has(e.id) ? { ...fn(e), version: e.version + 1 } : e));
    els = rebindArrows(els, set);
    this.setEls(els, opts);
  }
  updateSelected(fn: (e: El) => Partial<El>) {
    const ids = store.get().selectedIds;
    if (!ids.length) return;
    this.patch(ids, (e) => {
      const p = fn(e);
      const next = { ...e, ...p };
      if (next.type === 'text' && (p.fontSize || p.font)) {
        const m = measureText(next.label || '', next);
        next.w = m.w;
        next.h = m.h;
      }
      return next;
    }, { commit: true });
  }
  select(ids: string[]) {
    store.set({ selectedIds: ids });
  }
  get selected(): El[] {
    const ids = new Set(store.get().selectedIds);
    return this.elements.filter((e) => ids.has(e.id));
  }
  setTool(tool: Tool) {
    store.set({ tool, editingId: null, ...(tool !== 'select' ? { selectedIds: [] } : {}) });
    this.updateCursor();
  }
  deleteSelected() {
    const ids = new Set(store.get().selectedIds);
    if (!ids.size) return;
    const els = this.elements
      .filter((e) => !ids.has(e.id))
      .map((e) => (e.type === 'comment' && e.target && ids.has(e.target) ? { ...e, target: null } : e));
    store.set({ selectedIds: [] });
    this.setEls(rebindArrows(els, null), { commit: true });
  }
  duplicateSelected() {
    const sel = this.selected;
    if (!sel.length) return;
    const copies = cloneSet(sel, 24, 24);
    this.setEls([...this.elements, ...copies], { commit: true });
    this.select(copies.map((c) => c.id));
  }
  copy() {
    this.clip = this.selected.map((e) => ({ ...e }));
    this.pasteCount = 0;
    if (this.clip.length) {
      navigator.clipboard?.writeText(JSON.stringify({ sysdesign: true, elements: this.clip })).catch(() => {});
      toast(`Copied ${this.clip.length} item${this.clip.length > 1 ? 's' : ''}`);
    }
  }
  cut() {
    this.copy();
    this.deleteSelected();
  }
  pasteInternal() {
    if (!this.clip.length) return false;
    this.pasteCount++;
    const copies = cloneSet(this.clip, 24 * this.pasteCount, 24 * this.pasteCount);
    this.setEls([...this.elements, ...copies], { commit: true });
    this.select(copies.map((c) => c.id));
    return true;
  }
  private onPaste = (ev: ClipboardEvent) => {
    if (isTextInput(ev.target)) return;
    const text = ev.clipboardData?.getData('text/plain') ?? '';
    ev.preventDefault();
    try {
      const d = JSON.parse(text);
      if (d?.sysdesign && Array.isArray(d.elements)) {
        this.clip = d.elements;
        this.pasteInternal();
        return;
      }
    } catch {
      /* plain text */
    }
    if (text.trim()) {
      const c = this.viewCenter();
      const el = makeEl('text', c.x, c.y, store.get().style, { label: text.trim() });
      const m = measureText(el.label!, el);
      this.setEls([...this.elements, { ...el, w: m.w, h: m.h, x: c.x - m.w / 2 }], { commit: true });
      this.select([el.id]);
    } else this.pasteInternal();
  };
  selectAll() {
    store.set({ selectedIds: this.elements.map((e) => e.id), tool: 'select' });
  }
  reorder(dir: 'front' | 'back') {
    const ids = new Set(store.get().selectedIds);
    const sel = this.elements.filter((e) => ids.has(e.id));
    const rest = this.elements.filter((e) => !ids.has(e.id));
    this.setEls(dir === 'front' ? [...rest, ...sel] : [...sel, ...rest], { commit: true });
  }
  clearAll() {
    store.set({ selectedIds: [], editingId: null });
    this.setEls([], { commit: true });
  }
  loadElements(els: El[], opts: { remote?: boolean; resetHistory?: boolean } = {}) {
    if (opts.resetHistory) {
      this.past = [];
      this.future = [];
      store.set({ canUndo: false, canRedo: false });
    }
    store.set({ selectedIds: [], editingId: null });
    this.setEls(rebindArrows(els, null), { remote: opts.remote });
    this.committed = this.elements;
  }

  viewCenter(): Pt {
    const s = store.get();
    const left = s.libraryOpen ? 268 : 0;
    const right = s.panelOpen ? 380 : 0;
    return this.toWorld(left + (this.width - left - right) / 2, this.height / 2);
  }

  addComponent(kind: ComponentKind, at?: Pt) {
    let p = at ?? this.viewCenter();
    if (!at) {
      // cascade so repeated clicks don't stack exactly
      for (let i = 0; i < 12; i++) {
        const taken = this.elements.some((e) => e.type === 'component' && Math.abs(e.x + e.w / 2 - p.x) < 20 && Math.abs(e.y + e.h / 2 - p.y) < 20);
        if (!taken) break;
        p = { x: p.x + 36, y: p.y + 30 };
      }
    }
    if (store.get().gridSnap) p = { x: snap(p.x), y: snap(p.y) };
    const el = makeComponent(kind, p.x, p.y, store.get().style);
    this.setEls([...this.elements, el], { commit: true });
    store.set({ selectedIds: [el.id], tool: 'select' });
  }

  // ---------- remote (AI) ----------
  applyRemoteElements(add: El[], { flash = true } = {}) {
    const byId = new Map(this.elements.map((e) => [e.id, e]));
    const incoming = add.map((e) => normalizeIncoming(e));
    const merged = this.elements.map((e) => incoming.find((n) => n.id === e.id) ?? e);
    for (const n of incoming) if (!byId.has(n.id)) n.type === 'frame' ? merged.unshift(n) : merged.push(n);
    this.setEls(rebindArrows(merged, new Set(incoming.map((e) => e.id))), { commit: true });
    if (flash) this.highlight(incoming.map((e) => e.id), 2.5);
  }
  removeRemote(ids: string[]) {
    const set = new Set(ids);
    this.setEls(rebindArrows(this.elements.filter((e) => !set.has(e.id)), null), { commit: true });
  }
  highlight(ids: string[], seconds: number) {
    const until = performance.now() + seconds * 1000;
    for (const id of ids) this.highlights.set(id, until);
  }
  focus(ids: string[]) {
    const set = new Set(ids);
    const b = unionBox(this.elements.filter((e) => set.has(e.id)).map(elBox));
    if (b) this.fitBox(b, 1.2);
  }
  snapshot(): string {
    const els = this.elements.filter((e) => !(e.type === 'comment' && e.resolved));
    return renderToCanvas(els, 'light', { maxSize: 1800, scale: 1.5, padding: 50 }).toDataURL('image/png');
  }

  // ---------- zoom ----------
  setZoom(z: number, anchor?: { sx: number; sy: number }) {
    const c = this.cam;
    z = Math.max(0.1, Math.min(4, z));
    const a = anchor ?? { sx: this.width / 2, sy: this.height / 2 };
    const w = this.toWorld(a.sx, a.sy);
    store.set({ cam: { zoom: z, x: w.x - a.sx / z, y: w.y - a.sy / z } });
  }
  fitBox(b: Box, maxZoom = 1.5) {
    const s = store.get();
    const left = s.libraryOpen ? 268 : 0;
    const right = s.panelOpen ? 380 : 0;
    const W = this.width - left - right - 80, H = this.height - 160;
    const z = Math.max(0.1, Math.min(maxZoom, W / Math.max(b.w, 1), H / Math.max(b.h, 1)));
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const sx = left + 40 + W / 2, sy = 80 + H / 2;
    store.set({ cam: { zoom: z, x: cx - sx / z, y: cy - sy / z } });
  }
  fit() {
    const b = unionBox(this.elements.map(elBox));
    if (b) this.fitBox(b);
    else store.set({ cam: { x: -80, y: -60, zoom: 1 } });
  }

  // ---------- hit testing ----------
  private tol() {
    return 8 / this.cam.zoom;
  }
  hitTest(p: Pt, opts: { bindableOnly?: boolean; exclude?: string } = {}): El | null {
    const els = this.elements;
    const tol = this.tol();
    let frameHit: El | null = null;
    for (let i = els.length - 1; i >= 0; i--) {
      const e = els[i];
      if (e.id === opts.exclude) continue;
      if (opts.bindableOnly && !isBindable(e)) continue;
      if (isLinear(e)) {
        const path = linearPath(e);
        for (let j = 1; j < path.length; j++)
          if (distToSegment(p, { x: path[j - 1][0], y: path[j - 1][1] }, { x: path[j][0], y: path[j][1] }) < tol + e.strokeWidth) return e;
        if (e.label) {
          const m = pathMidpoint(path);
          if (Math.abs(p.x - m.x) < 40 && Math.abs(p.y - m.y) < 14) return e;
        }
        continue;
      }
      if (e.type === 'pen') {
        const pts = e.pts || [];
        for (let j = 1; j < pts.length; j++)
          if (distToSegment(p, { x: pts[j - 1][0], y: pts[j - 1][1] }, { x: pts[j][0], y: pts[j][1] }) < tol + e.strokeWidth * 1.5) return e;
        if (pts.length === 1 && Math.hypot(p.x - pts[0][0], p.y - pts[0][1]) < tol + e.strokeWidth) return e;
        continue;
      }
      const inside = p.x >= e.x - tol && p.x <= e.x + e.w + tol && p.y >= e.y - tol && p.y <= e.y + e.h + tol;
      if (e.type === 'frame') {
        const nearEdge =
          inside && (p.x < e.x + tol * 1.6 || p.x > e.x + e.w - tol * 1.6 || p.y < e.y + tol * 1.6 || p.y > e.y + e.h - tol * 1.6);
        const onTab = p.x >= e.x + 12 && p.x <= e.x + 16 + Math.max(60, (e.label?.length ?? 4) * 9 + 24) && p.y >= e.y - 15 && p.y <= e.y + 14;
        if (nearEdge || onTab) return e;
        if (inside && !frameHit) frameHit = e;
        continue;
      }
      if (inside) return e;
    }
    return opts.bindableOnly ? null : null;
  }
  private frameAt(p: Pt): El | null {
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const e = this.elements[i];
      if (e.type === 'frame' && p.x > e.x && p.x < e.x + e.w && p.y > e.y && p.y < e.y + e.h) return e;
    }
    return null;
  }

  private selectionBox(): Box | null {
    const sel = this.selected;
    if (!sel.length) return null;
    return unionBox(sel.map(elBox));
  }

  private handles(): { id: Handle; x: number; y: number }[] {
    const sel = this.selected;
    if (!sel.length || store.get().editingId) return [];
    if (sel.length === 1 && isLinear(sel[0])) {
      const e = sel[0];
      const pts = e.pts!;
      const s = { x: pts[0][0], y: pts[0][1] }, t = { x: pts[1][0], y: pts[1][1] };
      const out: { id: Handle; x: number; y: number }[] = [
        { id: 'p0', ...this.toScreen(s) },
        { id: 'p1', ...this.toScreen(t) },
      ];
      if (e.route !== 'elbow') out.push({ id: 'bend', ...this.toScreen(bendPoint(s, t, e.bend || 0)) });
      return out;
    }
    if (sel.length === 1 && sel[0].type === 'comment') return [];
    const b = this.selectionBox()!;
    const a = this.toScreen({ x: b.x, y: b.y });
    const z = this.cam.zoom;
    const w = b.w * z, h = b.h * z;
    const P = 6;
    const pts: [Handle, number, number][] = [
      ['nw', a.x - P, a.y - P], ['n', a.x + w / 2, a.y - P], ['ne', a.x + w + P, a.y - P], ['e', a.x + w + P, a.y + h / 2],
      ['se', a.x + w + P, a.y + h + P], ['s', a.x + w / 2, a.y + h + P], ['sw', a.x - P, a.y + h + P], ['w', a.x - P, a.y + h / 2],
    ];
    return pts
      .filter(([id]) => (w > 40 || !['n', 's'].includes(id)) && (h > 40 || !['e', 'w'].includes(id)))
      .map(([id, x, y]) => ({ id, x, y }));
  }
  private handleAt(sx: number, sy: number): Handle | null {
    for (const h of this.handles()) if (Math.abs(h.x - sx) <= HANDLE && Math.abs(h.y - sy) <= HANDLE) return h.id;
    return null;
  }
  private connectPoints(e: El): { side: string; x: number; y: number }[] {
    const off = 18 / this.cam.zoom;
    return [
      { side: 'n', x: e.x + e.w / 2, y: e.y - off },
      { side: 'e', x: e.x + e.w + off, y: e.y + e.h / 2 },
      { side: 's', x: e.x + e.w / 2, y: e.y + e.h + off },
      { side: 'w', x: e.x - off, y: e.y + e.h / 2 },
    ];
  }
  private connectAt(p: Pt): { el: El; x: number; y: number } | null {
    if (!this.hoverId) return null;
    const el = this.elements.find((e) => e.id === this.hoverId);
    if (!el || !isBindable(el) || el.type === 'text') return null;
    const r = 10 / this.cam.zoom;
    for (const c of this.connectPoints(el)) if (Math.hypot(p.x - c.x, p.y - c.y) < r) return { el, x: c.x, y: c.y };
    return null;
  }

  // ---------- pointer ----------
  private onDown = (ev: PointerEvent) => {
    const { sx, sy } = this.evPt(ev);
    const p = this.toWorld(sx, sy);
    this.pointer = p;
    const s = store.get();
    // stop the browser's mousedown focus change, or it would immediately blur a label editor we open below
    ev.preventDefault();
    (document.activeElement as HTMLElement)?.blur?.();
    if (s.editingId) return;
    this.canvas.setPointerCapture(ev.pointerId);
    if (ev.button === 1 || ev.button === 2 || this.spaceDown || s.tool === 'hand') {
      this.mode = { kind: 'pan', sx, sy, cam0: { ...s.cam } };
      this.updateCursor();
      return;
    }
    if (ev.button !== 0) return;
    const style = s.style;
    const snapP = s.gridSnap ? { x: snap(p.x), y: snap(p.y) } : p;

    switch (s.tool) {
      case 'select': {
        const h = this.handleAt(sx, sy);
        if (h) {
          const sel = this.selected;
          if (h === 'p0' || h === 'p1') this.mode = { kind: 'arrowEnd', id: sel[0].id, which: h === 'p0' ? 0 : 1, isNew: false };
          else if (h === 'bend') this.mode = { kind: 'bend', id: sel[0].id };
          else this.mode = { kind: 'resize', handle: h, start: p, orig: new Map(sel.map((e) => [e.id, e])), box0: this.selectionBox()! };
          return;
        }
        const con = this.connectAt(p);
        if (con) {
          const a = makeEl('arrow', con.x, con.y, style, { start: { id: con.el.id }, pts: [[con.x, con.y], [con.x, con.y]] });
          this.setEls([...this.elements, a]);
          this.mode = { kind: 'arrowEnd', id: a.id, which: 1, isNew: true };
          store.set({ selectedIds: [a.id] });
          return;
        }
        const hit = this.hitTest(p);
        if (hit) {
          let ids = s.selectedIds;
          const wasSelected = ids.includes(hit.id);
          if (ev.shiftKey) ids = wasSelected ? ids.filter((i) => i !== hit.id) : [...ids, hit.id];
          else if (!wasSelected) ids = [hit.id];
          store.set({ selectedIds: ids });
          const moving = new Set(ids);
          // frames carry their contents along
          for (const e of this.elements) if (moving.has(e.id) && e.type === 'frame') for (const c of this.elements) if (c.id !== e.id && inside(elBox(c), e)) moving.add(c.id);
          // comments follow their target
          for (const c of this.elements) if (c.type === 'comment' && c.target && moving.has(c.target)) moving.add(c.id);
          const orig = new Map(this.elements.filter((e) => moving.has(e.id)).map((e) => [e.id, e]));
          this.mode = { kind: 'move', start: p, orig, moved: false, clickedId: hit.id, wasSelected };
        } else {
          if (!ev.shiftKey) store.set({ selectedIds: [] });
          this.mode = { kind: 'marquee', start: p, cur: p, additive: ev.shiftKey };
        }
        break;
      }
      case 'rect':
      case 'ellipse':
      case 'diamond':
      case 'frame': {
        const el = makeEl(s.tool, snapP.x, snapP.y, style);
        this.setEls(s.tool === 'frame' ? [el, ...this.elements] : [...this.elements, el]);
        this.mode = { kind: 'create', id: el.id, start: snapP };
        break;
      }
      case 'note': {
        const el = makeEl('note', snapP.x - 90, snapP.y - 75, style);
        this.setEls([...this.elements, el], { commit: true });
        store.set({ selectedIds: [el.id], editingId: el.id, tool: s.toolLocked ? 'note' : 'select' });
        break;
      }
      case 'text': {
        const hit = this.hitTest(p);
        if (hit && hit.type === 'text') {
          store.set({ selectedIds: [hit.id], editingId: hit.id });
          break;
        }
        const el = makeEl('text', snapP.x, snapP.y - lineHeight(style) / 2, style, { label: '', w: 10, h: lineHeight(style) });
        this.setEls([...this.elements, el]);
        store.set({ selectedIds: [el.id], editingId: el.id, tool: s.toolLocked ? 'text' : 'select' });
        break;
      }
      case 'arrow':
      case 'line': {
        const target = this.hitTest(p, { bindableOnly: true });
        const el = makeEl(s.tool, p.x, p.y, style, { start: target ? { id: target.id } : null });
        this.setEls([...this.elements, el]);
        this.mode = { kind: 'arrowEnd', id: el.id, which: 1, isNew: true };
        store.set({ selectedIds: [el.id] });
        break;
      }
      case 'pen': {
        const el = makeEl('pen', p.x, p.y, style, { pts: [[p.x, p.y, ev.pressure || 0.5]], fill: 'none' });
        this.setEls([...this.elements, el]);
        this.mode = { kind: 'pen', id: el.id };
        break;
      }
      case 'eraser': {
        this.mode = { kind: 'erase', ids: new Set(), last: p };
        const hit = this.hitTest(p);
        if (hit) this.mode.ids.add(hit.id);
        break;
      }
      case 'laser':
        this.mode = { kind: 'laser' };
        this.laser.push({ ...p, t: performance.now() });
        break;
    }
    this.dirty = true;
  };

  private onMove = (ev: PointerEvent) => {
    const { sx, sy } = this.evPt(ev);
    const p = this.toWorld(sx, sy);
    this.pointer = p;
    const s = store.get();
    const m = this.mode;
    if (!m) {
      if (s.tool === 'select') {
        const prev = this.hoverId;
        const hovered = this.hitTest(p);
        if (hovered && isBindable(hovered) && hovered.type !== 'text') this.hoverId = hovered.id;
        else if (prev) {
          const el = this.elements.find((e) => e.id === prev);
          const pad = 30 / this.cam.zoom;
          if (!el || !(p.x > el.x - pad && p.x < el.x + el.w + pad && p.y > el.y - pad && p.y < el.y + el.h + pad)) this.hoverId = null;
        }
        if (prev !== this.hoverId) this.dirty = true;
        this.updateCursor(sx, sy, p);
      } else if (s.tool === 'laser') {
        // laser leaves a trail even without pressing
      }
      if (this.hoverId || s.tool === 'eraser') this.dirty = true;
      return;
    }
    switch (m.kind) {
      case 'pan': {
        const z = s.cam.zoom;
        store.set({ cam: { zoom: z, x: m.cam0.x - (sx - m.sx) / z, y: m.cam0.y - (sy - m.sy) / z } });
        break;
      }
      case 'move': {
        let dx = p.x - m.start.x, dy = p.y - m.start.y;
        if (!m.moved && Math.hypot(dx, dy) * s.cam.zoom < 3) return;
        m.moved = true;
        if (ev.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
        if (s.gridSnap) {
          const first = m.orig.get(m.clickedId) ?? [...m.orig.values()][0];
          dx = snap(first.x + dx) - first.x;
          dy = snap(first.y + dy) - first.y;
        }
        const ids = new Set(m.orig.keys());
        let els = this.elements.map((e) => {
          const o = m.orig.get(e.id);
          if (!o) return e;
          const moved = translate(o, dx, dy);
          if (isLinear(o)) {
            // an arrow dragged on its own lets go of shapes that are not moving with it
            if (o.start && !ids.has(o.start.id)) moved.start = null;
            if (o.end && !ids.has(o.end.id)) moved.end = null;
          }
          return { ...moved, version: e.version + 1 };
        });
        els = rebindArrows(els, ids);
        this.setEls(els);
        break;
      }
      case 'resize': {
        const b = m.box0;
        let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
        const h = m.handle;
        const q = s.gridSnap ? { x: snap(p.x), y: snap(p.y) } : p;
        if (h.includes('w')) x0 = Math.min(q.x, x1 - 10);
        if (h.includes('e')) x1 = Math.max(q.x, x0 + 10);
        if (h.includes('n')) y0 = Math.min(q.y, y1 - 10);
        if (h.includes('s')) y1 = Math.max(q.y, y0 + 10);
        const onlyText = [...m.orig.values()].every((e) => e.type === 'text');
        if (ev.shiftKey || onlyText) {
          const r = b.w / b.h;
          const nw = x1 - x0, nh = y1 - y0;
          if (h.length === 2) {
            if (nw / nh > r) {
              const w2 = nh * r;
              h.includes('w') ? (x0 = x1 - w2) : (x1 = x0 + w2);
            } else {
              const h2 = nw / r;
              h.includes('n') ? (y0 = y1 - h2) : (y1 = y0 + h2);
            }
          }
        }
        const nb = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        const sxr = nb.w / (b.w || 1), syr = nb.h / (b.h || 1);
        const els = this.elements.map((e) => {
          const o = m.orig.get(e.id);
          if (!o) return e;
          return { ...scaleEl(o, b, nb, sxr, syr), version: e.version + 1 };
        });
        this.setEls(rebindArrows(els, new Set(m.orig.keys())));
        break;
      }
      case 'marquee':
        m.cur = p;
        this.dirty = true;
        break;
      case 'create': {
        let w = p.x - m.start.x, h = p.y - m.start.y;
        if (s.gridSnap) {
          w = snap(p.x) - m.start.x;
          h = snap(p.y) - m.start.y;
        }
        if (ev.shiftKey) {
          const d = Math.max(Math.abs(w), Math.abs(h));
          w = Math.sign(w || 1) * d;
          h = Math.sign(h || 1) * d;
        }
        const box = { x: w < 0 ? m.start.x + w : m.start.x, y: h < 0 ? m.start.y + h : m.start.y, w: Math.abs(w), h: Math.abs(h) };
        this.setEls(this.elements.map((e) => (e.id === m.id ? { ...e, ...box, version: e.version + 1 } : e)));
        break;
      }
      case 'arrowEnd': {
        const el = this.elements.find((e) => e.id === m.id);
        if (!el) break;
        const other = m.which === 0 ? el.end : el.start;
        const target = this.hitTest(p, { bindableOnly: true, exclude: el.id });
        this.bindTarget = target && target.id !== other?.id ? target.id : null;
        let q = p;
        if (!this.bindTarget && ev.shiftKey) {
          const o = el.pts![m.which === 0 ? 1 : 0];
          const a = Math.atan2(p.y - o[1], p.x - o[0]);
          const sa = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
          const d = Math.hypot(p.x - o[0], p.y - o[1]);
          q = { x: o[0] + Math.cos(sa) * d, y: o[1] + Math.sin(sa) * d };
        }
        const pts = el.pts!.map((x) => [...x]);
        pts[m.which] = [q.x, q.y];
        const bind = this.bindTarget ? { id: this.bindTarget } : null;
        let next: El = { ...el, pts, ...(m.which === 0 ? { start: bind } : { end: bind }), version: el.version + 1 };
        const byId = new Map(this.elements.map((e) => [e.id, e]));
        next = syncLinearBox({ ...next, pts: routeArrow(next, byId) });
        this.setEls(this.elements.map((e) => (e.id === el.id ? next : e)));
        break;
      }
      case 'bend': {
        const el = this.elements.find((e) => e.id === m.id);
        if (!el?.pts) break;
        const a = { x: el.pts[0][0], y: el.pts[0][1] }, b = { x: el.pts[1][0], y: el.pts[1][1] };
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        let bend = ((p.x - (a.x + b.x) / 2) * -dy + (p.y - (a.y + b.y) / 2) * dx) / len;
        if (Math.abs(bend) < 6 / s.cam.zoom) bend = 0;
        this.patch([el.id], (e) => ({ ...e, bend, route: bend ? 'curve' : 'straight' }));
        break;
      }
      case 'pen': {
        const el = this.elements.find((e) => e.id === m.id);
        if (!el) break;
        const last = el.pts![el.pts!.length - 1];
        if (Math.hypot(p.x - last[0], p.y - last[1]) < 1 / s.cam.zoom) break;
        const pts = [...el.pts!, [p.x, p.y, ev.pressure || 0.5]];
        this.setEls(this.elements.map((e) => (e.id === el.id ? { ...e, pts, version: e.version + 1 } : e)));
        break;
      }
      case 'erase': {
        const steps = Math.ceil(Math.hypot(p.x - m.last.x, p.y - m.last.y) / (4 / s.cam.zoom)) || 1;
        for (let i = 1; i <= steps; i++) {
          const q = { x: m.last.x + ((p.x - m.last.x) * i) / steps, y: m.last.y + ((p.y - m.last.y) * i) / steps };
          const hit = this.hitTest(q);
          if (hit) m.ids.add(hit.id);
        }
        m.last = p;
        this.dirty = true;
        break;
      }
      case 'laser':
        this.laser.push({ ...p, t: performance.now() });
        break;
    }
  };

  private onUp = (ev: PointerEvent) => {
    const m = this.mode;
    this.mode = null;
    const s = store.get();
    try {
      this.canvas.releasePointerCapture(ev.pointerId);
    } catch {
      /* noop */
    }
    if (!m) return;
    const backToSelect = () => !s.toolLocked && store.set({ tool: 'select' });
    switch (m.kind) {
      case 'move':
        if (m.moved) this.commit();
        else if (m.wasSelected && !ev.shiftKey && s.selectedIds.length > 1) store.set({ selectedIds: [m.clickedId] });
        break;
      case 'resize':
      case 'bend':
        this.commit();
        break;
      case 'marquee': {
        const b = normBox(m.start, m.cur);
        if (b.w * s.cam.zoom > 3 || b.h * s.cam.zoom > 3) {
          const ids = this.elements.filter((e) => inside(elBox(e), b)).map((e) => e.id);
          store.set({ selectedIds: m.additive ? [...new Set([...s.selectedIds, ...ids])] : ids });
        }
        break;
      }
      case 'create': {
        const el = this.elements.find((e) => e.id === m.id);
        if (el && (el.w < 8 || el.h < 8)) {
          const w = el.type === 'frame' ? 420 : 160, h = el.type === 'frame' ? 280 : el.type === 'diamond' ? 120 : 100;
          this.setEls(this.elements.map((e) => (e.id === m.id ? { ...e, x: m.start.x - w / 2, y: m.start.y - h / 2, w, h, version: e.version + 1 } : e)));
        }
        this.commit();
        store.set({ selectedIds: [m.id] });
        backToSelect();
        break;
      }
      case 'arrowEnd': {
        const el = this.elements.find((e) => e.id === m.id);
        this.bindTarget = null;
        if (el && m.isNew) {
          const len = Math.hypot(el.pts![1][0] - el.pts![0][0], el.pts![1][1] - el.pts![0][1]);
          if (len < 10 && !el.end) {
            this.setEls(this.elements.filter((e) => e.id !== m.id));
            store.set({ selectedIds: [] });
            break;
          }
        }
        this.commit();
        if (m.isNew) backToSelect();
        break;
      }
      case 'pen': {
        const el = this.elements.find((e) => e.id === m.id);
        if (el) this.setEls(this.elements.map((e) => (e.id === m.id ? { ...e, ...boundsOfPts(e.pts!), version: e.version + 1 } : e)));
        this.commit();
        break;
      }
      case 'erase':
        if (m.ids.size) {
          const els = this.elements.filter((e) => !m.ids.has(e.id));
          this.setEls(rebindArrows(els, null), { commit: true });
        }
        break;
    }
    this.updateCursor();
    this.dirty = true;
  };

  private onDbl = (ev: MouseEvent) => {
    const { sx, sy } = this.evPt(ev);
    const p = this.toWorld(sx, sy);
    const s = store.get();
    if (s.tool !== 'select') return;
    const hit = this.hitTest(p);
    if (hit) {
      if (hit.type === 'pen') return;
      store.set({ selectedIds: [hit.id], editingId: hit.id });
      return;
    }
    const style = s.style;
    const el = makeEl('text', p.x, p.y - lineHeight(style) / 2, style, { label: '', w: 10, h: lineHeight(style) });
    this.setEls([...this.elements, el]);
    store.set({ selectedIds: [el.id], editingId: el.id });
  };

  commitText(id: string, text: string) {
    const el = this.elements.find((e) => e.id === id);
    store.set({ editingId: null });
    if (!el) return;
    const t = el.type === 'text' ? text.replace(/\s+$/, '') : text.trim();
    if (el.type === 'text' && !t) {
      this.setEls(this.elements.filter((e) => e.id !== id), { commit: true });
      store.set({ selectedIds: [] });
      return;
    }
    let next: El = { ...el, label: t, version: el.version + 1 };
    if (el.type === 'text') {
      const m = measureText(t, el);
      next = { ...next, w: m.w, h: m.h };
    }
    if (el.type === 'note') {
      const lines = Math.ceil(measureText(t, el).w / (el.w - 28)) + t.split('\n').length;
      next.h = Math.max(el.h, 40 + lines * lineHeight(el));
    }
    this.setEls(rebindArrows(this.elements.map((e) => (e.id === id ? next : e)), new Set([id])), { commit: true });
  }

  private onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    const { sx, sy } = this.evPt(ev);
    const c = this.cam;
    if (ev.ctrlKey || ev.metaKey) {
      const factor = Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0085));
      this.setZoom(c.zoom * factor, { sx, sy });
    } else {
      const dx = ev.shiftKey && !ev.deltaX ? ev.deltaY : ev.deltaX;
      const dy = ev.shiftKey && !ev.deltaX ? 0 : ev.deltaY;
      store.set({ cam: { ...c, x: c.x + dx / c.zoom, y: c.y + dy / c.zoom } });
    }
  };

  updateCursor(sx?: number, sy?: number, p?: Pt) {
    const s = store.get();
    let cur = 'default';
    if (this.spaceDown || s.tool === 'hand') cur = this.mode?.kind === 'pan' ? 'grabbing' : 'grab';
    else if (s.tool === 'text') cur = 'text';
    else if (s.tool === 'eraser') cur = 'cell';
    else if (s.tool === 'laser') cur = 'crosshair';
    else if (s.tool !== 'select') cur = 'crosshair';
    else if (sx !== undefined && sy !== undefined && p) {
      const h = this.handleAt(sx, sy);
      if (h) cur = h === 'p0' || h === 'p1' || h === 'bend' ? 'pointer' : ({ nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw', n: 'ns', s: 'ns', e: 'ew', w: 'ew' } as Record<string, string>)[h] + '-resize';
      else if (this.connectAt(p)) cur = 'copy';
      else if (this.hitTest(p)) cur = 'move';
    }
    this.canvas.style.cursor = cur;
  }

  // ---------- keyboard ----------
  private onKey = (ev: KeyboardEvent) => {
    if (isTextInput(ev.target)) return;
    const s = store.get();
    const mod = ev.metaKey || ev.ctrlKey;
    const k = ev.key.toLowerCase();
    if (ev.key === ' ') {
      if (!this.spaceDown) {
        this.spaceDown = true;
        this.updateCursor();
      }
      ev.preventDefault();
      return;
    }
    if (mod) {
      if (k === 'z') { ev.preventDefault(); ev.shiftKey ? this.redo() : this.undo(); }
      else if (k === 'y') { ev.preventDefault(); this.redo(); }
      else if (k === 'a') { ev.preventDefault(); this.selectAll(); }
      else if (k === 'd') { ev.preventDefault(); this.duplicateSelected(); }
      else if (k === 'c') { this.copy(); }
      else if (k === 'x') { this.cut(); }
      else if (k === '0') { ev.preventDefault(); this.setZoom(1); }
      else if (k === '=' || k === '+') { ev.preventDefault(); this.setZoom(this.cam.zoom * 1.2); }
      else if (k === '-') { ev.preventDefault(); this.setZoom(this.cam.zoom / 1.2); }
      else if (k === ']') { ev.preventDefault(); this.reorder('front'); }
      else if (k === '[') { ev.preventDefault(); this.reorder('back'); }
      return;
    }
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); this.deleteSelected(); return; }
    if (ev.key === 'Escape') {
      store.set({ selectedIds: [], tool: 'select', helpOpen: false });
      this.updateCursor();
      return;
    }
    if (ev.key === 'Enter' && s.selectedIds.length === 1) {
      ev.preventDefault();
      const el = this.selected[0];
      if (el && el.type !== 'pen') store.set({ editingId: el.id });
      return;
    }
    if (ev.key.startsWith('Arrow') && s.selectedIds.length) {
      ev.preventDefault();
      const d = ev.shiftKey ? 10 : 1;
      const dx = ev.key === 'ArrowLeft' ? -d : ev.key === 'ArrowRight' ? d : 0;
      const dy = ev.key === 'ArrowUp' ? -d : ev.key === 'ArrowDown' ? d : 0;
      this.patch(s.selectedIds, (e) => translate(e, dx, dy), { commit: true });
      return;
    }
    if (ev.shiftKey && (ev.key === '!' || ev.code === 'Digit1')) { this.fit(); return; }
    if (ev.key === '?') { store.set({ helpOpen: !s.helpOpen }); return; }
    const map: Record<string, Tool> = {
      v: 'select', '1': 'select', h: 'hand', r: 'rect', '2': 'rect', d: 'diamond', '3': 'diamond', o: 'ellipse', '4': 'ellipse',
      a: 'arrow', '5': 'arrow', l: 'line', '6': 'line', p: 'pen', '7': 'pen', t: 'text', '8': 'text', n: 'note', '9': 'note',
      f: 'frame', e: 'eraser', '0': 'eraser', k: 'laser',
    };
    if (map[k] && !ev.shiftKey && !ev.altKey) { this.setTool(map[k]); return; }
    if (k === 'c') store.set({ libraryOpen: !s.libraryOpen });
    else if (k === 'i') store.set({ panelOpen: !s.panelOpen });
    else if (k === 'g') { store.set({ gridSnap: !s.gridSnap }); toast(`Grid snap ${!s.gridSnap ? 'on' : 'off'}`); }
    else if (k === 'q') { store.set({ toolLocked: !s.toolLocked }); toast(`Tool lock ${!s.toolLocked ? 'on' : 'off'}`); }
  };
  private onKeyUp = (ev: KeyboardEvent) => {
    if (ev.key === ' ') {
      this.spaceDown = false;
      this.updateCursor();
    }
  };

  // ---------- render ----------
  render() {
    const { ctx, dpr } = this;
    const s = store.get();
    const { cam, theme } = s;
    const T = THEME[theme];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGrid(ctx, this.width, this.height, cam, theme);

    ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, -cam.x * cam.zoom * dpr, -cam.y * cam.zoom * dpr);
    const view = { x: cam.x - 50, y: cam.y - 50, w: this.width / cam.zoom + 100, h: this.height / cam.zoom + 100 };
    const erasing = this.mode?.kind === 'erase' ? this.mode.ids : null;
    const byId = new Map(s.elements.map((e) => [e.id, e]));
    for (const e of s.elements) {
      if (e.type === 'comment' && e.resolved) continue;
      const b = elBox(e);
      if (b.x > view.x + view.w || b.y > view.y + view.h || b.x + b.w < view.x || b.y + b.h < view.y) {
        if (e.type !== 'comment') continue;
      }
      if (erasing?.has(e.id)) {
        ctx.save();
        ctx.globalAlpha = 0.2;
        drawElement(ctx, this.rc, e, { theme, editingId: s.editingId, byId });
        ctx.restore();
      } else drawElement(ctx, this.rc, e, { theme, editingId: s.editingId, byId });
    }

    // ---- overlays in screen space ----
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const now = performance.now();
    const z = cam.zoom;

    // AI highlights
    for (const [id, until] of this.highlights) {
      if (until < now) { this.highlights.delete(id); continue; }
      const e = byId.get(id);
      if (!e) continue;
      const b = elBox(e);
      const a = this.toScreen({ x: b.x, y: b.y });
      const pulse = 0.5 + 0.5 * Math.sin(now / 160);
      const fade = Math.min(1, (until - now) / 400);
      ctx.save();
      ctx.strokeStyle = `rgba(255, 92, 140, ${(0.35 + pulse * 0.5) * fade})`;
      ctx.lineWidth = 3 + pulse * 3;
      ctx.shadowColor = 'rgba(255, 92, 140, 0.6)';
      ctx.shadowBlur = 12 + pulse * 10;
      ctx.beginPath();
      ctx.roundRect(a.x - 10, a.y - 10, b.w * z + 20, b.h * z + 20, 16);
      ctx.stroke();
      ctx.restore();
    }

    // bind target
    const bt = this.bindTarget && byId.get(this.bindTarget);
    if (bt) {
      const a = this.toScreen({ x: bt.x, y: bt.y });
      ctx.save();
      ctx.strokeStyle = T.selection;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.roundRect(a.x - 6, a.y - 6, bt.w * z + 12, bt.h * z + 12, 14);
      ctx.stroke();
      ctx.fillStyle = T.selectionFill;
      ctx.fill();
      ctx.restore();
    }

    // selection
    const sel = s.elements.filter((e) => s.selectedIds.includes(e.id));
    if (sel.length && !s.editingId) {
      ctx.save();
      ctx.strokeStyle = T.selection;
      ctx.lineWidth = 1.25;
      if (!(sel.length === 1 && isLinear(sel[0]))) {
        if (sel.length > 1)
          for (const e of sel) {
            const b = elBox(e);
            const a = this.toScreen({ x: b.x, y: b.y });
            ctx.setLineDash([3, 3]);
            ctx.strokeRect(a.x - 3, a.y - 3, b.w * z + 6, b.h * z + 6);
          }
        const b = this.selectionBox()!;
        const a = this.toScreen({ x: b.x, y: b.y });
        ctx.setLineDash(sel.length > 1 ? [6, 4] : []);
        ctx.beginPath();
        ctx.roundRect(a.x - 6, a.y - 6, b.w * z + 12, b.h * z + 12, 6);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const h of this.handles()) {
        ctx.beginPath();
        if (h.id === 'bend') {
          ctx.fillStyle = T.selection;
          ctx.globalAlpha = 0.85;
          ctx.arc(h.x, h.y, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = T.paper;
          if (h.id === 'p0' || h.id === 'p1') ctx.arc(h.x, h.y, 6, 0, Math.PI * 2);
          else ctx.roundRect(h.x - 4.5, h.y - 4.5, 9, 9, 2.5);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // quick-connect dots
    if (s.tool === 'select' && this.hoverId && !this.mode) {
      const e = byId.get(this.hoverId);
      if (e && isBindable(e) && e.type !== 'text') {
        const near = this.connectAt(this.pointer);
        for (const c of this.connectPoints(e)) {
          const q = this.toScreen(c);
          const active = near && Math.abs(near.x - c.x) < 0.01 && Math.abs(near.y - c.y) < 0.01;
          ctx.save();
          ctx.fillStyle = active ? T.selection : T.paper;
          ctx.strokeStyle = T.selection;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = active ? 1 : 0.85;
          ctx.beginPath();
          ctx.arc(q.x, q.y, active ? 7 : 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          if (active) {
            ctx.strokeStyle = T.paper;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(q.x - 3, q.y); ctx.lineTo(q.x + 3, q.y);
            ctx.moveTo(q.x, q.y - 3); ctx.lineTo(q.x, q.y + 3);
            ctx.stroke();
          }
          ctx.restore();
        }
      }
    }

    // marquee
    if (this.mode?.kind === 'marquee') {
      const b = normBox(this.mode.start, this.mode.cur);
      const a = this.toScreen({ x: b.x, y: b.y });
      ctx.save();
      ctx.fillStyle = T.selectionFill;
      ctx.strokeStyle = T.selection;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.roundRect(a.x, a.y, b.w * z, b.h * z, 4);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // laser trail
    if (this.laser.length) {
      this.laser = this.laser.filter((l) => now - l.t < 900);
      if (this.laser.length > 1) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = T.laser;
        ctx.shadowBlur = 14;
        for (let i = 1; i < this.laser.length; i++) {
          const a = this.toScreen(this.laser[i - 1]);
          const b = this.toScreen(this.laser[i]);
          const age = (now - this.laser[i].t) / 900;
          ctx.strokeStyle = T.laser;
          ctx.globalAlpha = Math.max(0, 1 - age);
          ctx.lineWidth = 2 + (1 - age) * 4;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // eraser cursor
    if (s.tool === 'eraser') {
      const q = this.toScreen(this.pointer);
      ctx.save();
      ctx.strokeStyle = T.ink;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

// ---------- helpers ----------
const GRID = 20;
const snap = (v: number) => Math.round(v / GRID) * GRID;

function normBox(a: Pt, b: Pt): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}
function inside(b: Box, outer: Box) {
  return b.x >= outer.x && b.y >= outer.y && b.x + b.w <= outer.x + outer.w && b.y + b.h <= outer.y + outer.h;
}
function translate(e: El, dx: number, dy: number): El {
  const n: El = { ...e, x: e.x + dx, y: e.y + dy };
  if (e.pts) n.pts = e.pts.map((p) => [p[0] + dx, p[1] + dy, ...p.slice(2)]);
  return n;
}
function scaleEl(o: El, b: Box, nb: Box, sxr: number, syr: number): El {
  const mx = (x: number) => nb.x + (x - b.x) * sxr;
  const my = (y: number) => nb.y + (y - b.y) * syr;
  const n: El = { ...o, x: mx(o.x), y: my(o.y), w: o.w * sxr, h: o.h * syr };
  if (o.pts) {
    n.pts = o.pts.map((p) => [mx(p[0]), my(p[1]), ...p.slice(2)]);
    if (o.type === 'pen') Object.assign(n, boundsOfPts(n.pts));
  }
  if (o.type === 'text') {
    n.fontSize = Math.max(8, (o.fontSize ?? 20) * syr);
    const m = measureText(o.label || '', n);
    n.w = m.w;
    n.h = m.h;
  }
  return n;
}
function cloneSet(els: El[], dx: number, dy: number): El[] {
  const idMap = new Map(els.map((e) => [e.id, uid()]));
  return els.map((e) => {
    const n = translate({ ...e, id: idMap.get(e.id)!, seed: randSeed(), version: 1, author: 'user' }, dx, dy);
    if (e.start) n.start = idMap.has(e.start.id) ? { id: idMap.get(e.start.id)! } : null;
    if (e.end) n.end = idMap.has(e.end.id) ? { id: idMap.get(e.end.id)! } : null;
    if (e.target) n.target = idMap.get(e.target) ?? e.target;
    return n;
  });
}
function normalizeIncoming(e: El): El {
  const n = { ...e };
  if (n.type === 'text' && n.label) {
    const m = measureText(n.label, n);
    n.w = m.w;
    n.h = m.h;
  }
  if (n.type === 'comment') {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = '400 17px "Kalam", cursive';
    n.w = n.w || 260;
    const words = (n.label || '').split(/\s+/);
    let lines = 1, line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > n.w - 28 && line) { lines++; line = w; } else line = t;
    }
    n.h = 40 + lines * 22;
  }
  return n;
}
