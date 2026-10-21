// Shared data model between the board (browser) and the hub / MCP server (node).

export type ElType =
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'arrow'
  | 'line'
  | 'pen'
  | 'text'
  | 'note'
  | 'frame'
  | 'component'
  | 'comment';

export type FillStyle = 'none' | 'hachure' | 'cross-hatch' | 'solid';
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
export type Arrowhead = 'none' | 'arrow' | 'triangle' | 'dot';
export type Route = 'straight' | 'curve' | 'elbow';
export type FontFamily = 'hand' | 'marker' | 'clean';

export type ComponentKind =
  | 'user'
  | 'browser'
  | 'mobile'
  | 'dns'
  | 'cdn'
  | 'lb'
  | 'gateway'
  | 'firewall'
  | 'server'
  | 'service'
  | 'worker'
  | 'lambda'
  | 'cron'
  | 'sql'
  | 'nosql'
  | 'cache'
  | 'storage'
  | 'search'
  | 'warehouse'
  | 'queue'
  | 'stream'
  | 'pubsub'
  | 'notify'
  | 'monitor'
  | 'auth'
  | 'external'
  | 'ml';

export interface Binding {
  id: string;
}

export interface El {
  id: string;
  type: ElType;
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string; // palette token
  fill: string; // palette token or 'none'
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  roughness: number;
  opacity: number;
  seed: number;
  version: number;
  label?: string;
  fontSize?: number;
  font?: FontFamily;
  kind?: ComponentKind;
  /** linear elements: absolute [x,y] anchor points; pen: [x,y,pressure] */
  pts?: number[][];
  bend?: number;
  route?: Route;
  startHead?: Arrowhead;
  endHead?: Arrowhead;
  start?: Binding | null;
  end?: Binding | null;
  author?: 'user' | 'ai';
  /** comment: element it points at */
  target?: string | null;
  resolved?: boolean;
}

export type Phase = 'requirements' | 'estimation' | 'api' | 'high-level' | 'deep-dive' | 'wrap-up';

export const PHASES: { id: Phase; label: string }[] = [
  { id: 'requirements', label: 'Requirements' },
  { id: 'estimation', label: 'Estimation' },
  { id: 'api', label: 'API & Data' },
  { id: 'high-level', label: 'High-level' },
  { id: 'deep-dive', label: 'Deep dive' },
  { id: 'wrap-up', label: 'Wrap-up' },
];

export interface Feedback {
  summary: string;
  scores: Record<string, number>;
  strengths: string[];
  improvements: string[];
  signal?: string;
}

export interface Session {
  id: string;
  title: string;
  problem: string;
  level?: string;
  phase: Phase;
  startedAt: number;
  durationMin: number;
  status: 'active' | 'ended';
  feedback?: Feedback;
}

export interface ChatMsg {
  id: string;
  role: 'interviewer' | 'candidate' | 'system';
  text: string;
  source?: 'text' | 'voice';
  at: number;
  speak?: boolean;
}

// ---- WebSocket protocol ----
export type ClientMsg =
  | { type: 'hello'; elements: El[]; updatedAt: number }
  | { type: 'doc'; elements: El[]; updatedAt: number }
  | { type: 'chat'; text: string; source: 'text' | 'voice' }
  | { type: 'snapshot_result'; reqId: string; dataUrl?: string; error?: string }
  | { type: 'set_phase'; phase: Phase }
  | { type: 'end_session' };

export type ServerMsg =
  | { type: 'init'; elements: El[] | null; updatedAt: number; session: Session | null; messages: ChatMsg[]; aiActive: boolean }
  | { type: 'doc'; elements: El[]; updatedAt: number }
  | { type: 'chat'; message: ChatMsg }
  | { type: 'session'; session: Session | null }
  | { type: 'messages'; messages: ChatMsg[] }
  | { type: 'add_elements'; elements: El[] }
  | { type: 'remove_elements'; ids: string[] }
  | { type: 'highlight'; ids: string[]; seconds: number }
  | { type: 'focus'; ids: string[] }
  | { type: 'snapshot_request'; reqId: string }
  | { type: 'ai_activity'; what: 'looking' | 'listening' | 'thinking' | 'idle'; active: boolean };
