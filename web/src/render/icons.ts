import type { RoughGenerator } from 'roughjs/bin/generator';
import type { Drawable, Options } from 'roughjs/bin/core';
import type { ComponentKind } from '../../../shared/types';

export type IconBox = { x: number; y: number; w: number; h: number };

/**
 * Tiny drawing kit in a unit box (0..1). Every glyph is generated with rough.js so it
 * shares the same pencil wobble as the rest of the board.
 */
function kit(gen: RoughGenerator, b: IconBox, o: Options, accentFill: string, paper: string) {
  const X = (u: number) => b.x + u * b.w;
  const Y = (v: number) => b.y + v * b.h;
  const out: Drawable[] = [];
  const f = (fill?: 'accent' | 'paper') =>
    fill ? { ...o, fill: fill === 'accent' ? accentFill : paper, fillStyle: 'solid' as const } : o;
  return {
    out,
    line: (u1: number, v1: number, u2: number, v2: number, extra: Options = {}) =>
      out.push(gen.line(X(u1), Y(v1), X(u2), Y(v2), { ...o, ...extra })),
    rect: (u: number, v: number, w: number, h: number, fill?: 'accent' | 'paper') =>
      out.push(gen.rectangle(X(u), Y(v), w * b.w, h * b.h, f(fill))),
    rrect: (u: number, v: number, w: number, h: number, r: number, fill?: 'accent' | 'paper') =>
      out.push(gen.path(roundedRectPath(X(u), Y(v), w * b.w, h * b.h, r * Math.min(b.w, b.h)), f(fill))),
    circle: (u: number, v: number, d: number, fill?: 'accent' | 'paper') =>
      out.push(gen.ellipse(X(u), Y(v), d * b.w, d * b.h, f(fill))),
    ellipse: (u: number, v: number, w: number, h: number, fill?: 'accent' | 'paper') =>
      out.push(gen.ellipse(X(u), Y(v), w * b.w, h * b.h, f(fill))),
    poly: (pts: number[][], fill?: 'accent' | 'paper') =>
      out.push(gen.polygon(pts.map(([u, v]) => [X(u), Y(v)] as [number, number]), f(fill))),
    lpath: (pts: number[][], extra: Options = {}) =>
      out.push(gen.linearPath(pts.map(([u, v]) => [X(u), Y(v)] as [number, number]), { ...o, ...extra })),
    curve: (pts: number[][], extra: Options = {}) =>
      out.push(gen.curve(pts.map(([u, v]) => [X(u), Y(v)] as [number, number]), { ...o, ...extra })),
    arc: (u: number, v: number, w: number, h: number, a0: number, a1: number, extra: Options = {}) =>
      out.push(gen.arc(X(u), Y(v), w * b.w, h * b.h, a0, a1, false, { ...o, ...extra })),
  };
}

