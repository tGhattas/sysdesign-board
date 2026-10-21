import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { El, Session, ChatMsg, ClientMsg, ServerMsg, Phase, Feedback, ComponentKind } from '../../shared/types';
import { PHASES } from '../../shared/types';
import { CATALOG, CATALOG_BY_KIND } from '../../shared/catalog';
import { rebindArrows, elBox, unionBox, center } from '../../shared/geometry';
import { describeBoard, fingerprint, diffBoards, type Fingerprint } from './summary';

export const APP_ID = 'sysdesign-board';
const log = (...a: unknown[]) => console.error('[sysdesign]', ...a);
const uid = () => Math.random().toString(36).slice(2, 10);
const seed = () => Math.floor(Math.random() * 2 ** 31);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface DrawSpec {
  components?: { ref?: string; kind: string; label?: string; x?: number; y?: number }[];
  connections?: { from: string; to: string; label?: string; dashed?: boolean; bidirectional?: boolean }[];
  notes?: { text: string; x?: number; y?: number; near?: string }[];
  zones?: { label: string; contains: string[] }[];
}

/** Everything the MCP tools need. Implemented by the Hub itself or proxied over HTTP to a running hub. */
export interface BoardApi {
  status(): Promise<any>;
  openBoard(): Promise<any>;
  startInterview(p: { title: string; problem: string; level?: string; durationMin?: number; clearBoard?: boolean; opening?: string }): Promise<any>;
  getBoard(p: { includeJson?: boolean }): Promise<any>;
  getImage(): Promise<any>;
  waitForCandidate(p: { timeoutSec?: number }): Promise<any>;
  say(p: { text: string; speak?: boolean }): Promise<any>;
  annotate(p: { text: string; target?: string; x?: number; y?: number }): Promise<any>;
  highlight(p: { targets: string[]; seconds?: number; focus?: boolean }): Promise<any>;
  draw(p: DrawSpec): Promise<any>;
  clearAnnotations(p: { ids?: string[] }): Promise<any>;
  setPhase(p: { phase: Phase }): Promise<any>;
  endInterview(p: Feedback): Promise<any>;
  transcript(): Promise<any>;
}

const STATE_DIR = path.join(os.homedir(), '.sysdesign-board');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

function webDist() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, '../../web/dist'), path.resolve(here, '../web/dist'), path.resolve(process.cwd(), 'web/dist')];
  return candidates.find((p) => fs.existsSync(path.join(p, 'index.html'))) ?? candidates[0];
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
};

export class Hub implements BoardApi {
  port: number;
  elements: El[] = [];
  updatedAt = 0;
  session: Session | null = null;
  messages: ChatMsg[] = [];
  private delivered = 0; // index into messages already handed to the AI
  private lastFp: Fingerprint | null = null;
  private lastChangeAt = 0;
  private lastLookAt = 0;
  private lastAiAt = 0;
  private clients = new Map<WebSocket, { lastSeen: number }>();
  private waiters = new Set<() => void>();
  private snapshots = new Map<string, (r: { dataUrl?: string; error?: string }) => void>();
  private saveTimer: NodeJS.Timeout | undefined;
  private server?: http.Server;
  mcpHandler?: (req: http.IncomingMessage, res: http.ServerResponse, body: unknown) => Promise<void>;

  constructor(port: number) {
    this.port = port;
    this.load();
  }

  get url() {
    return `http://localhost:${this.port}`;
  }

