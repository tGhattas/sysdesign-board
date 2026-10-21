import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Hub, remoteApi, APP_ID, getToken, type BoardApi } from './hub';
import { createMcpServer } from './tools';
import { installClaudeDesktop } from './install';

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev';

// stdout belongs to the MCP protocol in stdio mode — log to stderr only
console.log = console.error;

const args = process.argv.slice(2);
const cmd = args.find((a) => !a.startsWith('-'));
const hubOnly = args.includes('--hub-only') || cmd === 'serve';
const portArg = args.find((a) => a.startsWith('--port='));
const port = Number(portArg?.split('=')[1] || process.env.SYSDESIGN_PORT || 4321);

async function isOurHub() {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`);
    const d = (await r.json()) as { app?: string };
    return d.app === APP_ID;
  } catch {
    return false;
  }
}

const HELP = `sysdesign-board ${VERSION} — sketch whiteboard + MCP server for system design interviews

Usage:
  sysdesign-board                 Run as an MCP server over stdio (what AI apps launch)
  sysdesign-board serve           Run only the board (http://localhost:${port}) and the HTTP MCP endpoint
  sysdesign-board install         Add this server to Claude Desktop's config (quit Claude Desktop first)
        --npx | --local           Force launching via npx, or via this exact file
  sysdesign-board token           Print the token / URL for the HTTP MCP endpoint (ChatGPT connectors)

Options:
  --port=4321                     Board port (or SYSDESIGN_PORT)
  -h, --help | -v, --version`;

async function main() {
  if (args.includes('-h') || args.includes('--help') || cmd === 'help') {
    console.error(HELP);
    return;
  }
  if (args.includes('-v') || args.includes('--version')) {
    console.error(VERSION);
    return;
  }
  if (cmd === 'install') {
    process.stdout.write = process.stderr.write.bind(process.stderr) as any;
    installClaudeDesktop(args);
    return;
  }
  if (cmd === 'token') {
    console.error(`Token: ${getToken()}`);
    console.error(`Local MCP URL:   http://localhost:${port}/mcp?token=${getToken()}`);
    console.error(`Through a tunnel: https://<your-tunnel-host>/mcp?token=${getToken()}`);
    return;
  }

  const hub = new Hub(port);
  const listening = await hub.listen();
  let api: BoardApi = hub;
  if (!listening) {
    if (!(await isOurHub())) {
      console.error(`[sysdesign] port ${port} is busy with something else. Set SYSDESIGN_PORT to another port.`);
      process.exit(1);
    }
    console.error(`[sysdesign] a board hub is already running on :${port}; this process will proxy to it.`);
    const remote = remoteApi(port);
    let current: BoardApi = remote;
    // if the other hub goes away, take over the port ourselves
    api = new Proxy({} as BoardApi, {
      get: (_t, method: string) =>
        method === 'then'
          ? undefined
          : async (params: unknown) => {
              try {
                return await (current as any)[method](params);
              } catch (e) {
                if (current !== remote || !String((e as Error)?.cause ?? e).includes('ECONNREFUSED')) throw e;
                if (await hub.listen()) {
                  console.error('[sysdesign] previous hub is gone; this process now hosts the board.');
                  current = hub;
                }
                return (current as any)[method](params);
              }
            },
    });
  }
  {
    // Remote MCP (for ChatGPT connectors / anything that speaks Streamable HTTP): POST /mcp
    hub.mcpHandler = async (req, res, body) => {
      const server = createMcpServer(hub);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    };
  }

  if (hubOnly) {
    if (!listening) process.exit(0);
    console.error(`[sysdesign] open ${hub.url}`);
    console.error(`[sysdesign] HTTP MCP endpoint: ${hub.url}/mcp?token=${getToken()}  (keep the token private)`);
    return;
  }

  const server = createMcpServer(api);
  await server.connect(new StdioServerTransport());
  console.error('[sysdesign] MCP server ready on stdio');
  process.stdin.on('close', () => process.exit(0));
}

main().catch((e) => {
  console.error('[sysdesign] fatal', e);
  process.exit(1);
});
