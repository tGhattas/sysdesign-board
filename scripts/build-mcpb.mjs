// Builds build/sysdesign-board-<version>.mcpb — a one-click Claude Desktop extension.
// Run `npm run build` first; this stages the bundled server + board UI and packs them.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const stage = path.join(root, 'build/mcpb');
const out = path.join(root, `build/sysdesign-board-${pkg.version}.mcpb`);

for (const f of ['server/dist/index.js', 'web/dist/index.html']) {
  if (!fs.existsSync(path.join(root, f))) throw new Error(`Missing ${f} — run "npm run build" first.`);
}

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, 'server'), { recursive: true });
fs.copyFileSync(path.join(root, 'server/dist/index.js'), path.join(stage, 'server/index.js'));
fs.cpSync(path.join(root, 'web/dist'), path.join(stage, 'web/dist'), { recursive: true });
for (const f of ['README.md', 'LICENSE']) fs.copyFileSync(path.join(root, f), path.join(stage, f));
fs.copyFileSync(path.join(root, 'assets/icon.png'), path.join(stage, 'icon.png'));

const tools = [
  ['start_interview', 'Start a session: problem, level, timer; opens the board and speaks your opening line'],
  ['wait_for_candidate', 'Wait until the candidate speaks or finishes drawing'],
  ['say', 'Talk to the candidate (shown in chat, read aloud)'],
  ['get_board', 'Structured description of the diagram: components, connections, zones, notes'],
  ['get_board_image', 'A picture of the whole board'],
  ['annotate', 'Pin an interviewer comment on a component'],
  ['highlight', 'Make components glow on the candidate’s screen'],
  ['draw_on_board', 'Add components, connections, notes and zones'],
  ['set_phase', 'Move the interview phase tracker'],
  ['end_interview', 'Finish with scores and feedback'],
  ['clear_annotations', 'Remove interviewer comments'],
  ['get_transcript', 'Full conversation transcript'],
  ['open_board', 'Open the board in the browser'],
];

const manifest = {
  manifest_version: '0.3',
  name: 'sysdesign-board',
  display_name: 'Sketch Design — System Design Interview Board',
  version: pkg.version,
  description: 'A hand-drawn whiteboard for system design mock interviews. Claude watches your board, listens, asks questions and gives feedback.',
  long_description:
    'Draw your architecture on a pencil-style whiteboard in your browser — load balancers, caches, databases, queues and more — while Claude plays a realistic system design interviewer. It reads your diagram, looks at your sketches, talks with you by text or voice, pins questions on your components and ends with scored feedback. Everything runs locally on your machine.',
  author: { name: pkg.author, url: 'https://github.com/tGhattas' },
  repository: { type: 'git', url: pkg.repository.url.replace(/^git\+/, '') },
  homepage: pkg.homepage,
  support: pkg.bugs.url,
  privacy_policies: ['https://github.com/tGhattas/sysdesign-board/blob/main/PRIVACY.md'],
  license: pkg.license,
  keywords: pkg.keywords,
  icon: 'icon.png',
  server: {
    type: 'node',
    entry_point: 'server/index.js',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/server/index.js'],
      env: { SYSDESIGN_PORT: '${user_config.port}' },
    },
  },
  user_config: {
    port: {
      type: 'number',
      title: 'Board port',
      description: 'Local port for the whiteboard (open http://localhost:<port>). Change it only if 4321 is taken.',
      default: 4321,
      min: 1024,
      max: 65535,
      required: false,
    },
  },
  tools: tools.map(([name, description]) => ({ name, description })),
  compatibility: { platforms: ['darwin', 'win32', 'linux'], runtimes: { node: '>=18.0.0' } },
};
fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const mcpb = path.join(root, 'node_modules/.bin/mcpb');
execFileSync(mcpb, ['validate', path.join(stage, 'manifest.json')], { stdio: 'inherit' });
fs.rmSync(out, { force: true });
execFileSync(mcpb, ['pack', stage, out], { stdio: 'inherit' });
console.log(`\nBuilt ${path.relative(root, out)} — double-click it to install in Claude Desktop.`);
