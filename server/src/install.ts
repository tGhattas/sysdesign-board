import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Where Claude Desktop keeps its config on each platform. */
export function claudeConfigPath() {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library/Application Support/Claude/claude_desktop_config.json');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData/Roaming'), 'Claude/claude_desktop_config.json');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Claude/claude_desktop_config.json');
}

function claudeIsRunning() {
  try {
    if (process.platform === 'win32') return execSync('tasklist /FI "IMAGENAME eq Claude.exe" /NH', { encoding: 'utf8' }).includes('Claude.exe');
    const procs = execSync('ps -axo comm', { encoding: 'utf8' }).split('\n').map((l) => l.trim());
    if (process.platform === 'darwin') return procs.some((l) => l.endsWith('/Claude.app/Contents/MacOS/Claude'));
    return procs.some((l) => /(^|\/)(claude-desktop|Claude)$/.test(l));
  } catch {
    return false;
  }
}

/**
 * How Claude Desktop should launch us. From an npx run we point at npx (so updates come for free);
 * from a clone/global install we point straight at this file with the current node binary.
 * Absolute paths avoid the GUI app's minimal PATH (nvm, Homebrew, Volta…).
 */
function launchEntry(mode: 'auto' | 'npx' | 'local') {
  const self = fileURLToPath(import.meta.url);
  const viaNpx = /[\\/]_npx[\\/]/.test(self);
  const nodeDir = path.dirname(process.execPath);
  if (mode === 'npx' || (mode === 'auto' && viaNpx)) {
    if (process.platform === 'win32') return { command: 'cmd', args: ['/c', 'npx', '-y', 'sysdesign-board'] };
    const npx = path.join(nodeDir, 'npx');
    return {
      command: fs.existsSync(npx) ? npx : 'npx',
      args: ['-y', 'sysdesign-board'],
      env: { PATH: [nodeDir, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(path.delimiter) },
    };
  }
  return { command: process.execPath, args: [self] };
}

export function installClaudeDesktop(args: string[]) {
  const force = args.includes('--force');
  const mode = args.includes('--npx') ? 'npx' : args.includes('--local') ? 'local' : 'auto';
  const cfg = claudeConfigPath();

  if (claudeIsRunning() && !force) {
    console.error('Claude Desktop is running. It rewrites its config from memory and would drop the new entry.');
    console.error('Quit it completely (macOS: ⌘Q, Windows: tray icon → Quit), then run this again.');
    process.exit(1);
  }

  let data: Record<string, any> = {};
  if (fs.existsSync(cfg)) {
    try {
      data = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    } catch {
      console.error(`${cfg} is not valid JSON — fix or remove it first.`);
      process.exit(1);
    }
    fs.copyFileSync(cfg, `${cfg}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  }
  const entry = launchEntry(mode);
  data.mcpServers = { ...(data.mcpServers || {}), 'sysdesign-board': entry };
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  fs.writeFileSync(cfg, JSON.stringify(data, null, 2) + '\n');
  console.log(`Added sysdesign-board to ${cfg}`);
  console.log(`  ${entry.command} ${entry.args.join(' ')}`);
  console.log('Now open Claude Desktop and ask: "Start a system design interview with me on my sketch board."');
}
