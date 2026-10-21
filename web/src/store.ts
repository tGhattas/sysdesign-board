import { useSyncExternalStore } from 'react';
import type { El, Session, ChatMsg } from '../../shared/types';
import { DEFAULT_STYLE, type Style } from './elements';
import type { Theme } from './palette';

export type Tool =
  | 'select'
  | 'hand'
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'arrow'
  | 'line'
  | 'pen'
  | 'text'
  | 'note'
  | 'frame'
  | 'eraser'
  | 'laser';

export interface AppState {
  elements: El[];
  updatedAt: number;
  selectedIds: string[];
  tool: Tool;
  toolLocked: boolean;
  editingId: string | null;
  cam: { x: number; y: number; zoom: number };
  theme: Theme;
  style: Style;
  libraryOpen: boolean;
  panelOpen: boolean;
  gridSnap: boolean;
  session: Session | null;
  messages: ChatMsg[];
  connection: 'offline' | 'connecting' | 'online';
  aiActive: boolean;
  aiActivity: { what: string; at: number } | null;
  helpOpen: boolean;
  toast: { text: string; at: number } | null;
  canUndo: boolean;
  canRedo: boolean;
}

type Listener = () => void;

function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set: (patch: Partial<T> | ((s: T) => Partial<T>)) => {
      const p = typeof patch === 'function' ? (patch as (s: T) => Partial<T>)(state) : patch;
      state = { ...state, ...p };
      listeners.forEach((l) => l());
    },
    subscribe: (l: Listener) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

const LS_KEY = 'sysdesign-board:v1';

function loadLocal(): Partial<AppState> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const d = JSON.parse(raw);
    return {
      elements: Array.isArray(d.elements) ? d.elements : [],
      updatedAt: d.updatedAt ?? 0,
      theme: d.theme === 'dark' ? 'dark' : 'light',
      cam: d.cam ?? undefined,
      style: { ...DEFAULT_STYLE, ...(d.style || {}) },
      libraryOpen: d.libraryOpen ?? true,
      panelOpen: d.panelOpen ?? true,
      gridSnap: !!d.gridSnap,
    };
  } catch {
    return {};
  }
}

const prefersDark = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;

export const store = createStore<AppState>({
  elements: [],
  updatedAt: 0,
  selectedIds: [],
  tool: 'select',
  toolLocked: false,
  editingId: null,
  cam: { x: -80, y: -60, zoom: 1 },
  theme: prefersDark ? 'dark' : 'light',
  style: DEFAULT_STYLE,
  libraryOpen: true,
  panelOpen: true,
  gridSnap: false,
  session: null,
  messages: [],
  connection: 'connecting',
  aiActive: false,
  aiActivity: null,
  helpOpen: false,
  toast: null,
  canUndo: false,
  canRedo: false,
  ...loadLocal(),
});

let saveTimer: number | undefined;
store.subscribe(() => {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const s = store.get();
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({
          elements: s.elements,
          updatedAt: s.updatedAt,
          theme: s.theme,
          cam: s.cam,
          style: s.style,
          libraryOpen: s.libraryOpen,
          panelOpen: s.panelOpen,
          gridSnap: s.gridSnap,
        }),
      );
    } catch {
      /* storage may be unavailable */
    }
  }, 300);
});

export function useStore<R>(sel: (s: AppState) => R): R {
  return useSyncExternalStore(store.subscribe, () => sel(store.get()));
}

export function toast(text: string) {
  store.set({ toast: { text, at: Date.now() } });
}