  // ---------- persistence ----------
  private load() {
    try {
      const d = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      this.elements = d.elements ?? [];
      this.updatedAt = d.updatedAt ?? 0;
      this.session = d.session ?? null;
      this.messages = d.messages ?? [];
      this.delivered = this.messages.length;
      this.lastFp = fingerprint(this.elements);
    } catch {
      /* first run */
    }
  }
  private save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        fs.mkdirSync(STATE_DIR, { recursive: true });
        fs.writeFileSync(STATE_FILE, JSON.stringify({ elements: this.elements, updatedAt: this.updatedAt, session: this.session, messages: this.messages }));
      } catch (e) {
        log('save failed', e);
      }
    }, 800);
  }

  // ---------- server ----------
  listen(): Promise<boolean> {
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => this.route(req, res).catch((e) => {
        log('request error', e);
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: String(e?.message ?? e) }));
      }));
      const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
      server.on('upgrade', (req, socket, head) => {
        if (!req.url?.startsWith('/ws') || !isLocalHost(req.headers.host) || !isLocalOrigin(req.headers.origin)) return socket.destroy();
        wss.handleUpgrade(req, socket, head, (ws) => this.onSocket(ws));
      });
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') resolve(false);
        else {
          log('server error', err);
          resolve(false);
        }
      });
      server.listen(this.port, '127.0.0.1', () => {
        this.server = server;
        log(`board running at ${this.url}`);
        resolve(true);
      });
    });
  }

  private async route(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url || '/', this.url);
    const local = isLocalHost(req.headers.host);

    // MCP over HTTP (ChatGPT connectors, tunnels): always token-protected, CORS-open
    if (url.pathname === '/mcp') {
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-headers', '*');
      res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
      res.setHeader('access-control-expose-headers', 'mcp-session-id');
      if (req.method === 'OPTIONS') return void res.writeHead(204).end();
      if (!checkToken(req, url)) return json(res, { error: 'Missing or wrong token. Use the URL printed by `sysdesign-board token`.' }, 401);
      if (!this.mcpHandler) return json(res, { error: 'MCP over HTTP not enabled' }, 404);
      const body = req.method === 'POST' ? await readBody(req) : undefined;
      return this.mcpHandler(req, res, body);
    }

    // Everything else is for this machine only: no tunnels, no DNS rebinding, no other websites.
    if (!local || !isLocalOrigin(req.headers.origin)) return json(res, { error: 'The board is only available on localhost.' }, 403);
    if (url.pathname === '/api/health') return json(res, { app: APP_ID, url: this.url, clients: this.clients.size });
    if (url.pathname === '/api/rpc' && req.method === 'POST') {
      // a JSON content type forces a CORS preflight, which we never answer
      if (!String(req.headers['content-type'] || '').includes('application/json')) return json(res, { error: 'expected JSON' }, 415);
      const { method, params } = (await readBody(req)) as { method: keyof BoardApi; params: any };
      const fn = (this as any)[method];
      if (typeof fn !== 'function' || !RPC_METHODS.has(method)) return json(res, { error: `unknown method ${method}` }, 400);
      try {
        return json(res, { result: await fn.call(this, params ?? {}) });
      } catch (e: any) {
        return json(res, { error: String(e?.message ?? e) }, 500);
      }
    }
    // static board
    const root = webDist();
    let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = path.join(root, p);
    if (!file.startsWith(root)) return void res.writeHead(403).end();
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
    if (!fs.existsSync(file)) {
      res.writeHead(200, { 'content-type': 'text/html' });
      return void res.end('<h2>Board UI not built yet</h2><p>Run <code>npm run build</code> in the project folder (or <code>npm run dev</code> and open :5173).</p>');
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  }

  // ---------- websocket ----------
  private onSocket(ws: WebSocket) {
    this.clients.set(ws, { lastSeen: Date.now() });
    ws.on('message', (raw) => {
      let m: ClientMsg;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      const c = this.clients.get(ws);
      if (c) c.lastSeen = Date.now();
      this.onClient(ws, m);
    });
    ws.on('close', () => this.clients.delete(ws));
  }

  private send(ws: WebSocket, m: ServerMsg) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  }
  private broadcast(m: ServerMsg, except?: WebSocket) {
    const s = JSON.stringify(m);
    for (const ws of this.clients.keys()) if (ws !== except && ws.readyState === WebSocket.OPEN) ws.send(s);
  }
  private wake() {
    for (const w of this.waiters) w();
    this.waiters.clear();
  }
  private aiActive() {
    return Date.now() - this.lastAiAt < 3 * 60_000;
  }
  private touchAi(what: 'looking' | 'listening' | 'thinking' | 'idle', active = true) {
    this.lastAiAt = Date.now();
    this.broadcast({ type: 'ai_activity', what, active });
  }

  private onClient(ws: WebSocket, m: ClientMsg) {
    switch (m.type) {
      case 'hello': {
        // newest board wins
        if (m.updatedAt > this.updatedAt && m.elements) this.setElements(m.elements, m.updatedAt, ws);
        this.send(ws, { type: 'init', elements: this.elements, updatedAt: this.updatedAt, session: this.session, messages: this.messages, aiActive: this.aiActive() });
        break;
      }
      case 'doc':
        this.setElements(m.elements, m.updatedAt, ws);
        break;
      case 'chat':
        this.pushMessage({ role: 'candidate', text: m.text.slice(0, 4000), source: m.source });
        break;
      case 'snapshot_result': {
        const r = this.snapshots.get(m.reqId);
        if (r) {
          this.snapshots.delete(m.reqId);
          r(m);
        }
        break;
      }
      case 'set_phase':
        if (this.session) {
          this.session = { ...this.session, phase: m.phase };
          this.broadcast({ type: 'session', session: this.session });
          this.pushMessage({ role: 'system', text: `Candidate moved on to: ${PHASES.find((p) => p.id === m.phase)?.label}` });
        }
        break;
      case 'end_session':
        this.pushMessage({ role: 'system', text: 'Candidate says they are done. Wrap up and give feedback.' });
        break;
    }
  }

  private setElements(els: El[], updatedAt: number, from?: WebSocket) {
    this.elements = els;
    this.updatedAt = updatedAt || Date.now();
    this.lastChangeAt = Date.now();
    this.save();
    this.broadcast({ type: 'doc', elements: els, updatedAt: this.updatedAt }, from);
    this.wake();
  }

  private pushMessage(p: Omit<ChatMsg, 'id' | 'at'>) {
    const msg: ChatMsg = { id: uid(), at: Date.now(), ...p };
    this.messages.push(msg);
    if (this.messages.length > 500) {
      const drop = this.messages.length - 500;
      this.messages.splice(0, drop);
      this.delivered = Math.max(0, this.delivered - drop);
    }
    this.broadcast({ type: 'chat', message: msg });
    this.save();
    this.wake();
    return msg;
  }

  private addElements(els: El[]) {
    const all = rebindArrows([...els.filter((e) => e.type === 'frame'), ...this.elements, ...els.filter((e) => e.type !== 'frame')], new Set(els.map((e) => e.id)));
    const added = all.filter((e) => els.some((n) => n.id === e.id));
    this.elements = all;
    this.updatedAt = Date.now();
    this.save();
    this.broadcast({ type: 'add_elements', elements: added });
    // the AI knows about what it drew itself
    this.lastFp = fingerprint(this.elements);
    return added;
  }

  /** Find an element by id, or by (fuzzy) label / component type. */
  resolve(ref: string): El | null {
    if (!ref) return null;
    const exact = this.elements.find((e) => e.id === ref);
    if (exact) return exact;
    const q = ref.toLowerCase().trim();
    const named = this.elements.filter((e) => e.type !== 'pen' && e.type !== 'comment');
    return (
      named.find((e) => (e.label || '').toLowerCase().trim() === q) ||
      named.find((e) => e.type === 'component' && (CATALOG_BY_KIND[e.kind!]?.name.toLowerCase() === q || e.kind === q)) ||
      named.find((e) => (e.label || '').toLowerCase().includes(q)) ||
      named.find((e) => q.includes((e.label || '').toLowerCase().trim()) && (e.label || '').trim().length > 2) ||
      null
    );
  }

  private ensureBrowser() {
    if (!this.clients.size) this.openBoard();
  }

  // ---------- BoardApi ----------
  async status() {
    return {
      url: this.url,
      boardOpen: this.clients.size > 0,
      session: this.session,
      elements: this.elements.length,
      messages: this.messages.length,
    };
  }

  async openBoard() {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', this.url] : [this.url];
    try {
      spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
    } catch (e) {
      log('could not open browser', e);
    }
    return { url: this.url, alreadyOpen: this.clients.size > 0 };
  }

  async startInterview(p: { title: string; problem: string; level?: string; durationMin?: number; clearBoard?: boolean; opening?: string }) {
    this.session = {
      id: uid(),
      title: p.title || 'System design interview',
      problem: p.problem || p.title,
      level: p.level,
      phase: 'requirements',
      startedAt: Date.now(),
      durationMin: p.durationMin ?? 45,
      status: 'active',
    };
    this.messages = [];
    this.delivered = 0;
    this.broadcast({ type: 'messages', messages: [] });
    this.broadcast({ type: 'session', session: this.session });
    if (p.clearBoard) this.setElements([], Date.now());
    this.lastFp = fingerprint(this.elements);
    this.lastLookAt = Date.now();
    this.pushMessage({ role: 'system', text: `Interview started · ${this.session.durationMin} min` });
    if (p.opening) this.pushMessage({ role: 'interviewer', text: p.opening });
    this.delivered = this.messages.length;
    this.touchAi('idle', false);
    this.ensureBrowser();
    this.save();
    return { session: this.session, url: this.url, boardOpen: this.clients.size > 0 };
  }

  async getBoard(p: { includeJson?: boolean } = {}) {
    this.touchAi('looking');
    const fp = fingerprint(this.elements);
    const changes = diffBoards(this.lastFp, fp);
    this.lastFp = fp;
    this.lastLookAt = Date.now();
    return {
      summary: describeBoard(this.elements),
      changesSinceLastLook: changes,
      session: this.sessionInfo(),
      elements: p.includeJson ? this.elements.map(compact) : undefined,
    };
  }

  async getImage() {
    this.touchAi('looking');
    const target = [...this.clients.entries()].sort((a, b) => b[1].lastSeen - a[1].lastSeen)[0]?.[0];
    if (!target) {
      this.openBoard();
      throw new Error(`The board is not open in a browser yet. I just tried to open ${this.url}; ask the candidate to open it, then try again.`);
    }
    const reqId = uid();
    const result = await new Promise<{ dataUrl?: string; error?: string }>((resolve) => {
      this.snapshots.set(reqId, resolve);
      this.send(target, { type: 'snapshot_request', reqId });
      setTimeout(() => {
        if (this.snapshots.delete(reqId)) resolve({ error: 'The board did not answer in time.' });
      }, 10_000);
    });
    if (!result.dataUrl) throw new Error(result.error || 'snapshot failed');
    this.lastFp = fingerprint(this.elements);
    this.lastLookAt = Date.now();
    return { dataUrl: result.dataUrl, summary: describeBoard(this.elements) };
  }

  async waitForCandidate(p: { timeoutSec?: number } = {}) {
    const timeout = Math.max(5, Math.min(p.timeoutSec ?? 45, 110)) * 1000;
    const SETTLE = 7000;
    const start = Date.now();
    this.touchAi('listening');
    this.ensureBrowser();
    let reason: 'message' | 'board' | 'timeout' = 'timeout';
    for (;;) {
      if (this.messages.length > this.delivered) {
        // give a moment for a follow-up sentence
        await sleep(1200);
        reason = 'message';
        break;
      }
      const changed = this.updatedAt > this.lastLookAt && diffBoards(this.lastFp, fingerprint(this.elements)).length > 0;
      if (changed && Date.now() - this.lastChangeAt > SETTLE) {
        reason = 'board';
        break;
      }
      if (Date.now() - start > timeout) break;
      await new Promise<void>((r) => {
        const t = setTimeout(r, 1000);
        this.waiters.add(() => {
          clearTimeout(t);
          r();
        });
      });
    }
    const fresh = this.messages.slice(this.delivered);
    this.delivered = this.messages.length;
    const fp = fingerprint(this.elements);
    const changes = diffBoards(this.lastFp, fp);
    if (changes.length) {
      this.lastFp = fp;
      this.lastLookAt = Date.now();
    }
    this.touchAi('thinking');
    const drawingNow = Date.now() - this.lastChangeAt < 4000;
    return {
      reason,
      candidateSaid: fresh.filter((m) => m.role === 'candidate').map((m) => ({ text: m.text, via: m.source ?? 'text' })),
      events: fresh.filter((m) => m.role === 'system').map((m) => m.text),
      boardChanges: changes,
      candidateIsDrawing: drawingNow,
      session: this.sessionInfo(),
      boardOpen: this.clients.size > 0,
    };
  }

  async say(p: { text: string; speak?: boolean }) {
    const m = this.pushMessage({ role: 'interviewer', text: p.text, speak: p.speak !== false });
    this.delivered = this.messages.length;
    this.touchAi('idle', false);
    return { ok: true, id: m.id, boardOpen: this.clients.size > 0 };
  }

  async annotate(p: { text: string; target?: string; x?: number; y?: number }) {
    const t = p.target ? this.resolve(p.target) : null;
    if (p.target && !t) throw new Error(`No element matches "${p.target}". Use an id or label from get_board.`);
    const w = 260;
    const h = 40 + Math.ceil(p.text.length / 26) * 22;
    let x = p.x ?? 0, y = p.y ?? 0;
    if (t) {
      const b = elBox(t);
      x = b.x + b.w * 0.55;
      y = b.y - h - 46;
    } else if (p.x === undefined) {
      const b = unionBox(this.elements.map(elBox));
      x = b ? b.x + b.w + 60 : 100;
      y = b ? b.y : 100;
    }
    const el = baseEl('comment', x, y, { w, h, label: p.text, target: t?.id ?? null, stroke: 'pink', fill: 'pink', fillStyle: 'solid', author: 'ai' });
    this.addElements([el]);
    if (t) this.broadcast({ type: 'highlight', ids: [t.id], seconds: 3 });
    this.touchAi('idle', false);
    return { id: el.id, attachedTo: t ? { id: t.id, label: t.label } : null };
  }

  async highlight(p: { targets: string[]; seconds?: number; focus?: boolean }) {
    const found = p.targets.map((r) => this.resolve(r)).filter(Boolean) as El[];
    if (!found.length) throw new Error('None of those targets exist on the board.');
    const ids = found.map((e) => e.id);
    this.broadcast({ type: 'highlight', ids, seconds: p.seconds ?? 4 });
    if (p.focus) this.broadcast({ type: 'focus', ids });
    return { highlighted: found.map((e) => ({ id: e.id, label: e.label })) };
  }

  async draw(spec: DrawSpec) {
    const created: El[] = [];
    const refs = new Map<string, El>();
    const box = unionBox(this.elements.filter((e) => e.type !== 'comment').map(elBox));
    let col = 0, row = 0;
    const originX = box ? box.x + box.w + 160 : 100;
    const originY = box ? box.y : 100;
    for (const c of spec.components ?? []) {
      const kind = (CATALOG_BY_KIND[c.kind] ? c.kind : guessKind(c.kind)) as ComponentKind;
      const cat = CATALOG_BY_KIND[kind];
      const cx = c.x ?? originX + col * 210 + cat.w / 2;
      const cy = c.y ?? originY + row * 190 + cat.h / 2;
      if (c.x === undefined) {
        col++;
        if (col >= 4) {
          col = 0;
          row++;
        }
      }
      const el = baseEl('component', cx - cat.w / 2, cy - cat.h / 2, { kind, w: cat.w, h: cat.h, label: c.label || cat.name, fill: cat.color, fontSize: 18, author: 'ai' });
      if (c.x === undefined) this.findFreeSpot(el, created);
      created.push(el);
      refs.set((c.ref || c.label || kind).toLowerCase(), el);
    }
    const find = (r: string) => refs.get(r.toLowerCase()) ?? created.find((e) => e.label?.toLowerCase() === r.toLowerCase()) ?? this.resolve(r);
    const missing: string[] = [];
    for (const k of spec.connections ?? []) {
      const A = find(k.from), B = find(k.to);
      if (!A || !B) {
        missing.push(`${k.from} -> ${k.to}`);
        continue;
      }
      const a = center(A), b = center(B);
      created.push(
        baseEl('arrow', a.x, a.y, {
          pts: [[a.x, a.y], [b.x, b.y]],
          start: { id: A.id },
          end: { id: B.id },
          route: 'straight',
          startHead: k.bidirectional ? 'arrow' : 'none',
          endHead: 'arrow',
          strokeStyle: k.dashed ? 'dashed' : 'solid',
          label: k.label,
          fontSize: 16,
          author: 'ai',
        }),
      );
    }
    for (const n of spec.notes ?? []) {
      const near = n.near ? find(n.near) : null;
      const x = n.x ?? (near ? near.x + near.w / 2 - 95 : originX + col * 210);
      const y = n.y ?? (near ? near.y + near.h + 40 : originY + (row + 1) * 190);
      const note = baseEl('note', x, y, { w: 190, h: 60 + Math.ceil(n.text.length / 18) * 28, label: n.text, fill: 'yellow', fillStyle: 'solid', font: 'marker', author: 'ai' });
      if (n.x === undefined) this.findFreeSpot(note, created);
      created.push(note);
    }
    for (const z of spec.zones ?? []) {
      const members = z.contains.map(find).filter(Boolean) as El[];
      const b = unionBox(members.map(elBox));
      if (!b) continue;
      created.push(baseEl('frame', b.x - 40, b.y - 50, { w: b.w + 80, h: b.h + 90, label: z.label, stroke: 'gray', strokeStyle: 'dashed', fill: 'none', author: 'ai' }));
    }
    const added = this.addElements(created);
    this.broadcast({ type: 'focus', ids: added.map((e) => e.id) });
    return { created: added.map((e) => ({ id: e.id, type: e.type, label: e.label })), unresolvedConnections: missing };
  }

  /** Nudge a new element down until it no longer overlaps anything already on the board. */
  private findFreeSpot(el: El, pending: El[]) {
    const others = [...this.elements, ...pending].filter((e) => e.type !== 'arrow' && e.type !== 'line' && e.type !== 'frame' && e.type !== 'comment').map(elBox);
    const hits = () => others.some((b) => el.x < b.x + b.w + 24 && el.x + el.w + 24 > b.x && el.y < b.y + b.h + 24 && el.y + el.h + 24 > b.y);
    for (let i = 0; i < 40 && hits(); i++) el.y += 40;
  }

  async clearAnnotations(p: { ids?: string[] } = {}) {
    const ids = this.elements.filter((e) => e.type === 'comment' && (!p.ids?.length || p.ids.includes(e.id))).map((e) => e.id);
    this.elements = this.elements.filter((e) => !ids.includes(e.id));
    this.updatedAt = Date.now();
    this.broadcast({ type: 'remove_elements', ids });
    this.save();
    return { removed: ids.length };
  }

  async setPhase(p: { phase: Phase }) {
    if (!this.session) throw new Error('No interview is running. Call start_interview first.');
    this.session = { ...this.session, phase: p.phase };
    this.broadcast({ type: 'session', session: this.session });
    this.save();
    return { session: this.sessionInfo() };
  }

  async endInterview(f: Feedback) {
    if (!this.session) throw new Error('No interview is running.');
    this.session = { ...this.session, status: 'ended', phase: 'wrap-up', feedback: f };
    this.broadcast({ type: 'session', session: this.session });
    this.pushMessage({ role: 'system', text: 'Interview ended — feedback is below.' });
    this.delivered = this.messages.length;
    this.touchAi('idle', false);
    this.save();
    return { ok: true };
  }

  async transcript() {
    return {
      session: this.sessionInfo(),
      messages: this.messages.map((m) => ({ role: m.role, text: m.text, via: m.source, at: new Date(m.at).toISOString() })),
    };
  }

  private sessionInfo() {
    if (!this.session) return null;
    const s = this.session;
    return {
      title: s.title,
      level: s.level,
      phase: s.phase,
      status: s.status,
      elapsedMin: Math.round(((Date.now() - s.startedAt) / 60000) * 10) / 10,
      durationMin: s.durationMin,
    };
  }
}

