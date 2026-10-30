import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildPackage } from '../scripts/build.mjs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parse as parseYaml } from 'yaml';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const { protocol_version: protocolVersion, starters: STARTERS } = json(join(root, 'pins.json'));
const releaseConfig = json(join(root, 'release.config.json'));
// Published Agent Plugins 1.0.0 schemas fetched 27 Oct 2026 from each $id.
// Keep offline validation reproducible; OpenAI onboarding semantics are also
// checked below because the portable schema treats extension bodies as opaque.
const ajv = new Ajv2020({ strict: true, allErrors: true });
const schemaValidators = Object.fromEntries(['plugin', 'mcp'].map(name => [name, ajv.compile(json(fileURLToPath(new URL(`../schemas/${name}.schema.json`, import.meta.url))))]));
function temporary(t: test.TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-cloud-plugin-package-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(join(dir, entry.name)).map(path => `${entry.name}/${path}`) : [entry.name]).sort();
}

test('PLG-1, PLG-29: both client formats share versioned workflows, complete local references and credential-free HTTPS configuration', t => {
  const dir = temporary(t);
  for (const environment of ['production', 'staging']) {
    const built = buildPackage({ environment, out: join(dir, environment) });
    const portable = json(join(built.plugin, 'plugin.json')), claude = json(join(built.plugin, '.claude-plugin/plugin.json'));
    const metadata = json(join(built.plugin, 'bundle.json'));
    for (const name of ['plugin', 'mcp']) assert.ok(schemaValidators[name](json(join(built.plugin, `${name}.json`))), JSON.stringify(schemaValidators[name].errors));
    assert.equal(portable.name, 'agent-cloud'); assert.equal(claude.name, portable.name);
    assert.equal(portable.version, json(join(root, 'package.json')).version); assert.equal(claude.version, portable.version);
    assert.equal(portable.extensions['com.openai'].interface.displayName, releaseConfig.plugin.displayName);
    assert.equal(claude.displayName, releaseConfig.plugin.displayName);
    assert.equal(portable.extensions['com.openai'].onboardingSkill, './skills/setup/SKILL.md');
    assert.equal(portable.hooks, undefined); assert.equal(claude.hooks, undefined);
    assert.equal(metadata.protocol_version, protocolVersion); assert.equal(metadata.environment, environment);
    assert.equal(metadata.capabilities.uploader, false); assert.equal(metadata.capabilities.persistent_profile, false);
    const starters = json(join(built.plugin, 'references/starters.json'));
    assert.equal(starters.commit, STARTERS.commit); assert.equal(starters.sha256, STARTERS.sha256);
    assert.deepEqual(starters.stacks, STARTERS.stacks);
    assert.equal(starters.archive_url, `https://github.com/summationai/agc-starters/releases/download/${STARTERS.version}/starters-${STARTERS.version}.tgz`);
    const origin = environment === 'staging' ? 'https://staging-agent.cloud' : 'https://agent.cloud';
    const name = environment === 'staging' ? 'agent-cloud-staging' : 'agent-cloud';
    assert.deepEqual(json(join(built.plugin, 'mcp.json')).mcpServers, {
      [name]: { type: 'streamable-http', url: `${origin}/mcp` },
    });
    assert.deepEqual(json(join(built.plugin, '.mcp.json')), { mcpServers: { [name]: { type: 'http', url: `${origin}/mcp` } } });
    for (const catalog of ['.agents/plugins/marketplace.json', '.claude-plugin/marketplace.json']) {
      const market = json(join(built.marketplace, catalog));
      assert.equal(market.name, releaseConfig.marketplace.name + (environment === 'staging' ? '-staging' : '')); assert.equal(market.plugins.length, 1);
      const source = market.plugins[0].source;
      assert.equal(resolve(built.marketplace, typeof source === 'string' ? source : source.path), built.plugin);
    }
    const contents = files(built.plugin);
    assert.deepEqual(contents, [...Object.keys(metadata.files), 'bundle.json'].sort());
    for (const [path, info] of Object.entries(metadata.files) as [string, { sha256: string; bytes: number }][]) {
      const bytes = readFileSync(join(built.plugin, path));
      assert.equal(info.sha256, hash(bytes)); assert.equal(info.bytes, bytes.length);
      if (path.endsWith('.md')) {
        for (const [, target] of bytes.toString().matchAll(/\]\(([^)]+)\)/g)) {
          if (/^https?:/.test(target)) continue;
          const resolved = resolve(dirname(join(built.plugin, path)), target);
          assert.ok(!relative(built.plugin, resolved).startsWith('..'), target);
          assert.ok(existsSync(resolved), `${path} -> ${target}`);
        }
      }
    }
    for (const skill of ['setup', 'build-and-host', 'manage-app']) {
      const text = readFileSync(join(built.plugin, `skills/${skill}/SKILL.md`), 'utf8');
      const source = readFileSync(join(root, `skills/${skill}/SKILL.md`), 'utf8');
      // Each skill carries its references, so the client never asks to read the plugin's own files.
      assert.ok(text.startsWith(source.slice(0, source.indexOf('\n---\n', 4) + 5)), `${skill} keeps its metadata`);
      assert.doesNotMatch(text, /\]\((?:\.\.\/)+(?:references\/|[a-z-]+\/SKILL\.md)/, `${skill} links no plugin file`);
      for (const [, file] of source.matchAll(/\]\(\.\.\/\.\.\/references\/([a-z-]+\.(?:md|json))\)/g)) {
        const reference = readFileSync(join(built.plugin, `references/${file}`), 'utf8');
        assert.ok(text.includes(file.endsWith('.json') ? reference.trimEnd() : `### ${reference.split('\n')[0].slice(2)} (\`${file}\`)`), `${skill} inlines ${file}`);
      }
      assert.doesNotMatch(text, /\{\{[A-Za-z]+\}\}/);
      const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/);
      assert.ok(frontmatter, `${skill} requires skill metadata`);
      const parsed = parseYaml(frontmatter[1]);
      assert.equal(parsed.name, skill); assert.equal(typeof parsed.description, 'string');
      assert.ok(parsed.description.length > 0 && parsed.description.length < 1024);
    }
    for (const path of ['README.md', 'CLIENTS.md', 'scripts/connect-codex.mjs']) assert.ok(metadata.files[path]);
    assert.equal(built.bundle_sha256, hash(readFileSync(join(built.plugin, 'bundle.json'))));
  }
});

