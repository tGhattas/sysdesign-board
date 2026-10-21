import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BoardApi } from './hub';
import { CATALOG } from '../../shared/catalog';
import { PHASES } from '../../shared/types';

export const INSTRUCTIONS = `sysdesign-board is a live, hand-drawn whiteboard the user draws on in their browser. You act as a SYSTEM DESIGN INTERVIEWER watching that board.

How a session works:
1. start_interview (opens the board for the candidate, sets the problem, posts your opening line). Keep the opening short and spoken-friendly.
2. Then LOOP: wait_for_candidate -> read what they said / what changed on the board -> respond with say (short, conversational, one question at a time) -> wait_for_candidate again. Keep looping until the interview ends; do not end your turn after one reply unless the user asks to stop.
3. Look at the board when it matters: get_board (structured: components, connections, zones, notes) is cheap; get_board_image (a picture) when there are freehand strokes, or you need layout/visual detail.
4. Use annotate to pin a question on a specific component ("What happens when this cache node dies?"), highlight to point at things while you talk, set_phase as the interview moves on, draw_on_board only if the candidate asks you to sketch something or for the final reference design.
5. Finish with end_interview giving honest scores (1-5) and concrete feedback.

Interviewer style: realistic, warm but rigorous. Let the candidate drive. Ask about requirements, scale estimates, APIs, data model, bottlenecks, failure modes, consistency, trade-offs. Don't lecture or give away the design. Messages from say() are read aloud by text-to-speech, so write like you talk: no markdown, no bullet lists, 1-3 sentences.`;

const PHASE_IDS = PHASES.map((p) => p.id) as [string, ...string[]];
const KINDS = CATALOG.map((c) => `${c.kind} (${c.name})`).join(', ');

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const fail = (e: unknown) => ({ content: [{ type: 'text' as const, text: `Error: ${(e as Error)?.message ?? e}` }], isError: true });