const RPC_METHODS = new Set<string>([
  'status', 'openBoard', 'startInterview', 'getBoard', 'getImage', 'waitForCandidate', 'say', 'annotate', 'highlight', 'draw', 'clearAnnotations', 'setPhase', 'endInterview', 'transcript',
]);

/** Talks to a hub that some other process already started on this port. */
export function remoteApi(port: number): BoardApi {
  const call = async (method: string, params: unknown) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, params }),
    });
    const d = (await r.json()) as { result?: unknown; error?: string };
    if (d.error) throw new Error(d.error);
    return d.result;
  };
  return new Proxy({} as BoardApi, { get: (_t, method: string) => (method === 'then' ? undefined : (params: unknown) => call(method, params)) });
}

function baseEl(type: El['type'], x: number, y: number, extra: Partial<El>): El {
  return {
    id: uid(),
    type,
    x,
    y,
    w: 0,
    h: 0,
    stroke: 'ink',
    fill: 'none',
    fillStyle: 'hachure',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 1,
    seed: seed(),
    version: 1,
    fontSize: 20,
    font: 'hand',
    ...extra,
  };
}

function guessKind(k: string): ComponentKind {
  const q = k.toLowerCase();
  const hit = CATALOG.find((c) => c.name.toLowerCase() === q || c.keywords.split(' ').some((w) => q.includes(w)));
  return (hit?.kind ?? 'service') as ComponentKind;
}

