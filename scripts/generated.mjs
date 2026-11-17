#!/usr/bin/env node
// PLG-29: compare/sync only generated installation files; never Git or source.
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPackage } from './build.mjs';
import { readArtifactDirectory } from './validate.mjs';

const generated = ['plugins/agent-cloud', 'claude/agent-cloud', '.agents/plugins/marketplace.json', '.claude-plugin/marketplace.json', 'README.md', 'DEVELOPMENT.md', 'PUBLISHING.md', 'LICENSE-STATUS.md', 'LICENSE', 'release.json', 'release-report.json'];
const stat = path => { try { return lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; } };
const tree = path => !stat(path) ? new Map() : stat(path).isDirectory() ? readArtifactDirectory(path) : new Map([['', readFileSync(path)]]);
/** @param {{ root?: string, write?: boolean }} [options] */
export function checkGenerated({ root = fileURLToPath(new URL('../', import.meta.url)), write = false } = {}) {
  root = realpathSync(root);
  const metadata = stat(join(root, 'release.json')) ? JSON.parse(readFileSync(join(root, 'release.json'), 'utf8')) : { environment: 'production', targets: ['openai', 'claude'] };
  const temporary = mkdtempSync(join(tmpdir(), 'agent-cloud-generated-'));
  try {
    const build = buildPackage({ sourceRoot: root, environment: metadata.environment, target: metadata.targets.length === 1 ? metadata.targets[0] : 'all', out: join(temporary, 'build') });
    const differences = [];
    for (const path of generated) {
      const destination = join(root, path), source = join(build.repository, path);
      // A redirected generated parent must never make --write touch another tree.
      for (let parent = destination; parent !== root; parent = dirname(parent)) if (stat(parent) && realpathSync(parent) !== resolve(parent)) throw Error(`Generated path must not be a symlink: ${path}`);
      const actual = tree(destination), expected = tree(source);
      if (JSON.stringify([...actual.keys()].sort()) === JSON.stringify([...expected.keys()].sort()) && [...expected].every(([name, bytes]) => actual.get(name)?.equals(bytes))) continue;
      differences.push(path);
      if (write) {
        rmSync(destination, { recursive: true, force: true });
        for (const [name, bytes] of expected) {
          const file = name ? join(destination, name) : destination;
          mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes, { flag: 'wx' });
        }
      }
    }
    if (differences.length && !write) throw Error(`Generated files differ: ${differences.join(', ')}. Run npm run sync:generated and review the diff.`);
    return { ok: true, synchronized: write, changed: differences };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--write')) throw Error('Use generated.mjs [--write].');
    console.log(JSON.stringify(checkGenerated({ write: args.includes('--write') })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
