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
    { demo_recording_url: true, test_cases: { positive: 'abcde', negative: 'abc' } },
    { demo_recording_url: 'http://example.com/demo' },
  ]) {
    writeFileSync(configPath, JSON.stringify({ ...config, openai: { review } }));
    assert.throws(() => buildPackage({ configPath, target: 'openai', release: true, out: join(dir, 'invalid-review') }), /Invalid release configuration|HTTPS/);
  }
  const review = { demo_recording_url: 'https://example.com/demo?v=1', test_cases: {
    positive: Array.from({ length: 5 }, (_, index) => ({ description: `Synthetic read ${index}`, prompt: 'Show app status.', tools_triggered: 'app_get', expected_behavior: 'Return the authorized app status.' })),
    negative: Array.from({ length: 3 }, (_, index) => ({ description: `Synthetic refusal ${index}`, prompt: 'Access an unauthorized app.' })),
  } };
  writeFileSync(configPath, JSON.stringify({ ...config, openai: { review } }));
  const openai = buildPackage({ configPath, target: 'openai', release: true, out: join(dir, 'openai-ready') });
  assert.deepEqual(JSON.parse(readFileSync(openai.report, 'utf8')).submission_metadata_gaps.openai, []);
  const portable = JSON.parse(readArtifactZip(readFileSync(openai.submissions[0])).get('plugin.json')!.toString());
  assert.deepEqual(portable.extensions['com.openai'].review, review);
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