export function roundedRectPath(x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x + r},${y + h} Q${x},${y + h} ${x},${y + h - r} L${x},${y + r} Q${x},${y} ${x + r},${y} Z`;
}

/** Wide icons (queues/streams) use a non-square box. */
export const WIDE_ICON: Partial<Record<ComponentKind, boolean>> = { queue: true, stream: true };

export function drawIcon(
  gen: RoughGenerator,
  kind: ComponentKind,
  box: IconBox,
  o: Options,
  accent: string,
  accentFill: string,
  paper: string,
): Drawable[] {
  const k = kit(gen, box, o, accentFill, paper);
  const A: Options = { stroke: accent };
  switch (kind) {
    case 'user':
      k.circle(0.5, 0.25, 0.36, 'accent');
      k.curve([[0.1, 0.98], [0.17, 0.68], [0.5, 0.54], [0.83, 0.68], [0.9, 0.98]]);
      k.line(0.1, 0.98, 0.9, 0.98);
      break;
    case 'browser':
      k.rrect(0, 0.1, 1, 0.8, 0.08, 'paper');
      k.line(0, 0.3, 1, 0.3);
      for (const u of [0.09, 0.18, 0.27]) k.circle(u, 0.2, 0.06, 'accent');
      k.line(0.14, 0.5, 0.62, 0.5, A);
      k.line(0.14, 0.66, 0.84, 0.66);
      k.line(0.14, 0.78, 0.5, 0.78);
      break;
    case 'mobile':
      k.rrect(0.26, 0, 0.48, 1, 0.1, 'paper');
      k.line(0.42, 0.08, 0.58, 0.08);
      k.rrect(0.33, 0.17, 0.34, 0.6, 0.03);
      k.circle(0.5, 0.88, 0.07, 'accent');
      break;
    case 'dns':
      k.line(0.5, 0.06, 0.5, 1);
      k.poly([[0.16, 0.14], [0.74, 0.14], [0.9, 0.27], [0.74, 0.4], [0.16, 0.4]], 'accent');
      k.poly([[0.84, 0.5], [0.26, 0.5], [0.1, 0.63], [0.26, 0.76], [0.84, 0.76]], 'paper');
      k.line(0.36, 1, 0.64, 1);
      break;
    case 'cdn':
      k.circle(0.5, 0.5, 0.94, 'paper');
      k.ellipse(0.5, 0.5, 0.42, 0.94);
      k.line(0.03, 0.5, 0.97, 0.5);
      k.curve([[0.12, 0.26], [0.5, 0.33], [0.88, 0.26]]);
      k.curve([[0.12, 0.74], [0.5, 0.67], [0.88, 0.74]]);
      k.circle(0.78, 0.2, 0.14, 'accent');
      break;
    case 'lb':
      k.circle(0.14, 0.5, 0.24, 'accent');
      for (const v of [0.14, 0.5, 0.86]) {
        k.line(0.26, 0.5, 0.74, v, A);
        k.circle(0.86, v, 0.2, 'paper');
      }
      break;
    case 'gateway':
      k.poly([[0.26, 0.06], [0.74, 0.06], [0.98, 0.5], [0.74, 0.94], [0.26, 0.94], [0.02, 0.5]], 'paper');
      k.line(0.2, 0.5, 0.78, 0.5, { ...A, strokeWidth: (o.strokeWidth ?? 2) * 1.3 });
      k.lpath([[0.6, 0.34], [0.8, 0.5], [0.6, 0.66]], A);
      break;
    case 'firewall':
      k.rect(0, 0.12, 1, 0.76, 'paper');
      k.line(0, 0.37, 1, 0.37);
      k.line(0, 0.63, 1, 0.63);
      for (const u of [0.33, 0.66]) k.line(u, 0.12, u, 0.37);
      for (const u of [0.17, 0.5, 0.83]) k.line(u, 0.37, u, 0.63);
      for (const u of [0.33, 0.66]) k.line(u, 0.63, u, 0.88);
      k.rect(0.33, 0.12, 0.33, 0.25, 'accent');
      break;
    case 'server':
      for (let i = 0; i < 3; i++) {
        const v = 0.03 + i * 0.33;
        k.rrect(0.04, v, 0.92, 0.27, 0.05, 'paper');
        k.line(0.14, v + 0.135, 0.46, v + 0.135);
        k.circle(0.8, v + 0.135, 0.08, i === 0 ? 'accent' : undefined);
      }
      break;
    case 'service':
      k.poly([[0.5, 0.03], [0.93, 0.27], [0.93, 0.73], [0.5, 0.97], [0.07, 0.73], [0.07, 0.27]], 'paper');
      k.poly([[0.5, 0.03], [0.93, 0.27], [0.5, 0.5], [0.07, 0.27]], 'accent');
      k.line(0.5, 0.5, 0.5, 0.97);
      break;
    case 'worker': {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        k.line(0.5 + Math.cos(a) * 0.3, 0.5 + Math.sin(a) * 0.3, 0.5 + Math.cos(a) * 0.47, 0.5 + Math.sin(a) * 0.47, {
          strokeWidth: (o.strokeWidth ?? 2) * 2.6,
        });
      }
      k.circle(0.5, 0.5, 0.68, 'paper');
      k.circle(0.5, 0.5, 0.24, 'accent');
      break;
    }
    case 'lambda':
      k.rrect(0.04, 0.04, 0.92, 0.92, 0.18, 'paper');
      k.lpath([[0.26, 0.2], [0.42, 0.2], [0.76, 0.82]], { ...A, strokeWidth: (o.strokeWidth ?? 2) * 1.5 });
      k.line(0.54, 0.44, 0.26, 0.82, { ...A, strokeWidth: (o.strokeWidth ?? 2) * 1.5 });
      break;
    case 'cron':
      k.circle(0.5, 0.54, 0.86, 'paper');
      k.line(0.5, 0.54, 0.5, 0.26, { strokeWidth: (o.strokeWidth ?? 2) * 1.3 });
      k.line(0.5, 0.54, 0.7, 0.66, A);
      k.circle(0.5, 0.54, 0.07, 'accent');
      k.line(0.18, 0.12, 0.3, 0.04);
      k.line(0.82, 0.12, 0.7, 0.04);
      break;
    case 'sql':
      k.rect(0.08, 0.1, 0.84, 0.8, 'paper');
      k.rect(0.08, 0.1, 0.84, 0.22, 'accent');
      k.line(0.08, 0.56, 0.92, 0.56);
      k.line(0.4, 0.1, 0.4, 0.9);
      break;
    case 'nosql':
      k.curve([[0.36, 0.06], [0.22, 0.16], [0.24, 0.42], [0.08, 0.5], [0.24, 0.58], [0.22, 0.84], [0.36, 0.94]]);
      k.curve([[0.64, 0.06], [0.78, 0.16], [0.76, 0.42], [0.92, 0.5], [0.76, 0.58], [0.78, 0.84], [0.64, 0.94]]);
      k.circle(0.5, 0.36, 0.14, 'accent');
      k.circle(0.5, 0.64, 0.14, 'accent');
      break;
    case 'cache':
      k.poly([[0.6, 0.02], [0.18, 0.56], [0.46, 0.56], [0.36, 0.98], [0.84, 0.4], [0.55, 0.4], [0.66, 0.02]], 'accent');
      break;
    case 'storage':
      for (let i = 0; i < 3; i++) k.rrect(0.14 + i * 0.1, 0.08 + i * 0.1, 0.52, 0.62, 0.06, i === 2 ? 'accent' : 'paper');
      break;
    case 'search':
      k.circle(0.42, 0.42, 0.62, 'paper');
      k.arc(0.42, 0.42, 0.42, 0.42, Math.PI * 1.05, Math.PI * 1.55, A);
      k.line(0.64, 0.64, 0.94, 0.94, { strokeWidth: (o.strokeWidth ?? 2) * 2.4 });
      break;
    case 'warehouse':
      k.line(0.06, 0.18, 0.06, 0.84);
      k.line(0.94, 0.18, 0.94, 0.84);
      for (const v of [0.4, 0.62, 0.84]) k.arc(0.5, v, 0.88, 0.26, 0, Math.PI);
      k.ellipse(0.5, 0.18, 0.88, 0.26, 'accent');
      break;
    case 'queue':
      k.rrect(0, 0.08, 1, 0.84, 0.18, 'paper');
      for (const u of [0.46, 0.62, 0.78]) k.rect(u, 0.24, 0.12, 0.52, 'accent');
      k.lpath([[0.08, 0.5], [0.34, 0.5]], A);
      k.lpath([[0.27, 0.32], [0.36, 0.5], [0.27, 0.68]], A);
      break;
    case 'stream':
      for (let i = 0; i < 3; i++) {
        const v = 0.02 + i * 0.34;
        k.rect(0, v, 1, 0.26, 'paper');
        const n = 3 + ((i * 2) % 3);
        for (let j = 0; j < n; j++) k.line(0.12 * (j + 1), v, 0.12 * (j + 1), v + 0.26);
        k.rect(0.12 * n, v, 0.12, 0.26, 'accent');
      }
      break;
    case 'pubsub':
      k.line(0.02, 0.5, 0.2, 0.5);
      k.circle(0.32, 0.5, 0.26, 'accent');
      k.arc(0.32, 0.5, 0.62, 0.62, -0.95, 0.95, A);
      k.arc(0.32, 0.5, 0.98, 0.98, -0.85, 0.85);
      k.arc(0.32, 0.5, 1.34, 1.34, -0.75, 0.75, A);
      break;
    case 'notify':
      k.curve([[0.18, 0.76], [0.28, 0.62], [0.27, 0.4], [0.5, 0.14], [0.73, 0.4], [0.72, 0.62], [0.82, 0.76]]);
      k.line(0.12, 0.76, 0.88, 0.76);
      k.circle(0.5, 0.88, 0.14, 'accent');
      k.line(0.5, 0.04, 0.5, 0.14);
      k.circle(0.84, 0.18, 0.18, 'accent');
      break;
    case 'monitor':
      k.rrect(0, 0.04, 1, 0.78, 0.06, 'paper');
      k.lpath([[0.1, 0.62], [0.3, 0.42], [0.46, 0.54], [0.66, 0.22], [0.9, 0.34]], { ...A, strokeWidth: (o.strokeWidth ?? 2) * 1.3 });
      k.line(0.36, 0.96, 0.64, 0.96);
      k.line(0.5, 0.82, 0.5, 0.96);
      break;
    case 'auth':
      k.arc(0.5, 0.44, 0.46, 0.66, Math.PI, Math.PI * 2, { strokeWidth: (o.strokeWidth ?? 2) * 1.4 });
      k.line(0.27, 0.44, 0.27, 0.48);
      k.line(0.73, 0.44, 0.73, 0.48);
      k.rrect(0.14, 0.46, 0.72, 0.5, 0.08, 'accent');
      k.circle(0.5, 0.66, 0.12, 'paper');
      k.line(0.5, 0.7, 0.5, 0.84);
      break;
    case 'ml': {
      const L = [
        [0.12, [0.28, 0.72]],
        [0.5, [0.14, 0.5, 0.86]],
        [0.88, [0.5]],
      ] as const;
      for (let i = 0; i < L.length - 1; i++)
        for (const v1 of L[i][1]) for (const v2 of L[i + 1][1]) k.line(L[i][0], v1, L[i + 1][0], v2, { strokeWidth: (o.strokeWidth ?? 2) * 0.7 });
      for (const [u, vs] of L) for (const v of vs) k.circle(u, v, 0.2, u === 0.5 ? 'accent' : 'paper');
      break;
    }
    default:
      break;
  }
  return k.out;
}
