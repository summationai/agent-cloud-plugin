import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { buildPackage } from '../scripts/build.mjs';
import { readArtifactDirectory, readArtifactZip, validateTarget } from '../scripts/validate.mjs';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function temporary(t: test.TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-cloud-public-release-'));
  t.after(() => rmSync(dir, { recursive: true, force: true })); return dir;
}
function extract(zip: string, destination: string, target: string) {
  const files = readArtifactZip(readFileSync(zip)); validateTarget(files, target);
  for (const [path, bytes] of files) { const file = join(destination, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes); }
  return files;
}
function icon() {
  const chunk = (name: string, bytes: Buffer) => {
    const data = Buffer.concat([Buffer.from(name), bytes]); let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
    const result = Buffer.alloc(data.length + 8); result.writeUInt32BE(bytes.length); data.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4); return result;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(512); header.writeUInt32BE(512, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(512 * (1 + 512 * 4)))), chunk('IEND', Buffer.alloc(0))]);
}

test('PLG-1, PLG-29, PLG-30: one public repository and both submission ZIPs run without the private source checkout', t => {
  const dir = temporary(t), built = buildPackage({ out: join(dir, 'generated') });
  const detached = join(dir, 'detached'); cpSync(built.repository, detached, { recursive: true });
  const archives = built.submissions.map(path => { const copy = join(dir, path.endsWith('openai.zip') ? 'openai.zip' : 'claude.zip'); cpSync(path, copy); return copy; });
  rmSync(join(dir, 'generated'), { recursive: true });
  const repository = readArtifactDirectory(detached);
  assert.ok(repository.has('.agents/plugins/marketplace.json')); assert.ok(repository.has('.claude-plugin/marketplace.json'));
  assert.ok(repository.has('PUBLISHING.md')); assert.ok(repository.has('release.json'));
  const combined = readArtifactDirectory(join(detached, 'plugins/agent-cloud'));
  for (const [path, bytes] of repository) {
    if (!path.startsWith('plugins/agent-cloud/') && !['README.md', 'PUBLISHING.md', 'DEVELOPMENT.md', 'LICENSE-STATUS.md', 'release.json', 'release-report.json'].includes(path)) continue;
    if (!/\.(?:md|mjs|json)$/.test(path)) continue;
    assert.doesNotMatch(bytes.toString(), /e2e\/plugins\/|github\.com\/summationai\/agent-cloud(?:\/|\s|$)|npm run build -w|\/Users\//);
    if (path.endsWith('.md')) for (const [, target] of bytes.toString().matchAll(/\]\(([^)]+)\)/g)) {
      if (/^https?:/.test(target)) continue;
      assert.ok(repository.has(resolve('/', dirname(path), target).slice(1)), `${path} -> ${target}`);
    }
  }
  for (const zip of archives) {
    const target = zip.endsWith('openai.zip') ? 'openai' : 'claude', folder = join(dir, `extracted-${target}`);
    const files = extract(zip, folder, target);
    assert.equal(validateTarget(readArtifactDirectory(folder), target).valid, true);
    for (const path of ['skills/setup/SKILL.md', 'skills/build-and-host/SKILL.md', 'skills/manage-app/SKILL.md', 'scripts/connect-codex.mjs', 'README.md', 'CLIENTS.md', 'ACCEPTANCE.md', 'references/starters.json']) assert.deepEqual(files.get(path), combined.get(path), path);
    // The OpenAI portal connects one MCP server, so its ZIP leaves the canvas out; Claude's keeps it.
    for (const path of ['skills/canvas/SKILL.md', 'agents/canvas-builder.md']) assert.deepEqual(files.get(path), target === 'openai' ? undefined : combined.get(path), path);
    const result = spawnSync(process.execPath, [join(folder, 'scripts/connect-codex.mjs'), '--help'], { cwd: folder, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /Connect the installed/);
  }
});

