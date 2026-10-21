import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
const t = new StdioClientTransport({ command: 'node', args: ['server/dist/index.js', ...process.argv.slice(2)] });
const c = new Client({ name: 'smoke', version: '0' });
await c.connect(t);
const tools = await c.listTools();
console.log('tools:', tools.tools.map((x) => x.name).join(', '));
const call = async (name, args = {}) => {
  const r = await c.callTool({ name, arguments: args });
  for (const p of r.content) {
    if (p.type === 'text') console.log(`--- ${name}:\n${p.text}`);
    else { console.log(`--- ${name}: [${p.type} ${p.data.length} b64 chars]`); fs.writeFileSync((process.env.OUT || '.') + '/board.png', Buffer.from(p.data, 'base64')); }
  }
};
await call('start_interview', { title: 'Design a URL shortener', problem: 'Design a URL shortening service like bit.ly. 100M new URLs per month, read heavy.', level: 'senior', opening_message: "Hi! Today let's design a URL shortener like bit.ly. Where would you like to start?" });
await call('get_board');
await call('get_board_image');
await call('annotate', { text: 'What happens to reads if this cache node goes down?', target: 'Cache' });
await call('highlight', { targets: ['SQL DB', 'Cache'] });
await call('say', { text: 'Nice start. How many reads per second do you expect?' });
await call('draw_on_board', { components: [{ ref: 'kgs', kind: 'service', label: 'Key Gen Service' }, { kind: 'redis', label: 'Key Pool' }], connections: [{ from: 'kgs', to: 'Key Pool', label: 'prefetch' }, { from: 'App Server', to: 'kgs', dashed: true }], notes: [{ text: '7 chars base62 ≈ 3.5T keys', near: 'kgs' }] });
await call('set_phase', { phase: 'high-level' });
await call('wait_for_candidate', { timeout_seconds: 6 });
await c.close();
