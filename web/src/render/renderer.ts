import rough from 'roughjs';
import type { Drawable, Options } from 'roughjs/bin/core';
import type { RoughCanvas } from 'roughjs/bin/canvas';
import { getStroke } from 'perfect-freehand';
import type { El } from '../../../shared/types';
import { linearPath, pathMidpoint, center, boundaryPoint } from '../../../shared/geometry';
import { strokeColor, fillColor, THEME, type Theme } from '../palette';
import { fontString, lineHeight, wrapText } from '../elements';
import { drawIcon, roundedRectPath, WIDE_ICON } from './icons';

const gen = rough.generator();

type Cached = { key: string; drawables: Drawable[]; path?: Path2D };
const cache = new Map<string, Cached>();

export function clearRenderCache() {
  cache.clear();
}

function dash(e: El): number[] | undefined {
  const w = e.strokeWidth;
  if (e.strokeStyle === 'dashed') return [10 + w * 2, 7 + w * 2];
  if (e.strokeStyle === 'dotted') return [1.5, 5 + w * 2];
  return undefined;
}

function baseOpts(e: El, theme: Theme): Options {
  const hasFill = e.fill !== 'none' && e.fillStyle !== 'none';
  return {
    seed: e.seed,
    roughness: e.roughness,
    bowing: 1,
    stroke: strokeColor(e.stroke, theme),
    strokeWidth: e.strokeWidth,
    fill: hasFill ? fillColor(e.fill, theme) : undefined,
    fillStyle: e.fillStyle === 'none' ? 'hachure' : e.fillStyle,
    hachureGap: 5 + e.strokeWidth * 1.6,
    hachureAngle: -41,
    fillWeight: Math.max(1, e.strokeWidth * 0.55),
    strokeLineDash: dash(e),
    disableMultiStroke: e.strokeStyle !== 'solid',
    preserveVertices: e.roughness < 0.5,
  };
}

const LABEL_BAND = 36;

function componentLayout(e: El) {
  const kind = e.kind!;
  const pad = 12;
  if (kind === 'user') {
    const s = Math.min(e.w - 10, e.h - LABEL_BAND - 6);
    return { outline: 'none', icon: { x: e.x + (e.w - s) / 2, y: e.y + 4, w: s, h: s }, labelY: e.y + e.h - LABEL_BAND / 2 };
  }
  if (kind === 'external') return { outline: 'cloud', icon: null, labelY: e.y + e.h * 0.6 };
  if (kind === 'sql' || kind === 'nosql') {
    const ry = cylRy(e);
    const top = e.y + ry * 2 + 8;
    const avail = e.y + e.h - LABEL_BAND - ry - top;
    const s = Math.max(0, Math.min(avail, e.w * 0.38));
    return { outline: 'cylinder', icon: s > 14 ? { x: e.x + (e.w - s) / 2, y: top + (avail - s) / 2, w: s, h: s } : null, labelY: e.y + e.h - ry - LABEL_BAND / 2 + 2 };
  }
  if (kind === 'storage') {
    const ry = cylRy(e);
    const top = e.y + ry * 2 + 6;
    const avail = e.y + e.h - LABEL_BAND - top;
    const s = Math.max(0, Math.min(avail, e.w * 0.36));
    return { outline: 'bucket', icon: s > 14 ? { x: e.x + (e.w - s) / 2, y: top + (avail - s) / 2, w: s, h: s } : null, labelY: e.y + e.h - LABEL_BAND / 2 - 2 };
  }
  const avail = e.h - pad - LABEL_BAND;
  if (WIDE_ICON[kind]) {
    const ih = Math.min(avail - 6, kind === 'stream' ? 44 : 34);
    const iw = e.w - 36;
    return { outline: 'card', icon: { x: e.x + 18, y: e.y + pad + (avail - ih) / 2, w: iw, h: ih }, labelY: e.y + e.h - LABEL_BAND / 2 - 2 };
  }
  const s = Math.max(0, Math.min(avail - 4, e.w * 0.42));
  return { outline: 'card', icon: { x: e.x + (e.w - s) / 2, y: e.y + pad + (avail - s) / 2, w: s, h: s }, labelY: e.y + e.h - LABEL_BAND / 2 - 2 };
}