test('PLG-29, PLG-30: release metadata/licensing is configurable and unresolved choices block release-ready output', t => {
  const dir = temporary(t), configPath = join(dir, 'release.json');
  writeFileSync(configPath, JSON.stringify({ license: { id: null, file: null } }));
  assert.throws(() => buildPackage({ configPath, release: true, out: join(dir, 'unconfigured') }), /configuration is incomplete/);
  writeFileSync(join(dir, 'LICENSE'), 'Synthetic license fixture; no actual product license choice.\n');
  writeFileSync(join(dir, 'icon.png'), icon());
  const config = {
    repository: 'https://github.com/example/public-distribution',
    marketplace: { name: 'public-example', displayName: 'Example apps', owner: { name: 'Example publisher' } },
    plugin: { supportURL: 'https://example.com/support', documentationURL: 'https://example.com/docs', privacyPolicyURL: 'https://example.com/privacy', termsOfServiceURL: 'https://example.com/terms', icon: 'icon.png' },
    license: { id: 'LicenseRef-Synthetic-Test', file: 'LICENSE' },
    openai: { review: null },
  };
  writeFileSync(configPath, JSON.stringify(config));
  const built = buildPackage({ configPath, target: 'claude', release: true, out: join(dir, 'configured') });
  assert.equal(built.submissions.length, 1); assert.ok(built.submissions[0].endsWith('claude.zip'));
  const files = readArtifactZip(readFileSync(built.submissions[0]));
  const manifest = JSON.parse(files.get('.claude-plugin/plugin.json')!.toString());
  assert.equal(manifest.repository, config.repository); assert.equal(manifest.license, config.license.id);
  assert.deepEqual(Object.keys(JSON.parse(files.get('.mcp.json')!.toString()).mcpServers), ['agent-cloud', 'canvas']);
  const catalog = JSON.parse(readFileSync(join(built.repository, '.claude-plugin/marketplace.json'), 'utf8'));
  assert.equal(catalog.name, 'public-example');
  assert.equal(manifest.privacyPolicyUrl, config.plugin.privacyPolicyURL); assert.equal(manifest.icon, './assets/icon.png');
  assert.equal(files.get('LICENSE')!.toString(), readFileSync(join(dir, 'LICENSE'), 'utf8'));
  assert.deepEqual(files.get('assets/icon.png'), icon());
  assert.match(files.get('README.md')!.toString(), /example\/public-distribution/);
  assert.doesNotMatch(files.get('README.md')!.toString(), /summationai\/agent-cloud-plugin/);
  const report = JSON.parse(readFileSync(built.report, 'utf8'));
  assert.deepEqual(report.submission_metadata_gaps.claude, []); assert.equal(report.publication.performed_by_build, false); assert.equal(report.publication.source_repository, 'not_checked');
  assert.throws(() => buildPackage({ configPath, target: 'openai', release: true, out: join(dir, 'missing-review') }), /review cases/);
  for (const review of [
    { commerce: 'true' },
    { commerce_description: false },
  ]) {
    writeFileSync(configPath, JSON.stringify({ ...config, openai: { review } }));
    assert.throws(() => buildPackage({ configPath, target: 'openai', release: true, out: join(dir, 'invalid-review') }), /Invalid release configuration/);
  }
  const review = { commerce: false, test_cases: {
    positive: Array.from({ length: 5 }, (_, index) => ({ description: `Synthetic read ${index}`, prompt: 'Show app status.', tools_triggered: 'app_get', expected_behavior: 'Return the authorized app status.' })),
    negative: Array.from({ length: 3 }, (_, index) => ({ description: `Synthetic refusal ${index}`, prompt: 'Access an unauthorized app.' })),
  } };
  writeFileSync(configPath, JSON.stringify({ ...config, openai: { review } }));
  const openai = buildPackage({ configPath, target: 'openai', release: true, out: join(dir, 'openai-ready') });
  assert.deepEqual(JSON.parse(readFileSync(openai.report, 'utf8')).submission_metadata_gaps.openai, []);
  const portable = JSON.parse(readArtifactZip(readFileSync(openai.submissions[0])).get('plugin.json')!.toString());
  assert.deepEqual(portable.extensions['com.openai'].review, review);
  assert.deepEqual(JSON.parse(readArtifactZip(readFileSync(openai.submissions[0])).get('mcp.json')!.toString()).mcpServers, { 'agent-cloud': { type: 'streamable-http', url: 'https://agent.cloud/mcp' } });
  assert.ok(portable.extensions['com.openai'].interface.shortDescription.length <= 30);
  assert.ok(portable.extensions['com.openai'].interface.longDescription.length > 0);
  symlinkSync(dir, join(dir, 'linked-assets'));
  writeFileSync(configPath, JSON.stringify({ ...config, license: { ...config.license, file: 'linked-assets/LICENSE' } }));
  assert.throws(() => buildPackage({ configPath, out: join(dir, 'linked') }), /without symlink parents/);
  const stub = Buffer.alloc(24); Buffer.from('89504e470d0a1a0a', 'hex').copy(stub); stub.writeUInt32BE(512, 16); stub.writeUInt32BE(512, 20);
  writeFileSync(join(dir, 'icon.png'), stub); writeFileSync(configPath, JSON.stringify(config));
  assert.throws(() => buildPackage({ configPath, release: true, target: 'claude', out: join(dir, 'truncated-icon') }), /complete square PNG/);
  writeFileSync(configPath, JSON.stringify({ repository: 'https://github.com/summationai/agent-cloud' }));
  assert.throws(() => buildPackage({ configPath, out: join(dir, 'private-source') }), /dedicated public repository/);
  writeFileSync(configPath, JSON.stringify({ openai: { review: { test_credentials: 'synthetic-never-public' } } }));
  assert.throws(() => buildPackage({ configPath, out: join(dir, 'credentials') }), /Invalid release configuration|credentials and secrets/);
});

