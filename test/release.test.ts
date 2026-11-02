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
    for (const path of ['skills/setup/SKILL.md', 'skills/build-and-host/SKILL.md', 'skills/manage-app/SKILL.md', 'skills/canvas/SKILL.md', 'agents/canvas-builder.md', 'scripts/connect-codex.mjs', 'README.md', 'CLIENTS.md', 'ACCEPTANCE.md', 'references/starters.json']) assert.deepEqual(files.get(path), combined.get(path), path);
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
    openai: { review: null, mcpServers: { 'agent-cloud': null, canvas: null } },
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
  const review = { commerce: false };
  const serverReview = { test_cases: {
    positive: Array.from({ length: 5 }, (_, index) => ({ description: `Synthetic read ${index}`, prompt: 'Show app status.', tools_triggered: 'app_get', expected_behavior: 'Return the authorized app status.' })),
    negative: Array.from({ length: 3 }, (_, index) => ({ description: `Synthetic refusal ${index}`, prompt: 'Access an unauthorized app.' })),
  } };
  writeFileSync(configPath, JSON.stringify({ ...config, openai: { review, mcpServers: { 'agent-cloud': serverReview, canvas: serverReview } } }));
  const openai = buildPackage({ configPath, target: 'openai', release: true, out: join(dir, 'openai-ready') });
  assert.deepEqual(JSON.parse(readFileSync(openai.report, 'utf8')).submission_metadata_gaps.openai, []);
  const portable = JSON.parse(readArtifactZip(readFileSync(openai.submissions[0])).get('plugin.json')!.toString());
  assert.deepEqual(portable.extensions['com.openai'].review, review);
  const servers = JSON.parse(readArtifactZip(readFileSync(openai.submissions[0])).get('mcp.json')!.toString()).mcpServers;
  for (const server of Object.values(servers) as any[]) assert.deepEqual(server.extensions['com.openai'].review, serverReview);
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

test('PLG-30: both MCP servers carry independent review cases in the OpenAI ZIP, including staging', t => {
  const dir = temporary(t);
  const config = JSON.parse(readFileSync(new URL('../release.config.json', import.meta.url), 'utf8'));
  for (const environment of ['production', 'staging']) {
    const built = buildPackage({ environment, out: join(dir, environment) });
    const files = readArtifactZip(readFileSync(built.submissions.find(path => path.endsWith('openai.zip'))!));
    const plugin = JSON.parse(files.get('plugin.json')!.toString());
    assert.equal(plugin.extensions['com.openai'].review?.test_cases, undefined, 'cases cannot be ambiguous at plugin level');
    const servers = JSON.parse(files.get('mcp.json')!.toString()).mcpServers;
    const hostingName = environment === 'staging' ? 'agent-cloud-staging' : 'agent-cloud';
    for (const [name, source] of [[hostingName, 'agent-cloud'], ['canvas', 'canvas']]) {
      const cases = servers[name].extensions['com.openai'].review.test_cases;
      assert.deepEqual(cases, config.openai.mcpServers[source].test_cases, `${environment}/${name}`);
      assert.equal(cases.positive.length, 5); assert.equal(cases.negative.length, 3);
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

test('PLG-30: release readiness names either server whose cases are missing or incomplete', t => {
  const dir = temporary(t), configPath = join(dir, 'release.json');
  for (const name of ['agent-cloud', 'canvas']) {
    writeFileSync(configPath, JSON.stringify({ openai: { mcpServers: { [name]: null } } }));
    const built = buildPackage({ configPath, target: 'openai', out: join(dir, name) });
    assert.deepEqual(JSON.parse(readFileSync(built.report, 'utf8')).submission_metadata_gaps.openai,
      [`Supply exactly five positive and three negative MCP review cases for ${name}.`]);
    assert.throws(() => buildPackage({ configPath, release: true, target: 'openai', out: join(dir, `${name}-release`) }), new RegExp(`review cases for ${name}`));
  }
  const config = JSON.parse(readFileSync(new URL('../release.config.json', import.meta.url), 'utf8'));
  const canvasCases = config.openai.mcpServers.canvas.test_cases;
  writeFileSync(configPath, JSON.stringify({ openai: { mcpServers: { canvas: { test_cases: { positive: canvasCases.positive.slice(1) } } } } }));
  assert.throws(() => buildPackage({ configPath, release: true, target: 'openai', out: join(dir, 'short-canvas') }), /review cases for canvas/);
});

test('PLG-30: server review configuration rejects global cases, unknown servers, credentials and unsafe attachment URLs', t => {
  const dir = temporary(t), configPath = join(dir, 'release.json');
  const config = JSON.parse(readFileSync(new URL('../release.config.json', import.meta.url), 'utf8'));
  const cases = config.openai.mcpServers.canvas.test_cases;
  for (const [name, openai, error] of [
    ['global', { review: { test_cases: cases } }, /Invalid release configuration/],
    ['typo', { mcpServers: { canavs: { test_cases: cases } } }, /Invalid release configuration/],
    ['credentials', { mcpServers: { canvas: { test_credentials: 'synthetic-never-public' } } }, /Invalid release configuration/],
    ['attachment', { mcpServers: { canvas: { test_cases: { positive: [{ ...cases.positive[0], file_attachment_urls: ['http://example.com/private'] }] } } } }, /HTTPS/],
    ['output', { mcpServers: { canvas: { test_cases: { positive: [{ ...cases.positive[0], expected_output_url: 'https://user:password@example.com/result' }] } } } }, /HTTPS/],
  ] as const) {
    writeFileSync(configPath, JSON.stringify({ openai }));
    assert.throws(() => buildPackage({ configPath, out: join(dir, name) }), error);
  }
});

test('PLG-30: artifact validation rejects ambiguous or malformed per-server review metadata', t => {
  const dir = temporary(t), built = buildPackage({ target: 'openai', out: join(dir, 'build') });
  const files = readArtifactZip(readFileSync(built.submissions[0]));
  const plugin = JSON.parse(files.get('plugin.json')!.toString()), mcp = JSON.parse(files.get('mcp.json')!.toString());
  const ambiguous = new Map(files);
  plugin.extensions['com.openai'].review.test_cases = mcp.mcpServers.canvas.extensions['com.openai'].review.test_cases;
  ambiguous.set('plugin.json', Buffer.from(JSON.stringify(plugin)));
  assert.throws(() => validateTarget(ambiguous, 'openai'), /per server/);
  const malformed = new Map(files);
  delete mcp.mcpServers.canvas.extensions['com.openai'].review.test_cases.positive[0].expected_behavior;
  malformed.set('mcp.json', Buffer.from(JSON.stringify(mcp)));
  assert.throws(() => validateTarget(malformed, 'openai'), /Invalid OpenAI MCP review metadata: canvas/);
  const unsafe = new Map(files), attachment = JSON.parse(files.get('mcp.json')!.toString());
  attachment.mcpServers.canvas.extensions['com.openai'].review.test_cases.positive[0].file_attachment_urls = ['http://example.com/review'];
  unsafe.set('mcp.json', Buffer.from(JSON.stringify(attachment)));
  assert.throws(() => validateTarget(unsafe, 'openai'), /HTTPS/);
  const extra = new Map(files), transport = JSON.parse(files.get('mcp.json')!.toString());
  transport.mcpServers.canvas.not_a_transport_field = true;
  extra.set('mcp.json', Buffer.from(JSON.stringify(transport)));
  assert.throws(() => validateTarget(extra, 'openai'), /Invalid portable mcp/);
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