const cylRy = (e: El) => Math.min(16, e.h * 0.13, e.w * 0.18);

function cloudPath(x: number, y: number, w: number, h: number) {
  const P = (u: number, v: number) => `${x + u * w},${y + v * h}`;
  return `M${P(0.22, 0.9)} C${P(0.02, 0.9)} ${P(0, 0.52)} ${P(0.2, 0.5)} C${P(0.14, 0.18)} ${P(0.46, 0.06)} ${P(0.54, 0.28)} C${P(0.62, 0.04)} ${P(0.92, 0.12)} ${P(0.84, 0.46)} C${P(1.02, 0.46)} ${P(1.02, 0.9)} ${P(0.8, 0.9)} Z`;
}

function build(e: El, theme: Theme): Cached {
  const o = baseOpts(e, theme);
  const d: Drawable[] = [];
  const { x, y, w, h } = e;
  const paper = THEME[theme].paper;
  switch (e.type) {
    case 'rect':
      d.push(gen.path(roundedRectPath(x, y, w, h, Math.min(14, Math.abs(w) / 5, Math.abs(h) / 5)), o));
      break;
    case 'frame':
      d.push(gen.path(roundedRectPath(x, y, w, h, 18), { ...o, fill: o.fill, roughness: Math.min(e.roughness, 0.8) }));
      break;
    case 'ellipse':
      d.push(gen.ellipse(x + w / 2, y + h / 2, w, h, o));
      break;
    case 'diamond':
      d.push(gen.polygon([[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]], o));
      break;
    case 'note':
      d.push(gen.path(roundedRectPath(x, y, w, h, 4), { ...o, fill: fillColor(e.fill, theme), fillStyle: 'solid', roughness: 0.6, stroke: 'transparent' }));
      break;
    case 'comment': {
      const c = strokeColor('pink', theme);
      d.push(gen.path(bubblePath(x, y, w, h), { ...o, stroke: c, fill: fillColor('pink', theme), fillStyle: 'solid', strokeWidth: 1.6, roughness: 0.8 }));
      break;
    }
    case 'component': {
      const L = componentLayout(e);
      const ink = strokeColor(e.stroke, theme);
      const accent = strokeColor(e.fill === 'none' ? 'ink' : e.fill, theme);
      if (L.outline === 'card') d.push(gen.path(roundedRectPath(x, y, w, h, 16), o));
      else if (L.outline === 'cylinder') {
        const ry = cylRy(e);
        d.push(gen.path(`M${x},${y + ry} L${x},${y + h - ry} A${w / 2},${ry} 0 0 0 ${x + w},${y + h - ry} L${x + w},${y + ry} A${w / 2},${ry} 0 0 1 ${x},${y + ry} Z`, o));
        d.push(gen.ellipse(x + w / 2, y + ry, w, ry * 2, { ...o, fill: o.fill ? fillColor(e.fill, theme) : undefined, fillStyle: 'solid' }));
        d.push(gen.arc(x + w / 2, y + ry + 9, w, ry * 2, 0.15, Math.PI - 0.15, false, { ...o, fill: undefined, strokeWidth: e.strokeWidth * 0.7 }));
      } else if (L.outline === 'bucket') {
        const ry = cylRy(e);
        const rx2 = w * 0.36, ry2 = ry * 0.7;
        d.push(gen.path(`M${x},${y + ry} L${x + w * 0.14},${y + h - ry2} A${rx2},${ry2} 0 0 0 ${x + w * 0.86},${y + h - ry2} L${x + w},${y + ry} A${w / 2},${ry} 0 0 1 ${x},${y + ry} Z`, o));
        d.push(gen.ellipse(x + w / 2, y + ry, w, ry * 2, { ...o, fill: o.fill ? fillColor(e.fill, theme) : undefined, fillStyle: 'solid' }));
      } else if (L.outline === 'cloud') {
        d.push(gen.path(cloudPath(x, y, w, h), o));
      }
      if (L.icon && e.kind) {
        const io: Options = {
          seed: e.seed + 7,
          roughness: Math.min(e.roughness, 1.2) * 0.85,
          stroke: ink,
          strokeWidth: Math.max(1.2, e.strokeWidth * 0.8),
          bowing: 0.8,
          disableMultiStroke: e.roughness < 0.3,
        };
        d.push(...drawIcon(gen, e.kind, L.icon, io, accent, fillColor(e.fill === 'none' ? 'gray' : e.fill, theme), paper));
      }
      break;
    }
    case 'arrow':
    case 'line': {
      const path = linearPath(e);
      if (path.length < 2) break;
      const lo: Options = { ...o, fill: undefined };
      if (e.route === 'curve' && e.bend && e.pts) {
        const s = path[0], t = path[path.length - 1];
        const m = path[Math.floor(path.length / 2)];
        d.push(gen.curve([s, m, t] as [number, number][], lo));
      } else d.push(gen.linearPath(path as [number, number][], lo));
      const headSize = 11 + e.strokeWidth * 2.4;
      const n = path.length;
      if (e.endHead && e.endHead !== 'none') d.push(...arrowhead(e.endHead, path[n - 1], tail(path, true), headSize, o));
      if (e.startHead && e.startHead !== 'none') d.push(...arrowhead(e.startHead, path[0], tail(path, false), headSize, o));
      break;
    }
    case 'pen': {
      const pts = e.pts || [];
      const hasPressure = pts.some((p) => p[2] !== undefined && p[2] !== 0.5);
      const outline = getStroke(pts, {
        size: e.strokeWidth * 2.6 + 1.5,
        thinning: 0.6,
        smoothing: 0.55,
        streamline: 0.4,
        simulatePressure: !hasPressure,
        last: true,
      });
      return { key: '', drawables: [], path: new Path2D(svgFromStroke(outline)) };
    }
  }
  return { key: '', drawables: d };
}

