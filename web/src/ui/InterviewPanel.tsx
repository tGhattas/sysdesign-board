import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Volume2, VolumeX, SendHorizontal, X, Timer, Copy, Eye, Sparkles, Flag } from 'lucide-react';
import { PHASES } from '../../../shared/types';
import { store, useStore, toast } from '../store';
import { sendChat, sendPhase, sendEndSession } from '../sync';
import { voice, useVoice } from '../voice';

const STARTER = 'Start a system design interview with me on my sketch board. Act as a senior interviewer, use the board tools to watch what I draw, and talk with me over the board chat.';

const PROBLEMS = [
  'URL shortener',
  'News feed',
  'Chat app (WhatsApp)',
  'Rate limiter',
  'Ride sharing (Uber)',
  'Video streaming (YouTube)',
  'Distributed cache',
  'Notification system',
  'Web crawler',
  'Ticket booking',
];

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function InterviewPanel() {
  const session = useStore((s) => s.session);
  const messages = useStore((s) => s.messages);
  const connection = useStore((s) => s.connection);
  const aiActive = useStore((s) => s.aiActive);
  const activity = useStore((s) => s.aiActivity);
  const v = useVoice();
  const [text, setText] = useState('');
  const [expanded, setExpanded] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const now = useNow();

  useEffect(() => {
    voice.onUtterance((t) => sendChat(t, 'voice'));
  }, []);
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, activity?.what]);

  const submit = () => {
    if (!text.trim()) return;
    sendChat(text, 'text');
    setText('');
  };
  const copy = async (t: string) => {
    try {
      await navigator.clipboard.writeText(t);
      toast('Copied — paste it into Claude or ChatGPT');
    } catch {
      toast('Could not copy');
    }
  };

  const elapsed = session ? now - session.startedAt : 0;
  const late = session && elapsed > session.durationMin * 60000;
  const phaseIdx = session ? PHASES.findIndex((p) => p.id === session.phase) : -1;

  const statusText =
    connection !== 'online' ? (connection === 'connecting' ? 'Connecting to hub…' : 'Offline — board saves locally') : aiActive ? 'Interviewer connected' : 'Waiting for the AI';

  return (
    <div className="float panel" onPointerDown={(e) => e.stopPropagation()}>
      <div className="panel-head">
        <h3>Interview</h3>
        <div className="grow" />
        <div className="status">
          <span className={`dot ${connection === 'online' ? (aiActive ? 'ai' : 'on') : ''}`} />
          {statusText}
        </div>
        <button className="icon-btn" style={{ width: 30, height: 30 }} title="Hide panel (I)" onClick={() => store.set({ panelOpen: false })}>
          <X size={16} />
        </button>
      </div>

      {session && (
        <div className="session">
          <div className="title-row">
            <div className="title">{session.title}</div>
            {session.level && <span className="badge">{session.level}</span>}
            <span className={`timer ${late ? 'late' : ''}`} title={`${session.durationMin} minute interview`}>
              <Timer size={13} />
              {session.status === 'ended' ? 'done' : `${fmt(elapsed)} / ${session.durationMin}:00`}
            </span>
          </div>
          {session.problem && session.problem !== session.title && (
            <>
              <div className={`problem ${expanded ? '' : 'collapsed'}`}>{session.problem}</div>
              <button className="linkish" onClick={() => setExpanded(!expanded)}>
                {expanded ? 'Show less' : 'Show full prompt'}
              </button>
            </>
          )}
          <div className="phases">
            {PHASES.map((p, i) => (
              <button
                key={p.id}
                className={`phase ${i < phaseIdx ? 'done' : ''} ${i === phaseIdx ? 'cur' : ''}`}
                title={`Phase: ${p.label}`}
                onClick={() => session.status === 'active' && sendPhase(p.id)}
              >
                <div className="bar" />
                <span>{p.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="chat" ref={chatRef}>
        {!session && messages.length === 0 && (
          <div className="empty">
            <h4>Ready when you are ✏️</h4>
            Your board is live at this address. Connect an AI interviewer:
            <ol>
              <li>Add the <code>sysdesign-board</code> MCP server to Claude Desktop (or ChatGPT).</li>
              <li>In a new chat, ask it to start an interview — or paste the starter prompt.</li>
              <li>Draw here; talk by typing below or with the mic.</li>
            </ol>
            <div className="chips" style={{ marginBottom: 12 }}>
              <button className="chip" onClick={() => copy(STARTER)}>
                <Copy size={12} /> Copy starter prompt
              </button>
            </div>
            <div className="sp-label" style={{ marginTop: 6 }}>Or pick a classic</div>
            <div className="chips">
              {PROBLEMS.map((p) => (
                <button key={p} className="chip" title="Copies a prompt for this problem" onClick={() => copy(`${STARTER} The problem: design a ${p}.`)}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) =>
          m.role === 'system' ? (
            <div key={m.id} className="msg system">
              <div className="bubble">{m.text}</div>
            </div>
          ) : (
            <div key={m.id} className={`msg ${m.role}`}>
              <div className="who">
                {m.role === 'interviewer' ? (
                  <>
                    <Sparkles size={11} /> Interviewer
                  </>
                ) : (
                  <>
                    {m.source === 'voice' && <Mic size={11} />} You
                  </>
                )}
              </div>
              <div className="bubble">{m.text}</div>
            </div>
          ),
        )}
        {activity && activity.what !== 'idle' && (
          <div className="typing">
            {activity.what === 'looking' ? (
              <>
                <Eye size={13} /> looking at your board
              </>
            ) : activity.what === 'listening' ? (
              <>listening</>
            ) : (
              <>
                <i />
                <i />
                <i />
              </>
            )}
          </div>
        )}
        {session?.feedback && <FeedbackCard f={session.feedback} />}
      </div>

      <div className="composer">
        {(v.listening || v.interim) && (
          <div className="interim">{v.interim || (v.speaking ? 'Interviewer is speaking…' : 'Listening… just talk, I’ll send when you pause.')}</div>
        )}
        {v.error && <div className="interim" style={{ color: 'var(--ai)', fontFamily: 'var(--ui)', fontSize: 12 }}>{v.error}</div>}
        <div className="compose-box">
          <button
            className={`mic ${v.listening ? 'on' : ''}`}
            style={{ ['--lvl' as any]: v.level }}
            title={v.supported ? (v.listening ? 'Stop the mic' : 'Talk to the interviewer') : 'Speech recognition needs Chrome or Safari'}
            onClick={() => voice.toggle()}
          >
            {v.listening ? <Mic size={17} /> : <MicOff size={17} />}
          </button>
          <textarea
            rows={1}
            value={text}
            placeholder={session ? 'Explain your thinking, ask a question…' : 'Message the interviewer…'}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button className="send" disabled={!text.trim()} onClick={submit} title="Send (Enter)">
            <SendHorizontal size={16} />
          </button>
        </div>
        <div className="compose-meta">
          <button className="toggle" onClick={() => voice.setTts(!v.ttsOn)} title="Read the interviewer's messages aloud">
            {v.ttsOn ? <Volume2 size={13} /> : <VolumeX size={13} />} Voice replies {v.ttsOn ? 'on' : 'off'}
          </button>
          {v.speaking && (
            <button className="toggle" onClick={() => voice.stopSpeaking()}>
              Skip
            </button>
          )}
          <div className="grow" />
          {session?.status === 'active' && (
            <button className="toggle" onClick={() => sendEndSession()} title="Tell the interviewer you're done">
              <Flag size={12} /> I'm done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function FeedbackCard({ f }: { f: NonNullable<import('../../../shared/types').Session['feedback']> }) {
  return (
    <div className="feedback">
      <h4>Feedback</h4>
      {f.signal && <span className="badge" style={{ background: 'var(--ai-soft)', color: 'var(--ai)' }}>{f.signal}</span>}
      <p style={{ fontSize: 13.5, lineHeight: 1.5, margin: '8px 0' }}>{f.summary}</p>
      {Object.entries(f.scores || {}).map(([k, v]) => (
        <div className="score" key={k}>
          <span>{k.replace(/_/g, ' ')}</span>
          <div className="track">
            <i style={{ width: `${(Math.max(0, Math.min(5, v)) / 5) * 100}%` }} />
          </div>
          <span>{v}</span>
        </div>
      ))}
      {!!f.strengths?.length && (
        <>
          <div className="sub">Strengths</div>
          <ul>{f.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </>
      )}
      {!!f.improvements?.length && (
        <>
          <div className="sub">To improve</div>
          <ul>{f.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </>
      )}
    </div>
  );
}
