import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { buildPackage } from '../scripts/build.mjs';
import { checkGenerated } from '../scripts/generated.mjs';
import { readArtifactDirectory } from '../scripts/validate.mjs';

function temporary(t: test.TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-cloud-public-source-'));
  t.after(() => rmSync(dir, { recursive: true, force: true })); return dir;
}
test('PLG-29: public repository contains editable source, standalone lock/toolchain, complete tests and CI', t => {
  const dir = temporary(t), built = buildPackage({ out: join(dir, 'build') }), files = readArtifactDirectory(built.repository);
  for (const path of ['package.json', 'package-lock.json', 'tsconfig.json', 'pins.json', 'release.config.json', 'scripts/build.mjs', 'scripts/release-config.mjs', 'scripts/validate.mjs', 'scripts/generated.mjs', 'skills/setup/SKILL.md', 'content/README.md', 'content/DEVELOPMENT.md', 'schemas/plugin.schema.json', 'test/connection.test.ts', 'test/source.test.ts', 'test/fixtures/setup.json', '.github/workflows/check.yml', 'DEVELOPMENT.md']) assert.ok(files.has(path), path);
  const metadata = JSON.parse(files.get('package.json')!.toString()), lock = JSON.parse(files.get('package-lock.json')!.toString());
  assert.equal(lock.packages[''].version, metadata.version); assert.equal(metadata.workspaces, undefined);
  assert.ok(metadata.devDependencies.typescript); assert.ok(metadata.devDependencies['@types/node']);
  assert.ok(Object.values(lock.packages).every((entry: any) => !entry.link && !entry.resolved?.startsWith('file:')));
  const config = JSON.parse(files.get('tsconfig.json')!.toString()); assert.equal(config.extends, undefined);
  for (const [path, bytes] of files) {
    assert.ok(!path.startsWith('node_modules/') && !path.startsWith('dist/') && !path.startsWith('.git/'), path);
    if (!/\.(?:mjs|ts)$/.test(path)) continue;
    for (const [, dependency] of bytes.toString().matchAll(/from ['"]([^'"]+)['"]/g)) {
      if (!dependency.startsWith('.')) continue;
      const resolved = resolve('/', dirname(path), dependency).slice(1);
      assert.ok(files.has(resolved), `${path} imports missing ${dependency}`);
    }
  }
});

test('PLG-29: public source changes rebuild and sync the generated tree while preserving Git and local files', t => {
  const dir = temporary(t), built = buildPackage({ out: join(dir, 'build') }), root = built.repository;
  assert.deepEqual(checkGenerated({ root }).changed, []);
  mkdirSync(join(root, '.git')); writeFileSync(join(root, '.git/config'), 'preserve this Git metadata');
  writeFileSync(join(root, 'maintainer-notes.txt'), 'preserve this local file');
  const skill = join(root, 'skills/setup/SKILL.md'), original = readFileSync(skill, 'utf8');
  writeFileSync(skill, `${original}\nPublic source edit fixture.\n`);
  assert.throws(() => checkGenerated({ root }), /Generated files differ/);
  checkGenerated({ root, write: true }); assert.deepEqual(checkGenerated({ root }).changed, []);
  assert.match(readFileSync(join(root, 'plugins/agent-cloud/skills/setup/SKILL.md'), 'utf8'), /\nPublic source edit fixture\.\n\n## References\n/);
  assert.equal(readFileSync(join(root, '.git/config'), 'utf8'), 'preserve this Git metadata');
  assert.equal(readFileSync(join(root, 'maintainer-notes.txt'), 'utf8'), 'preserve this local file');
});