export function createMcpServer(api: BoardApi) {
  const server = new McpServer({ name: 'sysdesign-board', version: '0.1.0' }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'open_board',
    { title: 'Open the board', description: 'Open the sketch board in the user’s browser and return its URL.', inputSchema: {} },
    async () => {
      try {
        const r = await api.openBoard();
        return text(`Board: ${r.url}${r.alreadyOpen ? ' (already open in a browser)' : ' — opening in the default browser now.'}`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'start_interview',
    {
      title: 'Start a system design interview',
      description: 'Start a new interview session on the board: sets the problem statement, timer and phase, opens the board, and posts your opening message (spoken aloud to the candidate).',
      inputSchema: {
        title: z.string().describe('Short problem title, e.g. "Design a URL shortener"'),
        problem: z.string().describe('The prompt as you would say it to the candidate, plus any constraints you want to reveal up front'),
        level: z.enum(['junior', 'mid', 'senior', 'staff', 'principal']).optional(),
        duration_minutes: z.number().int().min(10).max(120).optional().describe('Default 45'),
        clear_board: z.boolean().optional().describe('Wipe the board first (default false)'),
        opening_message: z.string().optional().describe('Your first spoken line, e.g. a greeting and the problem'),
      },
    },
    async (a) => {
      try {
        const r = await api.startInterview({ title: a.title, problem: a.problem, level: a.level, durationMin: a.duration_minutes, clearBoard: a.clear_board, opening: a.opening_message });
        return text(
          `Interview started (${r.session.durationMin} min). Board: ${r.url} ${r.boardOpen ? '(open)' : '(opening in browser)'}.\nNext: call wait_for_candidate and keep looping.`,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'wait_for_candidate',
    {
      title: 'Listen to the candidate',
      description:
        'Block until the candidate says something (typed or by voice), the board changes and then settles, or the timeout passes. Returns what they said, what changed on the board, and interview timing. Call this in a loop between your replies.',
      inputSchema: { timeout_seconds: z.number().int().min(5).max(110).optional().describe('Default 45. Keep under your client’s tool timeout.') },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      try {
        const r = await api.waitForCandidate({ timeoutSec: a.timeout_seconds });
        const L: string[] = [];
        if (r.candidateSaid.length) {
          L.push('Candidate said:');
          for (const m of r.candidateSaid) L.push(`  (${m.via}) ${m.text}`);
        }
        if (r.events.length) L.push('Events: ' + r.events.join(' | '));
        if (r.boardChanges.length) L.push('Board changes: ' + r.boardChanges.join('; '));
        if (!L.length) L.push(r.candidateIsDrawing ? 'Nothing said yet — the candidate is drawing right now. Wait again.' : 'Nothing new (timeout). You can wait again, or nudge the candidate with say if they seem stuck.');
        if (!r.boardOpen) L.push('Note: the board is not open in any browser. Call open_board or tell the user the URL.');
        if (r.session) L.push(`Session: phase=${r.session.phase}, ${r.session.elapsedMin}/${r.session.durationMin} min elapsed, status=${r.session.status}.`);
        return text(L.join('\n'));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'say',
    {
      title: 'Speak to the candidate',
      description: 'Send a message to the candidate. It appears in the board chat and is read aloud. Keep it short and conversational (no markdown).',
      inputSchema: { text: z.string().min(1), speak: z.boolean().optional().describe('Read aloud (default true)') },
    },
    async (a) => {
      try {
        const r = await api.say({ text: a.text, speak: a.speak });
        return text(r.boardOpen ? 'Delivered.' : 'Saved, but the board is not open in a browser — call open_board.');
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'get_board',
    {
      title: 'Read the board',
      description: 'Structured description of the board: components (type, label, id, position, zone), connections (from -> to, label, dashed=async), zones, notes and text, freehand strokes, plus what changed since you last looked.',
      inputSchema: { include_json: z.boolean().optional().describe('Also return raw element JSON (verbose)') },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      try {
        const r = await api.getBoard({ includeJson: a.include_json });
        let t = r.summary;
        if (r.changesSinceLastLook?.length) t += `\n\nChanged since your last look: ${r.changesSinceLastLook.join('; ')}`;
        if (r.session) t += `\n\nSession: phase=${r.session.phase}, ${r.session.elapsedMin}/${r.session.durationMin} min.`;
        if (r.elements) t += `\n\nJSON:\n${JSON.stringify(r.elements)}`;
        return text(t);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'get_board_image',
    {
      title: 'Look at the board',
      description: 'A PNG picture of the whole board as the candidate sees it (handwriting, sketches, layout). Use when get_board mentions freehand strokes or you need visual context.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const r = await api.getImage();
        const data = String(r.dataUrl).replace(/^data:image\/png;base64,/, '');
        return { content: [{ type: 'image' as const, data, mimeType: 'image/png' }, { type: 'text' as const, text: r.summary }] };
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'annotate',
    {
      title: 'Pin a comment on the board',
      description: 'Pin an interviewer comment bubble on the board, pointing at a component (by id or label) or at a position. Great for "what if this fails?" style probes.',
      inputSchema: {
        text: z.string().min(1).max(400),
        target: z.string().optional().describe('Element id or label, e.g. "Redis" or "Load Balancer"'),
        x: z.number().optional(),
        y: z.number().optional(),
      },
    },
    async (a) => {
      try {
        const r = await api.annotate(a);
        return text(`Pinned comment ${r.id}${r.attachedTo ? ` on "${r.attachedTo.label}"` : ''}.`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'highlight',
    {
      title: 'Point at components',
      description: 'Make components glow on the candidate’s board (e.g. while asking about them). Optionally scroll/zoom their view to them.',
      inputSchema: { targets: z.array(z.string()).min(1).describe('Element ids or labels'), seconds: z.number().min(1).max(20).optional(), focus: z.boolean().optional() },
    },
    async (a) => {
      try {
        const r = await api.highlight(a);
        return text(`Highlighted: ${r.highlighted.map((h: any) => h.label || h.id).join(', ')}`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'draw_on_board',
    {
      title: 'Draw on the board',
      description: `Add components, connections, sticky notes and zones in the same sketchy style (marked as drawn by the interviewer). Use sparingly — the candidate should drive. Component kinds: ${KINDS}. Connections reference a component by its ref/label (new or existing) or id. Positions are optional (auto-laid out to the right of existing content).`,
      inputSchema: {
        components: z
          .array(z.object({ ref: z.string().optional(), kind: z.string(), label: z.string().optional(), x: z.number().optional(), y: z.number().optional() }))
          .optional(),
        connections: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().optional(), dashed: z.boolean().optional(), bidirectional: z.boolean().optional() })).optional(),
        notes: z.array(z.object({ text: z.string(), near: z.string().optional(), x: z.number().optional(), y: z.number().optional() })).optional(),
        zones: z.array(z.object({ label: z.string(), contains: z.array(z.string()) })).optional(),
      },
    },
    async (a) => {
      try {
        const r = await api.draw(a);
        let t = `Drew ${r.created.length} items: ${r.created.map((c: any) => `${c.type}${c.label ? ` "${c.label}"` : ''} [${c.id}]`).join(', ')}`;
        if (r.unresolvedConnections.length) t += `\nCould not connect: ${r.unresolvedConnections.join(', ')}`;
        return text(t);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'clear_annotations',
    {
      title: 'Remove interviewer comments',
      description: 'Remove your pinned comments (all, or specific ids).',
      inputSchema: { ids: z.array(z.string()).optional() },
    },
    async (a) => {
      try {
        const r = await api.clearAnnotations(a);
        return text(`Removed ${r.removed} comment(s).`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'set_phase',
    {
      title: 'Move to an interview phase',
      description: `Update the phase tracker the candidate sees: ${PHASES.map((p) => `${p.id} (${p.label})`).join(', ')}.`,
      inputSchema: { phase: z.enum(PHASE_IDS) },
    },
    async (a) => {
      try {
        await api.setPhase({ phase: a.phase as any });
        return text(`Phase: ${a.phase}`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'end_interview',
    {
      title: 'End the interview with feedback',
      description: 'Close the session and show a feedback card on the board. Scores are 1-5.',
      inputSchema: {
        summary: z.string().describe('2-4 sentence overall assessment'),
        scores: z
          .object({
            requirements: z.number().min(1).max(5),
            estimation: z.number().min(1).max(5).optional(),
            high_level_design: z.number().min(1).max(5),
            deep_dive: z.number().min(1).max(5),
            tradeoffs: z.number().min(1).max(5),
            communication: z.number().min(1).max(5),
          })
          .describe('1 = poor, 3 = meets bar, 5 = exceptional'),
        strengths: z.array(z.string()).max(6),
        improvements: z.array(z.string()).max(6),
        signal: z.string().optional().describe('e.g. "Lean hire (senior)"'),
      },
    },
    async (a) => {
      try {
        const scores = Object.fromEntries(Object.entries(a.scores).filter(([, v]) => typeof v === 'number')) as Record<string, number>;
        await api.endInterview({ summary: a.summary, scores, strengths: a.strengths, improvements: a.improvements, signal: a.signal });
        return text('Interview ended. Feedback is shown on the board.');
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'get_transcript',
    { title: 'Conversation transcript', description: 'Full chat/voice transcript of the current session.', inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => {
      try {
        const r = await api.transcript();
        return text(r.messages.map((m: any) => `[${m.at.slice(11, 19)}] ${m.role}${m.via === 'voice' ? ' (voice)' : ''}: ${m.text}`).join('\n') || 'No messages yet.');
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerPrompt(
    'interview',
    {
      title: 'System design interview',
      description: 'Run a live system design mock interview on the sketch board.',
      argsSchema: {
        problem: z.string().optional().describe('e.g. "Design Twitter". Leave empty to let the interviewer pick.'),
        level: z.string().optional().describe('junior / mid / senior / staff'),
        minutes: z.string().optional().describe('Interview length, default 45'),
      },
    },
    ({ problem, level, minutes }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Run a realistic ${level || 'senior'}-level system design mock interview with me on the sysdesign-board whiteboard, ${minutes || '45'} minutes.
Problem: ${problem || 'pick a classic one that fits the level (do not tell me in advance which).'}

Rules for you:
- Call start_interview, then keep looping wait_for_candidate -> (get_board / get_board_image when useful) -> say. Do not stop looping until the interview is over or I say stop.
- Everything you say() is read aloud: talk naturally, 1-3 sentences, one question at a time, no markdown.
- Let me drive. Probe requirements, back-of-envelope estimates, API, data model, high-level design, then deep dives (bottlenecks, scaling, failure modes, consistency, trade-offs). Use annotate/highlight to point at parts of my diagram. Track progress with set_phase.
- Watch the clock and steer me if I'm stuck or rabbit-holing.
- At the end call end_interview with honest scores and specific, actionable feedback.`,
          },
        },
      ],
    }),
  );

  return server;
}
