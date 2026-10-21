import type { El } from './types';

export type Pt = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

export const isLinear = (e: El) => e.type === 'arrow' || e.type === 'line';
export const isBindable = (e: El) =>
  e.type === 'rect' || e.type === 'ellipse' || e.type === 'diamond' || e.type === 'component' || e.type === 'note' || e.type === 'text';

export const center = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

export function boundsOfPts(pts: number[][]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0];
    if (p[1] > y1) y1 = p[1];
  }
  if (!isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function unionBox(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Bounding box of an element, including the rendered path of arrows. */
export function elBox(e: El): Box {
  if ((isLinear(e) || e.type === 'pen') && e.pts?.length) {
    return boundsOfPts(isLinear(e) ? linearPath(e) : e.pts);
  }
  return { x: e.x, y: e.y, w: e.w, h: e.h };
}

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function distToSegment(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (!l2) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Point where a ray from the element's center toward `toward` exits its outline (plus a gap). */
export function boundaryPoint(e: El, toward: Pt, gap = 6): Pt {
  const c = center(e);
  let dx = toward.x - c.x, dy = toward.y - c.y;
  if (!dx && !dy) dy = 1;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  const hw = e.w / 2, hh = e.h / 2;
  let t: number;
  if (e.type === 'ellipse') {
    t = 1 / Math.sqrt((ux * ux) / (hw * hw) + (uy * uy) / (hh * hh));
  } else if (e.type === 'diamond') {
    t = 1 / (Math.abs(ux) / hw + Math.abs(uy) / hh);
  } else {
    const tx = ux ? hw / Math.abs(ux) : Infinity;
    const ty = uy ? hh / Math.abs(uy) : Infinity;
    t = Math.min(tx, ty);
  }
  t += gap;
  return { x: c.x + ux * t, y: c.y + uy * t };
}

/** Mid control point of a (possibly bent) arrow. */
export function bendPoint(a: Pt, b: Pt, bend: number): Pt {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: mx - (dy / len) * bend, y: my + (dx / len) * bend };
}

/** The polyline actually drawn for a linear element (curve gets sampled). */
export function linearPath(e: El): number[][] {
  const pts = e.pts || [];
  if (pts.length < 2) return pts;
  const s = { x: pts[0][0], y: pts[0][1] };
  const t = { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] };
  const route = e.route || 'straight';
  if (route === 'elbow') {
    const dx = t.x - s.x, dy = t.y - s.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const mx = s.x + dx / 2;
      return [[s.x, s.y], [mx, s.y], [mx, t.y], [t.x, t.y]];
    }
    const my = s.y + dy / 2;
    return [[s.x, s.y], [s.x, my], [t.x, my], [t.x, t.y]];
  }
  if (route === 'curve' && e.bend) {
    const m = bendPoint(s, t, e.bend);
    // quadratic through m: control = 2m - (s+t)/2
    const cx = 2 * m.x - (s.x + t.x) / 2, cy = 2 * m.y - (s.y + t.y) / 2;
    const out: number[][] = [];
    const N = 24;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
      out.push([a * s.x + b * cx + c * t.x, a * s.y + b * cy + c * t.y]);
    }
    return out;
  }
  return [[s.x, s.y], [t.x, t.y]];
}

export function pathMidpoint(path: number[][]): Pt {
  if (path.length < 2) return { x: path[0]?.[0] ?? 0, y: path[0]?.[1] ?? 0 };
  let total = 0;
  const segs: number[] = [];
  for (let i = 1; i < path.length; i++) {
    const l = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    segs.push(l);
    total += l;
  }
  let half = total / 2;
  for (let i = 0; i < segs.length; i++) {
    if (half <= segs[i]) {
      const u = segs[i] ? half / segs[i] : 0;
      return {
        x: path[i][0] + (path[i + 1][0] - path[i][0]) * u,
        y: path[i][1] + (path[i + 1][1] - path[i][1]) * u,
      };
    }
    half -= segs[i];
  }
  const l = path[path.length - 1];
  return { x: l[0], y: l[1] };
}

/** Elbow arrows attach to the side midpoint facing the other end. */
function sidePoint(e: El, other: Pt, horizontal: boolean, gap = 6): Pt {
  const c = center(e);
  if (horizontal) return { x: other.x >= c.x ? e.x + e.w + gap : e.x - gap, y: c.y };
  return { x: c.x, y: other.y >= c.y ? e.y + e.h + gap : e.y - gap };
}

/** Recompute endpoints of an arrow from its bindings. Returns new pts (or the same array). */
export function routeArrow(a: El, byId: Map<string, El>): number[][] {
  const pts = a.pts || [];
  if (pts.length < 2) return pts;
  const A = a.start ? byId.get(a.start.id) : undefined;
  const B = a.end ? byId.get(a.end.id) : undefined;
  if (!A && !B) return pts;
  let s = { x: pts[0][0], y: pts[0][1] };
  let t = { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] };
  const aC = A ? center(A) : s;
  const bC = B ? center(B) : t;
  if (a.route === 'elbow') {
    const horizontal = Math.abs(bC.x - aC.x) >= Math.abs(bC.y - aC.y);
    if (A) s = sidePoint(A, bC, horizontal);
    if (B) t = sidePoint(B, aC, horizontal);
  } else if (a.route === 'curve' && a.bend) {
    const m = bendPoint(aC, bC, a.bend);
    if (A) s = boundaryPoint(A, m);
    if (B) t = boundaryPoint(B, m);
  } else {
    if (A) s = boundaryPoint(A, bC);
    if (B) t = boundaryPoint(B, aC);
  }
  return [[s.x, s.y], [t.x, t.y]];
}

export function syncLinearBox(e: El): El {
  if (!e.pts?.length) return e;
  const b = boundsOfPts(e.pts);
  return { ...e, x: b.x, y: b.y, w: b.w, h: b.h };
}

/** Update every arrow bound to one of `changed` (or all, when changed is null). */
export function rebindArrows(elements: El[], changed: Set<string> | null): El[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  let touched = false;
  const out = elements.map((e) => {
    if (e.type !== 'arrow' && e.type !== 'line') return e;
    if (!e.start && !e.end) return e;
    if (changed && !(e.start && changed.has(e.start.id)) && !(e.end && changed.has(e.end.id)) && !changed.has(e.id)) return e;
    // drop dangling bindings
    const start = e.start && byId.has(e.start.id) ? e.start : null;
    const end = e.end && byId.has(e.end.id) ? e.end : null;
    const next = { ...e, start, end };
    const pts = routeArrow(next, byId);
    touched = true;
    return syncLinearBox({ ...next, pts, version: e.version + 1 });
  });
  return touched ? out : elements;
}
