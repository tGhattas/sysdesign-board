// Bundles the hub + MCP server into one dependency-free file: server/dist/index.js
import fs from 'node:fs';
import { build } from 'esbuild';

const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['server/src/index.ts'],
  outfile: 'server/dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  // optional native speedups for ws; it falls back to JS without them
  external: ['bufferutil', 'utf-8-validate'],
  define: { __VERSION__: JSON.stringify(version) },
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