/** Point a little before the tip, used to orient the arrowhead. */
function tail(path: number[][], end: boolean) {
  const tip = end ? path[path.length - 1] : path[0];
  const step = end ? -1 : 1;
  let i = end ? path.length - 2 : 1;
  while (i >= 0 && i < path.length) {
    const p = path[i];
    if (Math.hypot(p[0] - tip[0], p[1] - tip[1]) > 14 || i === 0 || i === path.length - 1) return p;
    i += step;
  }
  return path[end ? 0 : path.length - 1];
}

function arrowhead(kind: string, tip: number[], from: number[], size: number, o: Options): Drawable[] {
  const a = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const spread = 0.46;
  const p1: [number, number] = [tip[0] - size * Math.cos(a - spread), tip[1] - size * Math.sin(a - spread)];
  const p2: [number, number] = [tip[0] - size * Math.cos(a + spread), tip[1] - size * Math.sin(a + spread)];
  const t: [number, number] = [tip[0], tip[1]];
  if (kind === 'triangle')
    return [gen.polygon([t, p1, p2], { ...o, fill: o.stroke, fillStyle: 'solid', strokeLineDash: undefined })];
  if (kind === 'dot') return [gen.circle(tip[0], tip[1], size * 0.6, { ...o, fill: o.stroke, fillStyle: 'solid', strokeLineDash: undefined })];
  return [gen.linearPath([p1, t, p2], { ...o, fill: undefined, strokeLineDash: undefined })];
}

function bubblePath(x: number, y: number, w: number, h: number) {
  const r = 12;
  return `M${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x + 44},${y + h} L${x + 22},${y + h + 16} L${x + 26},${y + h} L${x + r},${y + h} Q${x},${y + h} ${x},${y + h - r} L${x},${y + r} Q${x},${y} ${x + r},${y} Z`;
}

