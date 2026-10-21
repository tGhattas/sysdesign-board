import type { ClientMsg, ServerMsg, Phase } from '../../shared/types';
import { store, toast } from './store';
import type { Engine } from './engine';
import { voice } from './voice';

let ws: WebSocket | null = null;
let engine: Engine | null = null;
let pushTimer: number | undefined;
let retry = 0;
let aiTimer: number | undefined;

function send(m: ClientMsg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
}

export function connect(e: Engine) {
  engine = e;
  e.onLocalChange = () => {
    clearTimeout(pushTimer);
    pushTimer = window.setTimeout(() => {
      const s = store.get();
      send({ type: 'doc', elements: s.elements, updatedAt: s.updatedAt });
    }, 250);
  };
  open();
}

function open() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  store.set({ connection: 'connecting' });
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    retry = 0;
    store.set({ connection: 'online' });
    const s = store.get();
    send({ type: 'hello', elements: s.elements, updatedAt: s.updatedAt });
  };
  ws.onclose = () => {
    store.set({ connection: 'offline', aiActive: false });
    retry = Math.min(retry + 1, 6);
    setTimeout(open, 400 * 2 ** retry);
  };
  ws.onerror = () => ws?.close();
  ws.onmessage = (ev) => {
    let m: ServerMsg;
    try {
      m = JSON.parse(ev.data);
    } catch {
      return;
    }
    handle(m);
  };
}

function handle(m: ServerMsg) {
  if (!engine) return;
  switch (m.type) {
    case 'init':
      if (m.elements && m.updatedAt > store.get().updatedAt) {
        engine.loadElements(m.elements, { remote: true, resetHistory: true });
        store.set({ updatedAt: m.updatedAt });
      }
      store.set({ session: m.session, messages: m.messages, aiActive: m.aiActive });
      break;
    case 'doc':
      engine.loadElements(m.elements, { remote: true });
      store.set({ updatedAt: m.updatedAt });
      break;
    case 'chat': {
      store.set((s) => ({ messages: [...s.messages.filter((x) => x.id !== m.message.id), m.message] }));
      if (m.message.role === 'interviewer') {
        store.set({ aiActive: true, aiActivity: null });
        if (m.message.speak !== false) voice.speak(m.message.text);
      }
      break;
    }
    case 'messages':
      store.set({ messages: m.messages });
      break;
    case 'session':
      store.set({ session: m.session });
      break;
    case 'add_elements':
      engine.applyRemoteElements(m.elements);
      toast(m.elements.length === 1 && m.elements[0].type === 'comment' ? 'The interviewer left a note on your board' : `The interviewer drew ${m.elements.length} item${m.elements.length > 1 ? 's' : ''}`);
      break;
    case 'remove_elements':
      engine.removeRemote(m.ids);
      break;
    case 'highlight':
      engine.highlight(m.ids, m.seconds);
      break;
    case 'focus':
      engine.focus(m.ids);
      break;
    case 'snapshot_request': {
      try {
        send({ type: 'snapshot_result', reqId: m.reqId, dataUrl: engine.snapshot() });
      } catch (err) {
        send({ type: 'snapshot_result', reqId: m.reqId, error: String(err) });
      }
      break;
    }
    case 'ai_activity':
      clearTimeout(aiTimer);
      store.set({ aiActive: true, aiActivity: m.active ? { what: m.what, at: Date.now() } : null });
      if (m.active && m.what !== 'listening') aiTimer = window.setTimeout(() => store.set({ aiActivity: null }), 3500);
      break;
  }
}

export function sendChat(text: string, source: 'text' | 'voice') {
  const t = text.trim();
  if (!t) return;
  if (ws?.readyState !== WebSocket.OPEN) {
    toast('Not connected to the interview hub');
    return;
  }
  send({ type: 'chat', text: t, source });
}

export function sendPhase(phase: Phase) {
  send({ type: 'set_phase', phase });
}
export function sendEndSession() {
  send({ type: 'end_session' });
}