function compact(e: El) {
  const { seed: _s, version: _v, roughness: _r, opacity: _o, fillStyle: _f, ...rest } = e;
  return rest;
}

const LOCAL_NAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
function hostname(h?: string) {
  if (!h) return '';
  return h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0];
}
function isLocalHost(host?: string) {
  const h = hostname(host).toLowerCase();
  return LOCAL_NAMES.has(h) || h.endsWith('.localhost');
}
function isLocalOrigin(origin?: string) {
  if (!origin) return true; // same-origin navigations, curl, node clients
  try {
    return isLocalHost(new URL(origin).host);
  } catch {
    return false;
  }
}

/** Token for the HTTP MCP endpoint: SYSDESIGN_TOKEN, or a random one kept in ~/.sysdesign-board/token. */
export function getToken() {
  if (process.env.SYSDESIGN_TOKEN) return process.env.SYSDESIGN_TOKEN;
  const file = path.join(STATE_DIR, 'token');
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    if (t) return t;
  } catch {
    /* create below */
  }
  const t = crypto.randomBytes(24).toString('base64url');
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(file, t + '\n', { mode: 0o600 });
  return t;
}
function checkToken(req: http.IncomingMessage, url: URL) {
  const auth = String(req.headers.authorization || '');
  const given = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : url.searchParams.get('token') || '';
  const want = getToken();
  const a = Buffer.from(given), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function json(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const s = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}