test('PLG-29: archives and checksums are deterministic across output paths and CI timezones', t => {
  const dir = temporary(t);
  const build = (timezone: string) => {
    const output = join(dir, timezone.replace('/', '-'));
    const result = spawnSync(process.execPath, [new URL('../scripts/build.mjs', import.meta.url).pathname, '--out', output], { encoding: 'utf8', env: { ...process.env, TZ: timezone } });
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
  };
  const first = build('UTC'), second = build('America/Los_Angeles');
  assert.deepEqual(readFileSync(first.checksums), readFileSync(second.checksums));
  for (const line of readFileSync(first.checksums, 'utf8').trim().split('\n')) {
    const [digest, path] = line.split('  '); assert.equal(hash(readFileSync(join(dir, 'UTC', path))), digest);
  }
});

test('PLG-30: the OpenAI ZIP carries one MCP server and its review cases in the manifest, including staging', t => {
  const dir = temporary(t);
  const config = JSON.parse(readFileSync(new URL('../release.config.json', import.meta.url), 'utf8'));
  for (const environment of ['production', 'staging']) {
    const built = buildPackage({ environment, out: join(dir, environment) });
    const files = readArtifactZip(readFileSync(built.submissions.find(path => path.endsWith('openai.zip'))!));
    const hostingName = environment === 'staging' ? 'agent-cloud-staging' : 'agent-cloud';
    const origin = environment === 'staging' ? 'https://staging-agent.cloud' : 'https://agent.cloud';
    // The portal refuses cases on a server in mcp.json, and reads the manifest's only for a one-server package.
    const cases = JSON.parse(files.get('plugin.json')!.toString()).extensions['com.openai'].review.test_cases;
    assert.deepEqual(cases, config.openai.review.test_cases, environment);
    assert.equal(cases.positive.length, 5); assert.equal(cases.negative.length, 3);
    assert.deepEqual(JSON.parse(files.get('mcp.json')!.toString()).mcpServers, { [hostingName]: { type: 'streamable-http', url: `${origin}/mcp` } });
    assert.deepEqual([...files.keys()].filter(path => /canvas/.test(path)), []);
    // The Git-installed package keeps both servers and carries no cases.
    const installed = readArtifactDirectory(built.plugin);
    assert.equal(JSON.parse(installed.get('plugin.json')!.toString()).extensions['com.openai'].review.test_cases, undefined);
    const runtimeMcp = JSON.parse(installed.get('mcp.json')!.toString());
    assert.deepEqual(Object.keys(runtimeMcp.mcpServers), [hostingName, 'canvas']);
    for (const name of [hostingName, 'canvas']) {
      // A server extension breaks the Codex runtime parser.
      const contaminated = new Map(installed), contaminatedMcp = structuredClone(runtimeMcp);
      contaminatedMcp.mcpServers[name].extensions = { 'com.openai': { review: { test_cases: cases } } };
      contaminated.set('mcp.json', Buffer.from(JSON.stringify(contaminatedMcp)));
      assert.throws(() => validateTarget(contaminated, 'combined'), /Invalid portable mcp/);
    }
    const claude = readArtifactZip(readFileSync(built.submissions.find(path => path.endsWith('claude.zip'))!));
    for (const server of Object.values(JSON.parse(claude.get('.mcp.json')!.toString()).mcpServers) as any[]) assert.equal(server.extensions, undefined);
  }
});

