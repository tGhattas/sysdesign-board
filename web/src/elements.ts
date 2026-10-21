import type { El, ElType, ComponentKind, FillStyle, StrokeStyle, FontFamily, Arrowhead, Route } from '../../shared/types';
import { CATALOG_BY_KIND } from '../../shared/catalog';

export const uid = () => Math.random().toString(36).slice(2, 10);
export const randSeed = () => Math.floor(Math.random() * 2 ** 31);

export interface Style {
  stroke: string;
  fill: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  roughness: number;
  opacity: number;
  fontSize: number;
  font: FontFamily;
  route: Route;
  startHead: Arrowhead;
  endHead: Arrowhead;
}

export const DEFAULT_STYLE: Style = {
  stroke: 'ink',
  fill: 'none',
  fillStyle: 'hachure',
  strokeWidth: 2,
  strokeStyle: 'solid',
  roughness: 1,
  opacity: 1,
  fontSize: 20,
  font: 'hand',
  route: 'straight',
  startHead: 'none',
  endHead: 'arrow',
};

export function makeEl(type: ElType, x: number, y: number, style: Style, extra: Partial<El> = {}): El {
  const base: El = {
    id: uid(),
    type,
    x,
    y,
    w: 0,
    h: 0,
    stroke: style.stroke,
    fill: style.fill,
    fillStyle: style.fillStyle,
    strokeWidth: style.strokeWidth,
    strokeStyle: style.strokeStyle,
    roughness: style.roughness,
    opacity: style.opacity,
    seed: randSeed(),
    version: 1,
    fontSize: style.fontSize,
    font: style.font,
  };
  if (type === 'arrow' || type === 'line') {
    Object.assign(base, {
      route: style.route,
      startHead: type === 'arrow' ? style.startHead : 'none',
      endHead: type === 'arrow' ? style.endHead : 'none',
      pts: [[x, y], [x, y]],
      bend: 0,
    });
  }
  if (type === 'note') Object.assign(base, { fill: 'yellow', fillStyle: 'solid', font: 'marker', stroke: 'ink', w: 180, h: 150, label: '' });
  if (type === 'frame') Object.assign(base, { fill: 'none', strokeStyle: 'dashed', label: 'Zone', stroke: 'gray' });
  return { ...base, ...extra };
}

export function makeComponent(kind: ComponentKind, cx: number, cy: number, style: Style, extra: Partial<El> = {}): El {
  const c = CATALOG_BY_KIND[kind];
  const w = c?.w ?? 140, h = c?.h ?? 110;
  return makeEl('component', cx - w / 2, cy - h / 2, style, {
    kind,
    w,
    h,
    label: c?.name ?? kind,
    fill: c?.color ?? 'gray',
    fillStyle: 'hachure',
    stroke: 'ink',
    strokeStyle: 'solid',
    fontSize: 18,
    ...extra,
  });
}

export const FONT_CSS: Record<FontFamily, string> = {
  hand: '"Kalam", "Comic Sans MS", cursive',
  marker: '"Caveat", "Kalam", cursive',
  clean: '"Nunito", system-ui, sans-serif',
};

export function fontString(e: { fontSize?: number; font?: FontFamily }, scale = 1) {
  const fam = e.font ?? 'hand';
  const size = (e.fontSize ?? 20) * (fam === 'marker' ? 1.25 : 1) * scale;
  const weight = fam === 'clean' ? 600 : fam === 'marker' ? 600 : 400;
  return `${weight} ${size}px ${FONT_CSS[fam]}`;
}

export const lineHeight = (e: { fontSize?: number; font?: FontFamily }) =>
  (e.fontSize ?? 20) * (e.font === 'marker' ? 1.25 : 1) * 1.3;

let measureCtx: CanvasRenderingContext2D | null = null;
export function measureText(text: string, e: { fontSize?: number; font?: FontFamily }) {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  measureCtx.font = fontString(e);
  const lines = text.split('\n');
  const w = Math.max(8, ...lines.map((l) => measureCtx!.measureText(l || ' ').width));
  return { w: Math.ceil(w) + 4, h: Math.ceil(lines.length * lineHeight(e)) };
}

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/);
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) {
        out.push(line);
        line = w;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}