test('PLG-1, PLG-12, PLG-29: allowlisted builds are reproducible and exclude untracked credentials, fixtures, hooks and extra scripts', t => {
  const dir = temporary(t), sourceRoot = join(dir, 'source');
  cpSync(root, sourceRoot, { recursive: true, filter: path => !['dist', 'node_modules', '.git'].includes(relative(root, path).split('/')[0]) });
  const marker = `synthetic-credential-never-shipped-${randomUUID()}`;
  for (const path of ['.env', 'scripts/unreviewed.mjs', 'test/credentials.json', 'hooks/hooks.json', 'node_modules/credential.txt']) {
    mkdirSync(dirname(join(sourceRoot, path)), { recursive: true }); writeFileSync(join(sourceRoot, path), marker);
  }
  const first = buildPackage({ sourceRoot, out: join(dir, 'one') }), second = buildPackage({ sourceRoot, out: join(dir, 'two') });
  assert.equal(first.bundle_sha256, second.bundle_sha256);
  assert.deepEqual(files(first.marketplace), files(second.marketplace));
  for (const path of files(first.marketplace)) {
    const bytes = readFileSync(join(first.marketplace, path));
    assert.deepEqual(bytes, readFileSync(join(second.marketplace, path)));
    assert.ok(!bytes.includes(Buffer.from(marker)), path);
  }
});

test('PLG-12, PLG-29: symlinked package resources cannot smuggle external bytes into an artifact', t => {
  const dir = temporary(t), sourceRoot = join(dir, 'source');
  cpSync(root, sourceRoot, { recursive: true, filter: path => !['dist', 'node_modules', '.git'].includes(relative(root, path).split('/')[0]) });
  const target = join(dir, 'private'), input = join(sourceRoot, 'skills/setup/SKILL.md');
  writeFileSync(target, 'synthetic-private-content'); rmSync(input); symlinkSync(target, input);
  assert.throws(() => buildPackage({ sourceRoot, out: join(dir, 'bundle') }), /regular file/);
  assert.equal(existsSync(join(dir, 'bundle')), false);
});

test('PLG-13, PLG-29: an explicit output never overwrites an existing project or accepts an arbitrary environment', t => {
  const dir = temporary(t), project = join(dir, 'project'); mkdirSync(project);
  writeFileSync(join(project, 'AGENTS.md'), 'app-owned instructions');
  assert.throws(() => buildPackage({ out: project }), /already exists/);
  assert.equal(readFileSync(join(project, 'AGENTS.md'), 'utf8'), 'app-owned instructions');
  assert.throws(() => buildPackage({ environment: 'https://foreign.example', out: join(dir, 'foreign') }), /production or staging/);
  assert.throws(() => buildPackage({ out: 'relative-output' }), /absolute/);
  assert.equal(existsSync(join(dir, 'foreign')), false);
});

test('PLG-29: importing the package builder has no build, install or connection side effects', t => {
  const dir = temporary(t);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('../scripts/build.mjs', import.meta.url).href)})`], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, '');
  assert.deepEqual(readdirSync(dir), []);
});