test('PLG-30: release-ready packages and public source omit the portal-only demo recording URL', t => {
  const dir = temporary(t), built = buildPackage({ release: true, out: join(dir, 'release') });
  const check = (value: any, path: string) => {
    if (!value || typeof value !== 'object') return;
    assert.equal(Object.hasOwn(value, 'demo_recording_url'), false, path);
    for (const [key, child] of Object.entries(value)) check(child, `${path}/${key}`);
  };
  const publicFiles = readArtifactDirectory(built.repository);
  for (const [path, bytes] of publicFiles) if (path.endsWith('.json')) check(JSON.parse(bytes.toString()), path);
  for (const zip of built.submissions) {
    for (const [path, bytes] of readArtifactZip(readFileSync(zip))) if (path.endsWith('.json')) check(JSON.parse(bytes.toString()), `${zip}/${path}`);
  }
  assert.deepEqual(JSON.parse(readFileSync(built.report, 'utf8')).submission_metadata_gaps, { openai: [], claude: [] });
});

test('PLG-30: recording URLs are rejected from public configuration and package metadata without echoing their value', t => {
  const dir = temporary(t), configPath = join(dir, 'release.json');
  const recording = new URL('review-recording', 'https://example.invalid/').href;
  writeFileSync(configPath, JSON.stringify({ openai: { review: { demo_recording_url: recording } } }));
  assert.throws(() => buildPackage({ configPath, out: join(dir, 'private-recording') }), (error: Error) => {
    assert.match(error.message, /OpenAI submission portal/);
    assert.equal(error.message.includes(recording), false);
    return true;
  });
  const built = buildPackage({ out: join(dir, 'build'), target: 'openai' });
  const files = readArtifactZip(readFileSync(built.submissions[0]));
  const plugin = JSON.parse(files.get('plugin.json')!.toString());
  plugin.extensions['com.openai'].review.demo_recording_url = recording;
  files.set('plugin.json', Buffer.from(JSON.stringify(plugin)));
  assert.throws(() => validateTarget(files, 'openai'), /OpenAI submission portal/);
});

test('PLG-30: release readiness says when the review cases are missing or incomplete', t => {
  const dir = temporary(t), configPath = join(dir, 'release.json');
  const config = JSON.parse(readFileSync(new URL('../release.config.json', import.meta.url), 'utf8'));
  const cases = config.openai.review.test_cases;
  for (const [name, review] of [['none', null], ['short', { test_cases: { positive: cases.positive.slice(1), negative: cases.negative } }]] as const) {
    writeFileSync(configPath, JSON.stringify({ openai: { review } }));
    const built = buildPackage({ configPath, target: 'openai', out: join(dir, name) });
    assert.deepEqual(JSON.parse(readFileSync(built.report, 'utf8')).submission_metadata_gaps.openai, ['Supply exactly five positive and three negative MCP review cases.']);
    assert.throws(() => buildPackage({ configPath, release: true, target: 'openai', out: join(dir, `${name}-release`) }), /review cases/);
  }
});

