// Browser speech: Web Speech API for dictation, speechSynthesis for the interviewer's voice.
import { useSyncExternalStore } from 'react';

type VoiceState = {
  supported: boolean;
  listening: boolean;
  interim: string;
  speaking: boolean;
  ttsOn: boolean;
  level: number;
  error: string | null;
};

type SR = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: any) => void) | null;
};

const Ctor: (new () => SR) | undefined =
  typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : undefined;

let state: VoiceState = {
  supported: !!Ctor,
  listening: false,
  interim: '',
  speaking: false,
  ttsOn: (() => {
    try {
      return localStorage.getItem('sysdesign-board:tts') !== 'off';
    } catch {
      return true;
    }
  })(),
  level: 0,
  error: null,
};
const subs = new Set<() => void>();
const set = (p: Partial<VoiceState>) => {
  state = { ...state, ...p };
  subs.forEach((f) => f());
};

let rec: SR | null = null;
let wantListening = false;
let finalBuf = '';
let flushTimer: number | undefined;
let onUtterance: ((text: string) => void) | null = null;
let audioStop: (() => void) | null = null;

function flush() {
  const t = finalBuf.trim();
  finalBuf = '';
  set({ interim: '' });
  if (t) onUtterance?.(t);
}

async function startLevelMeter() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ac = new AudioContext();
    const src = ac.createMediaStreamSource(stream);
    const an = ac.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const buf = new Uint8Array(an.frequencyBinCount);
    let raf = 0;
    const tick = () => {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      set({ level: Math.min(1, Math.sqrt(sum / buf.length) * 4) });
      raf = requestAnimationFrame(tick);
    };
    tick();
    audioStop = () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      ac.close();
      set({ level: 0 });
    };
  } catch (err) {
    set({ error: 'Microphone permission was denied' });
  }
}

function startRec() {
  if (!Ctor) return;
  rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = navigator.language || 'en-US';
  rec.onresult = (e: any) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalBuf += ' ' + r[0].transcript;
      else interim += r[0].transcript;
    }
    set({ interim: (finalBuf + ' ' + interim).trim() });
    clearTimeout(flushTimer);
    // send once the speaker pauses
    flushTimer = window.setTimeout(flush, interim ? 2200 : 1300);
  };
  rec.onerror = (e: any) => {
    if (e.error === 'not-allowed') {
      wantListening = false;
      set({ error: 'Microphone permission was denied', listening: false });
    } else if (e.error !== 'no-speech' && e.error !== 'aborted') set({ error: `Speech error: ${e.error}` });
  };
  rec.onend = () => {
    // Chrome stops after silence; keep going while the user wants to listen
    if (wantListening && !state.speaking) {
      try {
        rec?.start();
      } catch {
        /* already started */
      }
    }
  };
  try {
    rec.start();
  } catch {
    /* noop */
  }
}

export const voice = {
  get: () => state,
  subscribe: (f: () => void) => {
    subs.add(f);
    return () => subs.delete(f);
  },
  onUtterance(fn: (text: string) => void) {
    onUtterance = fn;
  },
  start() {
    if (!Ctor) {
      set({ error: 'Speech recognition is not available in this browser. Try Chrome or Safari.' });
      return;
    }
    wantListening = true;
    set({ listening: true, error: null });
    startRec();
    startLevelMeter();
  },
  stop() {
    wantListening = false;
    clearTimeout(flushTimer);
    rec?.stop();
    rec = null;
    audioStop?.();
    audioStop = null;
    set({ listening: false });
    setTimeout(flush, 300);
  },
  toggle() {
    state.listening ? voice.stop() : voice.start();
  },
  setTts(on: boolean) {
    set({ ttsOn: on });
    try {
      localStorage.setItem('sysdesign-board:tts', on ? 'on' : 'off');
    } catch {
      /* noop */
    }
    if (!on) speechSynthesis.cancel();
  },
  speak(text: string) {
    if (!state.ttsOn || typeof speechSynthesis === 'undefined') return;
    const u = new SpeechSynthesisUtterance(text.replace(/[*_`#>]/g, ''));
    const voices = speechSynthesis.getVoices();
    const pref = ['Samantha', 'Google US English', 'Microsoft Aria', 'Daniel', 'Karen', 'Alex'];
    u.voice =
      voices.find((v) => pref.some((p) => v.name.includes(p)) && v.lang.startsWith('en')) ||
      voices.find((v) => v.lang.startsWith((navigator.language || 'en').slice(0, 2))) ||
      null;
    u.rate = 1.03;
    u.onstart = () => {
      set({ speaking: true });
      // don't transcribe our own voice
      if (wantListening) rec?.abort();
    };
    u.onend = u.onerror = () => {
      set({ speaking: false });
      if (wantListening && !speechSynthesis.speaking) startRec();
    };
    speechSynthesis.speak(u);
  },
  stopSpeaking() {
    speechSynthesis.cancel();
    set({ speaking: false });
  },
};

export function useVoice() {
  return useSyncExternalStore(voice.subscribe, voice.get);
}
