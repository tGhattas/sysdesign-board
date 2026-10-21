import type { El } from '../../shared/types';
import { CATALOG_BY_KIND } from '../../shared/catalog';
import { elBox, center, type Box } from '../../shared/geometry';

const SHAPES = new Set(['rect', 'ellipse', 'diamond', 'component', 'note', 'text', 'frame']);

export function nameOf(e: El): string {
  const label = (e.label || '').replace(/\s+/g, ' ').trim();
  if (e.type === 'component') {
    const kind = CATALOG_BY_KIND[e.kind!]?.name ?? e.kind;
    return label && label !== kind ? `${label} (${kind})` : kind!;
  }
  if (label) return `"${label}"`;
  return `unlabeled ${e.type}`;
}

function baseName(e: El) {
  return (e.label || '').replace(/\s+/g, ' ').trim() || (e.type === 'component' ? CATALOG_BY_KIND[e.kind!]?.name ?? e.kind! : `${e.type}#${e.id.slice(0, 4)}`);
}

const contains = (o: Box, b: Box) => b.x >= o.x && b.y >= o.y && b.x + b.w <= o.x + o.w && b.y + b.h <= o.y + o.h;

/** Nearest shape to an unbound arrow endpoint, so loose arrows still read as connections. */
function nearest(p: number[], shapes: El[], max = 60): El | null {
  let best: El | null = null, bd = max;
  for (const s of shapes) {
    const dx = Math.max(s.x - p[0], 0, p[0] - (s.x + s.w));
    const dy = Math.max(s.y - p[1], 0, p[1] - (s.y + s.h));
    const d = Math.hypot(dx, dy);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

export interface Connection {
  id: string;
  from: string | null;
  to: string | null;
  fromName: string;
  toName: string;
  label?: string;
  style: string;
  bidirectional: boolean;
  inferred: boolean;
}

export function analyze(elements: El[]) {
  const live = elements.filter((e) => !(e.type === 'comment' && e.resolved));
  // same label on several shapes ("App Server" x3): tag them with ids so the AI can tell them apart
  const counts = new Map<string, number>();
  for (const e of live) if (e.type !== 'arrow' && e.type !== 'line' && e.type !== 'pen') counts.set(baseName(e), (counts.get(baseName(e)) ?? 0) + 1);
  const shortName = (e: El) => (counts.get(baseName(e))! > 1 ? `${baseName(e)} [${e.id}]` : baseName(e));
  const byId = new Map(live.map((e) => [e.id, e]));
  const shapes = live.filter((e) => SHAPES.has(e.type) && e.type !== 'frame' && e.type !== 'text');
  const frames = live.filter((e) => e.type === 'frame');
  const connections: Connection[] = [];
  for (const a of live) {
    if (a.type !== 'arrow' && a.type !== 'line') continue;
    const pts = a.pts || [];
    if (pts.length < 2) continue;
    let A = a.start ? byId.get(a.start.id) ?? null : null;
    let B = a.end ? byId.get(a.end.id) ?? null : null;
    let inferred = false;
    if (!A) { A = nearest(pts[0], shapes); inferred ||= !!A; }
    if (!B) { B = nearest(pts[pts.length - 1], shapes); inferred ||= !!B; }
    // arrow only has a head at the start: flip so "from → to" reads naturally
    let flip = a.type === 'arrow' && a.startHead !== 'none' && (a.endHead ?? 'none') === 'none';
    if (flip) [A, B] = [B, A];
    connections.push({
      id: a.id,
      from: A?.id ?? null,
      to: B?.id ?? null,
      fromName: A ? shortName(A) : 'nothing',
      toName: B ? shortName(B) : 'nothing',
      label: a.label?.trim() || undefined,
      style: a.strokeStyle === 'solid' ? 'solid' : `${a.strokeStyle} (often means async)`,
      bidirectional: a.type === 'line' || (a.startHead !== 'none' && a.endHead !== 'none'),
      inferred,
    });
  }
  return { live, byId, shapes, frames, connections, shortName };
}

export function describeBoard(elements: El[]) {
  const { live, frames, connections, shortName } = analyze(elements);
  const comps = live.filter((e) => e.type === 'component');
  const boxes = live.filter((e) => e.type === 'rect' || e.type === 'ellipse' || e.type === 'diamond');
  const notes = live.filter((e) => e.type === 'note');
  const texts = live.filter((e) => e.type === 'text' && e.label?.trim());
  const pens = live.filter((e) => e.type === 'pen');
  const comments = live.filter((e) => e.type === 'comment');
  const zoneOf = (e: El) =>
    frames.filter((f) => f.id !== e.id && contains(f, elBox(e))).map((f) => f.label || 'zone');

  const L: string[] = [];
  L.push(
    `Board: ${comps.length} components, ${boxes.length} shapes, ${connections.length} connections, ${notes.length} sticky notes, ${texts.length} text labels, ${frames.length} zones, ${pens.length} freehand strokes.`,
  );
  if (!live.length) {
    L.push('The board is empty — the candidate has not drawn anything yet.');
    return L.join('\n');
  }
  const pos = (e: El) => {
    const c = center(e);
    return `@(${Math.round(c.x)},${Math.round(c.y)})`;
  };
  if (comps.length || boxes.length) {
    L.push('', 'Building blocks:');
    for (const e of [...comps, ...boxes].sort((a, b) => a.x - b.x || a.y - b.y)) {
      const z = zoneOf(e);
      L.push(`- [${e.id}] ${nameOf(e)}${e.type !== 'component' ? ` — ${e.type}` : ''} ${pos(e)}${z.length ? ` in ${z.join(' > ')}` : ''}`);
    }
  }
  if (connections.length) {
    L.push('', 'Connections:');
    for (const c of connections) {
      const arrow = c.bidirectional ? '<->' : '->';
      L.push(
        `- ${c.fromName} ${arrow} ${c.toName}${c.label ? ` [${c.label}]` : ''}${c.style !== 'solid' ? ` (${c.style})` : ''}${c.inferred ? ' (endpoint not attached; inferred by proximity)' : ''}`,
      );
    }
  }
  if (frames.length) {
    L.push('', 'Zones / boundaries:');
    for (const f of frames) {
      const inside = live.filter((e) => e.id !== f.id && (e.type === 'component' || e.type === 'rect') && contains(f, elBox(e)));
      L.push(`- [${f.id}] "${f.label || 'zone'}" contains: ${inside.map(shortName).join(', ') || 'nothing'}`);
    }
  }
  if (notes.length || texts.length) {
    L.push('', 'Written notes:');
    for (const n of [...notes, ...texts].sort((a, b) => a.y - b.y)) L.push(`- ${n.type === 'note' ? 'sticky' : 'text'} ${pos(n)}: "${(n.label || '').replace(/\n/g, ' / ')}"`);
  }
  if (comments.length) {
    L.push('', 'Your open interviewer comments:');
    for (const c of comments) L.push(`- [${c.id}] on ${c.target && live.find((e) => e.id === c.target) ? shortName(live.find((e) => e.id === c.target)!) : 'board'}: "${c.label}"`);
  }
  if (pens.length) {
    const b = pens.map(elBox);
    L.push('', `Freehand: ${pens.length} pen strokes (handwriting or sketches) — call get_board_image to see what they say/draw. Rough area: x ${Math.round(Math.min(...b.map((q) => q.x)))}–${Math.round(Math.max(...b.map((q) => q.x + q.w)))}, y ${Math.round(Math.min(...b.map((q) => q.y)))}–${Math.round(Math.max(...b.map((q) => q.y + q.h)))}.`);
  }
  return L.join('\n');
}

type Sig = { name: string; kind: string };

/** Lightweight fingerprint of the board so we can tell the AI what changed since it last looked. */
export function fingerprint(elements: El[]) {
  const { live, connections, shortName } = analyze(elements);
  const nodes = new Map<string, Sig>();
  for (const e of live) if (e.type !== 'arrow' && e.type !== 'line' && e.type !== 'pen' && e.type !== 'comment') nodes.set(e.id, { name: shortName(e), kind: e.type === 'component' ? e.kind! : e.type });
  const edges = new Map<string, string>();
  for (const c of connections) edges.set(c.id, `${c.fromName} -> ${c.toName}${c.label ? ` [${c.label}]` : ''}`);
  const pens = live.filter((e) => e.type === 'pen').length;
  return { nodes, edges, pens };
}

export type Fingerprint = ReturnType<typeof fingerprint>;

export function diffBoards(prev: Fingerprint | null, next: Fingerprint): string[] {
  if (!prev) return [];
  const out: string[] = [];
  for (const [id, n] of next.nodes) {
    const p = prev.nodes.get(id);
    if (!p) out.push(`added ${n.kind === 'text' || n.kind === 'note' ? n.kind : ''} "${n.name}"`.replace('  ', ' '));
    else if (p.name !== n.name) out.push(`renamed "${p.name}" to "${n.name}"`);
  }
  for (const [id, n] of prev.nodes) if (!next.nodes.has(id)) out.push(`removed "${n.name}"`);
  for (const [id, e] of next.edges) {
    const p = prev.edges.get(id);
    if (!p) out.push(`connected ${e}`);
    else if (p !== e) out.push(`rewired ${p} => ${e}`);
  }
  for (const [id, e] of prev.edges) if (!next.edges.has(id)) out.push(`removed connection ${e}`);
  if (next.pens !== prev.pens) out.push(`${next.pens > prev.pens ? 'drew' : 'erased'} ${Math.abs(next.pens - prev.pens)} freehand stroke(s)`);
  return out;
}