test('PLG-30: review configuration rejects per-server cases, credentials and unsafe attachment URLs', t => {
  const dir = temporary(t), configPath = join(dir, 'release.json');
  const config = JSON.parse(readFileSync(new URL('../release.config.json', import.meta.url), 'utf8'));
  const cases = config.openai.review.test_cases;
  for (const [name, openai, error] of [
    ['per-server', { mcpServers: { 'agent-cloud': { test_cases: cases } } }, /Invalid release configuration/],
    ['credentials', { review: { test_credentials: 'synthetic-never-public' } }, /Invalid release configuration/],
    ['attachment', { review: { test_cases: { positive: [{ ...cases.positive[0], file_attachment_urls: ['http://example.com/private'] }] } } }, /HTTPS/],
    ['output', { review: { test_cases: { positive: [{ ...cases.positive[0], expected_output_url: 'https://user:password@example.com/result' }] } } }, /HTTPS/],
  ] as const) {
    writeFileSync(configPath, JSON.stringify({ openai }));
    assert.throws(() => buildPackage({ configPath, out: join(dir, name) }), error);
  }
});

test('PLG-30: artifact validation rejects a second server, cases on a server, and malformed or unsafe cases', t => {
  const dir = temporary(t), built = buildPackage({ target: 'openai', out: join(dir, 'build') });
  const files = readArtifactZip(readFileSync(built.submissions[0]));
  const changed = (path: string, change: (value: any) => void) => {
    const copy = new Map(files), value = JSON.parse(files.get(path)!.toString());
    change(value); copy.set(path, Buffer.from(JSON.stringify(value))); return copy;
  };
  const cases = JSON.parse(files.get('plugin.json')!.toString()).extensions['com.openai'].review.test_cases;
  assert.throws(() => validateTarget(changed('mcp.json', mcp => { mcp.mcpServers.canvas = { type: 'streamable-http', url: 'https://canvas.agent.cloud/mcp' }; }), 'openai'), /exactly one MCP server/);
  assert.throws(() => validateTarget(changed('mcp.json', mcp => { mcp.mcpServers['agent-cloud'].extensions = { 'com.openai': { review: { test_cases: cases } } }; }), 'openai'), /Invalid portable mcp/);
  assert.throws(() => validateTarget(changed('plugin.json', plugin => { delete plugin.extensions['com.openai'].review.test_cases.positive[0].expected_behavior; }), 'openai'), /Invalid OpenAI review metadata/);
  assert.throws(() => validateTarget(changed('plugin.json', plugin => { plugin.extensions['com.openai'].review.test_cases.positive[0].file_attachment_urls = ['http://example.com/review']; }), 'openai'), /HTTPS/);
  assert.throws(() => validateTarget(changed('mcp.json', mcp => { mcp.mcpServers['agent-cloud'].not_a_transport_field = true; }), 'openai'), /Invalid portable mcp/);
});

test('PLG-12, PLG-29: target validation refuses private references, escaped paths, symlinks and changed bytes', t => {
  const dir = temporary(t), built = buildPackage({ out: join(dir, 'bundle'), target: 'openai' });
  const original = readArtifactZip(readFileSync(built.submissions[0]));
  const changed = new Map(original); changed.set('scripts/connect-codex.mjs', Buffer.from('console.log("changed")'));
  assert.throws(() => validateTarget(changed, 'openai'), /integrity mismatch/);
  const privateReference = new Map(original); privateReference.set('README.md', Buffer.from('https://github.com/summationai/agent-cloud/docs/private.md'));
  assert.throws(() => validateTarget(privateReference, 'openai'), /Private build context/);
  const escaped = new Map(original); escaped.set('../outside', Buffer.from('bad'));
  assert.throws(() => validateTarget(escaped, 'openai'), /Unsafe artifact path/);
  const link = join(dir, 'symlinked'); mkdirSync(link); symlinkSync(join(built.plugin, 'README.md'), join(link, 'README.md'));
  assert.throws(() => readArtifactDirectory(link), /symlink refused/);
});
