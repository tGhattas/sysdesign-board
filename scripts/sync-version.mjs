// Copies the version from package.json into everything else that pins it:
// the MCP Registry metadata, the Claude plugin manifest, and the plugin's locked dependency.
// Runs automatically from `npm version` (see the "version" script in package.json).
// The plugin's package-lock.json can only be refreshed once the new version is on npm:
// run `npm run lock:plugin` after `npm publish`.
import fs from 'node:fs';

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const write = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2) + '\n');
const { version, name } = read('package.json');

const server = read('server.json');
server.version = version;
for (const p of server.packages) if (p.identifier === name) p.version = version;
write('server.json', server);

const plugin = read('plugin/.claude-plugin/plugin.json');
plugin.version = version;
write('plugin/.claude-plugin/plugin.json', plugin);

const deps = read('plugin/package.json');
deps.dependencies[name] = version;
write('plugin/package.json', deps);

console.log(`synced version ${version} into server.json and plugin/. After npm publish, run: npm run lock:plugin`);