function svgFromStroke(points: number[][]) {
  if (!points.length) return '';
  const d = points.reduce(
    (acc: (string | number)[], [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ['M', ...points[0], 'Q'],
  );
  d.push('Z');
  return d.join(' ');
}

function getCached(e: El, theme: Theme): Cached {
  const key = `${e.version}:${theme}:${e.x},${e.y},${e.w},${e.h}`;
  const hit = cache.get(e.id);
  if (hit && hit.key === key) return hit;
  const c = build(e, theme);
  c.key = key;
  cache.set(e.id, c);
  return c;
}

export interface DrawOpts {
  theme: Theme;
  editingId?: string | null;
  byId?: Map<string, El>;
}

export function drawElement(ctx: CanvasRenderingContext2D, rc: RoughCanvas, e: El, opts: DrawOpts) {
  const { theme } = opts;
  ctx.save();
  ctx.globalAlpha = e.opacity ?? 1;
  const c = getCached(e, theme);

  if (e.type === 'note') {
    ctx.save();
    ctx.shadowColor = theme === 'light' ? 'rgba(60,40,0,0.18)' : 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = fillColor(e.fill, theme);
    ctx.beginPath();
    ctx.roundRect(e.x + 3, e.y + 3, e.w - 6, e.h - 6, 4);
    ctx.fill();
    ctx.restore();
  }
  if (e.type === 'comment' && e.target && opts.byId) {
    const t = opts.byId.get(e.target);
    if (t) {
      const from = { x: e.x + 22, y: e.y + e.h + 16 };
      const to = boundaryPoint(t, from, 4);
      rc.draw(gen.line(from.x, from.y, to.x, to.y, { seed: e.seed, stroke: strokeColor('pink', theme), strokeWidth: 1.5, roughness: 1, strokeLineDash: [6, 6] }));
      rc.draw(gen.circle(to.x, to.y, 7, { seed: e.seed, stroke: strokeColor('pink', theme), fill: strokeColor('pink', theme), fillStyle: 'solid', roughness: 0.6 }));
    }
  }

  if (c.path) {
    ctx.fillStyle = strokeColor(e.stroke, theme);
    ctx.fill(c.path);
  } else for (const d of c.drawables) rc.draw(d);

  if (e.type === 'note') {
    // a strip of tape
    ctx.fillStyle = theme === 'light' ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.12)';
    ctx.save();
    ctx.translate(e.x + e.w / 2, e.y + 2);
    ctx.rotate(-0.04);
    ctx.fillRect(-28, -9, 56, 18);
    ctx.restore();
  }

  if (opts.editingId !== e.id) drawLabel(ctx, e, theme, opts);
  ctx.restore();
}

function drawLabel(ctx: CanvasRenderingContext2D, e: El, theme: Theme, opts: DrawOpts) {
  const text = e.label ?? '';
  const ink = strokeColor(e.stroke, theme);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  if (e.type === 'text') {
    if (!text) return;
    ctx.font = fontString(e);
    ctx.fillStyle = ink;
    ctx.textAlign = 'left';
    const lh = lineHeight(e);
    text.split('\n').forEach((l, i) => ctx.fillText(l, e.x + 2, e.y + lh * (i + 0.5)));
    return;
  }
  if (e.type === 'frame') {
    const lbl = text || 'Zone';
    ctx.font = fontString({ fontSize: 16, font: e.font });
    const tw = ctx.measureText(lbl).width + 20;
    ctx.fillStyle = THEME[theme].paper;
    ctx.beginPath();
    ctx.roundRect(e.x + 16, e.y - 13, tw, 26, 13);
    ctx.fill();
    ctx.strokeStyle = strokeColor(e.stroke, theme);
    ctx.lineWidth = 1.4;
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.fillStyle = strokeColor(e.stroke === 'gray' ? 'ink' : e.stroke, theme);
    ctx.fillText(lbl, e.x + 16 + tw / 2, e.y + 1);
    return;
  }
  if (e.type === 'comment') {
    ctx.textAlign = 'left';
    ctx.font = `700 12px ${'"Nunito", system-ui'}`;
    ctx.fillStyle = strokeColor('pink', theme);
    ctx.fillText('INTERVIEWER', e.x + 14, e.y + 16);
    ctx.font = fontString({ fontSize: 17, font: 'hand' });
    ctx.fillStyle = THEME[theme].ink;
    const lines = wrapText(ctx, text, e.w - 28);
    lines.forEach((l, i) => ctx.fillText(l, e.x + 14, e.y + 38 + i * 22));
    return;
  }
  if (!text) return;
  if (e.type === 'arrow' || e.type === 'line') {
    const m = pathMidpoint(linearPath(e));
    ctx.font = fontString({ fontSize: Math.min(e.fontSize ?? 16, 18), font: e.font });
    const lines = text.split('\n');
    const lh = lineHeight({ fontSize: Math.min(e.fontSize ?? 16, 18), font: e.font });
    const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
    ctx.fillStyle = THEME[theme].paper;
    ctx.beginPath();
    ctx.roundRect(m.x - tw / 2 - 6, m.y - (lh * lines.length) / 2 - 2, tw + 12, lh * lines.length + 4, 6);
    ctx.fill();
    ctx.fillStyle = ink;
    lines.forEach((l, i) => ctx.fillText(l, m.x, m.y - (lh * (lines.length - 1)) / 2 + i * lh));
    return;
  }
  ctx.font = fontString(e);
  ctx.fillStyle = e.type === 'note' ? THEME[theme].ink : ink;
  const lh = lineHeight(e);
  let cx = e.x + e.w / 2;
  let cy = e.y + e.h / 2;
  let maxW = e.w - 16;
  if (e.type === 'ellipse' || e.type === 'diamond') maxW = e.w * (e.type === 'diamond' ? 0.6 : 0.72);
  if (e.type === 'component') {
    const L = componentLayout(e);
    cy = L.labelY;
    maxW = e.w - 12;
    if (e.kind === 'external') maxW = e.w * 0.7;
  }
  if (e.type === 'note') {
    ctx.textAlign = 'left';
    const lines = wrapText(ctx, text, e.w - 28);
    lines.forEach((l, i) => ctx.fillText(l, e.x + 14, e.y + 26 + i * lh));
    return;
  }
  const lines = wrapText(ctx, text, maxW);
  const total = lh * lines.length;
  lines.forEach((l, i) => ctx.fillText(l, cx, cy - total / 2 + lh * (i + 0.5)));
}

export function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, cam: { x: number; y: number; zoom: number }, theme: Theme) {
  ctx.fillStyle = THEME[theme].paper;
  ctx.fillRect(0, 0, w, h);
  let gap = 24 * cam.zoom;
  while (gap < 12) gap *= 2;
  const ox = (-cam.x * cam.zoom) % gap;
  const oy = (-cam.y * cam.zoom) % gap;
  ctx.fillStyle = THEME[theme].dot;
  const r = Math.max(0.8, Math.min(1.5, cam.zoom * 1.2));
  for (let x = ox; x < w; x += gap) for (let y = oy; y < h; y += gap) {
    ctx.fillRect(x - r / 2, y - r / 2, r, r);
  }
}

/** Render a list of elements into a fresh canvas (export / AI snapshot / previews). */
export function renderToCanvas(elements: El[], theme: Theme, opts: { padding?: number; scale?: number; maxSize?: number; background?: boolean } = {}) {
  const pad = opts.padding ?? 40;
  const boxes = elements.map((e) => {
    if (e.type === 'arrow' || e.type === 'line' || e.type === 'pen') {
      const p = e.type === 'pen' ? e.pts! : linearPath(e);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const q of p) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    return { x: e.x, y: e.y - (e.type === 'frame' ? 14 : 0), w: e.w, h: e.h + (e.type === 'comment' ? 20 : 0) };
  });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  if (!isFinite(x0)) { x0 = 0; y0 = 0; x1 = 400; y1 = 300; }
  const W = x1 - x0 + pad * 2, H = y1 - y0 + pad * 2;
  let scale = opts.scale ?? 2;
  if (opts.maxSize) scale = Math.min(scale, opts.maxSize / Math.max(W, H));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(W * scale);
  canvas.height = Math.ceil(H * scale);
  const ctx = canvas.getContext('2d')!;
  if (opts.background !== false) {
    ctx.fillStyle = THEME[theme].paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.setTransform(scale, 0, 0, scale, (pad - x0) * scale, (pad - y0) * scale);
  const rc = rough.canvas(canvas);
  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const e of elements) drawElement(ctx, rc, e, { theme, byId });
  return canvas;
}

export { componentLayout, center };
