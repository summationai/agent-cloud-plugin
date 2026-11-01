import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { execFileSync } from 'node:child_process';
import { assetProblems, channelProblem, compareVersions, isPrerelease, main, newestPublished, ownerChanges, planVersion, releaseAction, releaseNotReady, releaseSelection, rollbackTarget, summary, versionMismatches } from '../scripts/release.mjs';

const root = join(import.meta.dirname, '..');
const workflow = parse(readFileSync(join(root, '.github/workflows/release.yml'), 'utf8'));
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function temporary(t: test.TestContext) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-cloud-release-workflow-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const steps = (job: string) => workflow.jobs[job].steps as { name?: string; run?: string; if?: string }[];
const at = (job: string, match: (s: { name?: string; run?: string }) => boolean) => steps(job).findIndex(match);

test('PUB-1: a push publishes only when the version changed; a manual run goes on for the same version', () => {
  const tags = { 'v0.2.0': 'c0' };
  assert.equal(planVersion({ version: '0.2.1', parentVersion: '0.2.0', head: 'c1', tags }).action, 'publish');
  assert.equal(planVersion({ version: '0.2.1', parentVersion: '0.2.1', head: 'c1', tags }).action, 'skip');
  assert.equal(planVersion({ version: '0.2.1', parentVersion: '0.2.1', head: 'c1', tags, dispatched: true }).action, 'publish');
  assert.deepEqual(workflow.on.push.branches, ['main']);
  assert.ok(workflow.on.workflow_dispatch.inputs.version);
});

test('PUB-2: one version in every file, higher than every other tag; its own tag at this commit resumes, at another fails', () => {
  assert.deepEqual(versionMismatches({ 'package.json': '0.2.1', 'release.json': '0.2.1', 'plugins/agent-cloud/bundle.json': '0.2.0' }), ['plugins/agent-cloud/bundle.json has 0.2.0, package.json has 0.2.1']);
  assert.deepEqual(versionMismatches({ 'package.json': '0.2.1', 'release.json': '0.2.1' }), []);
  const tags = { 'v0.1.0-alpha.3': 'a', 'v0.2.0': 'b' };
  assert.match(planVersion({ version: '0.2.0', parentVersion: '0.1.1', head: 'x', tags: { 'v0.2.0': 'b', 'v0.2.1': 'c' } }).why, /tag never moves|isn't higher/);
  assert.match(planVersion({ version: '0.1.9', parentVersion: '0.1.8', head: 'x', tags }).why, /isn't higher than v0\.2\.0/);
  assert.equal(planVersion({ version: '0.2.1', parentVersion: '0.2.0', head: 'x', tags: { ...tags, 'v0.2.1': 'x' } }).action, 'resume');
  assert.equal(planVersion({ version: '0.2.1', parentVersion: '0.2.0', head: 'x', tags: { ...tags, 'v0.2.1': 'y' } }).action, 'fail');
  assert.throws(() => planVersion({ version: 'banana', parentVersion: '0.2.0', head: 'x', tags }), /isn't a version/);
  // Pre-release ordering, as semver orders it.
  const ordered = ['0.1.0-alpha.2', '0.1.0-alpha.3', '0.1.0-alpha.10', '0.1.0-beta', '0.1.0', '0.1.1', '0.2.0'];
  assert.deepEqual([...ordered].reverse().sort(compareVersions), ordered);
});

test('PUB-3: the release owner\'s checks and the --release gate all run before anything is tagged', () => {
  const tag = at('publish', (s) => s.name === 'Tag');
  for (const run of ['npm ci', 'npm test', 'npm run typecheck', 'npm run check:generated', 'npm run build -- --release']) {
    const i = at('publish', (s) => s.run === run);
    assert.ok(i >= 0 && i < tag, run);
  }
});

test('PUB-4: a changed license or listing asks the release owner, by the bytes and values the loader selects; nothing else does', (t) => {
  const copy = () => {
    const dir = temporary(t);
    mkdirSync(join(dir, 'release-assets'));
    for (const f of ['release.config.json', 'release-assets/LICENSE', 'release-assets/icon.png']) copyFileSync(join(root, f), join(dir, f));
    return dir;
  };
  const config = (dir: string, edit: (c: any) => void) => { const c = JSON.parse(readFileSync(join(dir, 'release.config.json'), 'utf8')); edit(c); writeFileSync(join(dir, 'release.config.json'), JSON.stringify(c)); };
  const base = releaseSelection(copy());
  assert.deepEqual(ownerChanges(base, releaseSelection(copy())), [], 'the same release: nobody asked');
  assert.deepEqual(ownerChanges(null, base), ['there is no released tag yet']);
  let dir = copy(); config(dir, (c) => { c.license.id = 'MIT'; });
  assert.deepEqual(ownerChanges(base, releaseSelection(dir)), ['license identifier Apache-2.0 → MIT']);
  dir = copy(); writeFileSync(join(dir, 'release-assets/LICENSE'), 'Other terms.\n');
  assert.deepEqual(ownerChanges(base, releaseSelection(dir)), ['license text']);
  dir = copy(); writeFileSync(join(dir, 'OTHER-LICENSE'), 'Other terms.\n'); config(dir, (c) => { c.license.file = 'OTHER-LICENSE'; });
  assert.deepEqual(ownerChanges(base, releaseSelection(dir)), ['license text'], 'license.file naming other bytes');
  dir = copy(); copyFileSync(join(dir, 'release-assets/LICENSE'), join(dir, 'MOVED-LICENSE')); config(dir, (c) => { c.license.file = 'MOVED-LICENSE'; });
  assert.deepEqual(ownerChanges(base, releaseSelection(dir)), [], 'a moved license with the same bytes');
  dir = copy(); copyFileSync(join(dir, 'release-assets/icon.png'), join(dir, 'moved.png')); config(dir, (c) => { c.plugin.icon = 'moved.png'; });
  assert.deepEqual(ownerChanges(base, releaseSelection(dir)), [], 'a moved icon with the same bytes');
  dir = copy(); config(dir, (c) => { c.plugin.shortDescription = 'Host what agents build'; });
  assert.deepEqual(ownerChanges(base, releaseSelection(dir)), ['listing: plugin']);
  dir = copy(); config(dir, (c) => { c.marketplace.category = 'Productivity'; });
  assert.deepEqual(ownerChanges(base, releaseSelection(dir)), ['listing: marketplace']);
  // The baseline is the newest PUBLISHED release: never a tag alone, a draft or a quarantined release (codex on #18).
  const r = (tagName: string, isDraft = false, isPrerelease = false) => ({ tagName, isDraft, isPrerelease });
  assert.equal(newestPublished([r('v1.0.0'), r('v1.1.0', true), r('v1.2.0', false, true), r('v1.3.0-rc.1')]), 'v1.0.0');
  assert.equal(newestPublished([]), undefined);
  // The owner's job holds on the release environment, and publish waits for it only when it ran.
  assert.equal(workflow.jobs.owner.environment, 'release');
  assert.match(workflow.jobs.owner.if, /needs_owner == 'true'/);
  assert.match(workflow.jobs.publish.if, /needs\.owner\.result == 'success' \|\| needs\.owner\.result == 'skipped'/);
});

test('PUB-4: the plan measures from the newest published release in a real repository, not an unpublished tag after it', (t) => {
  const dir = temporary(t);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' });
  mkdirSync(join(dir, 'release-assets')); mkdirSync(join(dir, 'plugins/agent-cloud/.claude-plugin'), { recursive: true });
  copyFileSync(join(root, 'release.config.json'), join(dir, 'release.config.json'));
  copyFileSync(join(root, 'release-assets/icon.png'), join(dir, 'release-assets/icon.png'));
  const at = (version: string, license: string) => {
    for (const f of ['package.json', 'package-lock.json', 'release.json', 'plugins/agent-cloud/plugin.json', 'plugins/agent-cloud/.claude-plugin/plugin.json', 'plugins/agent-cloud/bundle.json']) writeFileSync(join(dir, f), JSON.stringify({ version }));
    writeFileSync(join(dir, 'release-assets/LICENSE'), license);
    git('add', '-A'); git('commit', '-qm', version); git('tag', `v${version}`);
  };
  git('init', '-q');
  at('1.0.0', 'License A\n'); at('1.1.0', 'License B\n'); at('1.2.0', 'License B\n'); git('tag', '-d', 'v1.2.0');
  const plan = (releases: object[]) => {
    const out = join(dir, '..', `out-${Math.random()}`); writeFileSync(out, '');
    process.env.GITHUB_OUTPUT = out;
    try { main(['plan', '--releases', JSON.stringify(releases)], dir); } finally { delete process.env.GITHUB_OUTPUT; }
    return Object.fromEntries(readFileSync(out, 'utf8').trim().split('\n').map((l) => l.split('=') as [string, string]));
  };
  const published = { tagName: 'v1.0.0', isDraft: false, isPrerelease: false };
  const got = plan([published, { tagName: 'v1.1.0', isDraft: true, isPrerelease: false }]);
  assert.deepEqual([got.publish, got.version, got.needs_owner, got.changes], ['true', '1.2.0', 'true', 'license text'], 'v1.1.0 is only a draft: measured from v1.0.0');
  assert.equal(plan([published, { tagName: 'v1.1.0', isDraft: false, isPrerelease: false }]).needs_owner, 'false', 'published v1.1.0 has the same license');
});

test('PUB-6, PUB-8: an existing release is completed if it\'s a draft, topped up if published, and never resumed once quarantined', () => {
  const wanted = ['a-claude.zip', 'a-openai.zip', 'SHA256SUMS'];
  assert.deepEqual(releaseAction({ version: '1.2.0', existing: null, wanted }), { action: 'create', upload: wanted });
  assert.deepEqual(releaseAction({ version: '1.2.0', existing: { isDraft: true, isPrerelease: false, assets: ['a-claude.zip'] }, wanted }), { action: 'complete', upload: wanted, clobber: true }, 'a stopped run\'s draft: every asset again, then published');
  assert.deepEqual(releaseAction({ version: '1.2.0', existing: { isDraft: false, isPrerelease: false, assets: ['a-claude.zip'] }, wanted }), { action: 'keep', upload: ['a-openai.zip', 'SHA256SUMS'] }, 'published: only what it lacks, never replacing one');
  assert.deepEqual(releaseAction({ version: '1.2.0', existing: { isDraft: false, isPrerelease: false, assets: wanted }, wanted }), { action: 'keep', upload: [] });
  assert.match(releaseAction({ version: '1.2.0', existing: { isDraft: false, isPrerelease: true, assets: wanted }, wanted }).why!, /quarantined.*higher version/, 'rolled back or failed verify: refused');
  assert.equal(releaseAction({ version: '1.3.0-rc.1', existing: { isDraft: false, isPrerelease: true, assets: wanted }, wanted }).action, 'keep', 'a pre-release version is a pre-release by design');
  const run = steps('publish')[at('publish', (s) => s.name === 'Release')]!.run!;
  assert.match(run, /release\.mjs release-action/);
  assert.match(run, /complete\)[\s\S]*--clobber[\s\S]*--draft=false/);
  assert.doesNotMatch(run.split('keep)')[1]!, /--clobber/, 'a published release\'s assets are never replaced');
});

test('PUB-5, PUB-7: a ZIP that differs from SHA256SUMS, the build or the release keeps stable where it was', (t) => {
  const built = { 'submissions/a-claude.zip': hash('claude'), 'submissions/a-openai.zip': hash('openai') };
  const sums = `${hash('report')}  release-report.json\n${hash('claude')}  submissions/a-claude.zip\n${hash('openai')}  submissions/a-openai.zip\n${hash('x')}  repository/README.md\n`;
  const assets = { 'a-claude.zip': hash('claude'), 'a-openai.zip': hash('openai'), SHA256SUMS: hash(sums) };
  assert.deepEqual(assetProblems({ sums, assets, built }), []);
  assert.match(assetProblems({ sums, assets, built: { ...built, 'submissions/a-claude.zip': hash('edited') } }).join(), /SHA256SUMS says .*, the build made/, 'a ZIP edited after SHA256SUMS');
  assert.match(assetProblems({ sums, assets: { ...assets, 'a-openai.zip': hash('tampered') }, built }).join(), /the release has .*, the build made/);
  const { 'a-claude.zip': _gone, ...missing } = assets;
  assert.match(assetProblems({ sums, assets: missing, built }).join(), /a-claude\.zip is missing from the release/);
  assert.match(assetProblems({ sums, assets: { ...assets, 'extra.zip': hash('extra') }, built }).join(), /extra\.zip, which the build didn't make/);
  assert.equal(channelProblem('c1', 'c1'), undefined);
  assert.match(channelProblem('c0', 'c1')!, /stable reads c0 from GitHub, not c1/);
  // The CLI, as the workflow runs it, on real files.
  const dir = temporary(t);
  mkdirSync(join(dir, 'built/submissions'), { recursive: true }); mkdirSync(join(dir, 'assets'));
  for (const [name, text] of [['a-claude.zip', 'claude'], ['a-openai.zip', 'openai']]) { writeFileSync(join(dir, 'built/submissions', name!), text!); writeFileSync(join(dir, 'assets', name!), text!); }
  writeFileSync(join(dir, 'assets/SHA256SUMS'), sums);
  main(['verify', '--assets', join(dir, 'assets'), '--built', join(dir, 'built')]);
  writeFileSync(join(dir, 'assets/a-openai.zip'), 'tampered');
  assert.throws(() => main(['verify', '--assets', join(dir, 'assets'), '--built', join(dir, 'built')]), /don't verify/);
  // Order: verified, then stable, then read back; checksums before the tag.
  assert.ok(at('publish', (s) => s.name === 'Checksums') < at('publish', (s) => s.name === 'Tag'));
  assert.ok(at('publish', (s) => s.name === "Verify the release's assets") < at('publish', (s) => s.name === 'Move stable'));
  const move = steps('publish')[at('publish', (s) => s.name === 'Move stable')]!.run!;
  assert.match(move, /release\.mjs channel --read/);
  // The channel moves only to a published release, checked right before the push (codex on #18).
  assert.ok(move.indexOf('release.mjs ready') >= 0 && move.indexOf('release.mjs ready') < move.indexOf('git push'));
  assert.equal(releaseNotReady('1.2.0', { isDraft: false, isPrerelease: false }), undefined);
  assert.match(releaseNotReady('1.2.0', { isDraft: true, isPrerelease: false })!, /draft/);
  assert.match(releaseNotReady('1.2.0', { isDraft: false, isPrerelease: true })!, /quarantined/);
  assert.match(releaseNotReady('1.2.0', null)!, /no GitHub release/);
});

test('PUB-6: a pre-release is published as one and never moves stable', () => {
  assert.equal(isPrerelease('0.3.0-rc.1'), true);
  assert.equal(isPrerelease('0.3.0'), false);
  assert.match(steps('publish')[at('publish', (s) => s.name === 'Release')]!.run!, /--prerelease/);
  assert.equal(steps('publish')[at('publish', (s) => s.name === 'Move stable')]!.if, "${{ needs.plan.outputs.prerelease != 'true' }}");
});

test('PUB-8: a re-run keeps a tag at this commit and a release that exists, and runs are never cancelled', () => {
  assert.match(steps('publish')[at('publish', (s) => s.name === 'Tag')]!.run!, /test "\$\(git rev-parse "\$TAG\^\{commit\}"\)" = "\$GITHUB_SHA"/);
  assert.match(steps('publish')[at('publish', (s) => s.name === 'Release')]!.run!, /gh release view "\$TAG" --json isDraft,isPrerelease,assets/);
  // Every pending run is kept: a docs push behind a waiting version bump never replaces it (codex on #18).
  assert.deepEqual(workflow.concurrency, { group: 'release', 'cancel-in-progress': false, queue: 'max' });
  assert.ok(workflow.on.workflow_dispatch.inputs.version, 'a stopped run is resumed by hand');
});

test('PUB-9: a rollback moves stable only to an older, released, non-pre-release tag', () => {
  const tags = { 'v0.1.1': 'a', 'v0.2.0': 'b', 'v0.2.1-rc.1': 'c', 'v0.2.1': 'd', 'v0.1.2': 'e', 'v0.1.3': 'f', 'v0.1.4': 'g' };
  const r = (tagName: string, isDraft = false, isPrerelease = false) => ({ tagName, isDraft, isPrerelease });
  const releases = [r('v0.1.1'), r('v0.2.0'), r('v0.2.1-rc.1', false, true), r('v0.2.1'), r('v0.1.3', true), r('v0.1.4', false, true)];
  const back = (to: string) => rollbackTarget({ to, tags, releases, channelVersion: '0.2.1' });
  assert.deepEqual(back('v0.2.0'), { commit: 'b' });
  assert.match(back('v0.2.1').why!, /isn't older/);
  assert.match(back('v0.2.1-rc.1').why!, /pre-release/);
  assert.match(back('v0.1.2').why!, /no GitHub release/);
  assert.match(back('v0.1.3').why!, /a draft/, 'a draft release is never a target (codex on #18)');
  assert.match(back('v0.1.4').why!, /quarantined/, 'nor one a rollback or a failed verify quarantined');
  assert.match(back('v9.9.9').why!, /isn't a tag here/);
  assert.match(back('stable').why!, /isn't a version tag/);
  assert.match(workflow.jobs.rollback.steps.at(-1).run, /gh release list --limit 200 --json tagName,isDraft,isPrerelease/);
  assert.equal(workflow.jobs['rollback-approve'].environment, 'release', 'a release owner approves first');
  assert.equal(workflow.jobs.rollback.needs, 'rollback-approve');
  assert.match(workflow.jobs.rollback.steps.at(-1).run, /git push --force[\s\S]*release\.mjs channel --read[\s\S]*--prerelease/);
});

test('PUB-10: only publish and rollback write; only the deploy key on the main-only environment moves stable', () => {
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const jobs = Object.entries(workflow.jobs) as [string, any][];
  assert.deepEqual(jobs.filter(([, job]) => job.permissions?.contents === 'write').map(([name]) => name).sort(), ['publish', 'rollback']);
  assert.deepEqual(jobs.filter(([, job]) => job.environment === 'stable-push').map(([name]) => name).sort(), ['publish', 'rollback']);
  // STABLE_DEPLOY_KEY is the only secret, and only the two steps that move stable see it.
  const keyed = jobs.flatMap(([name, job]) => (job.steps as any[]).filter((s) => JSON.stringify(s).includes('secrets.')).map((s) => `${name}/${s.name}`));
  assert.deepEqual(keyed.sort(), ['publish/Move stable', 'rollback/Move stable back']);
  const text = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');
  assert.deepEqual([...new Set([...text.matchAll(/secrets\.([A-Za-z_]+)/g)].map((m) => m[1]))], ['STABLE_DEPLOY_KEY']);
  // The pushes trust github.com's pinned host key only, and GITHUB_TOKEN never pushes stable.
  assert.match(workflow.env.GITHUB_HOST_KEY, /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl$/);
  for (const [job, step] of [['publish', 'Move stable'], ['rollback', 'Move stable back']] as const) {
    const run = steps(job)[at(job, (s) => s.name === step)]!.run!;
    assert.match(run, /StrictHostKeyChecking=yes/, step);
    assert.doesNotMatch(run, /git push (--force )?origin [^\n]*refs\/heads\/stable/, `${step} never pushes stable with GITHUB_TOKEN`);
  }
  assert.equal(workflow.jobs.plan.steps[0].with['persist-credentials'], false);
});

test('PUB-11: the summary says what the run did', () => {
  const text = summary({ what: 'Published', version: '0.2.1', tag: 'v0.2.1', commit: 'd1', release: 'https://github.com/o/r/releases/tag/v0.2.1', assets: { 'a.zip': 'f00' }, owner: null, channel: { from: 'c0', to: 'd1' } });
  for (const part of ['agent.cloud 0.2.1', '`v0.2.1` at `d1`', 'releases/tag/v0.2.1', '`a.zip`: `f00`', 'not asked: no license or listing change', 'stable: `c0` → `d1`']) assert.ok(text.includes(part), part);
  assert.ok(summary({ what: 'Published', version: '0.3.0-rc.1', tag: 'v0.3.0-rc.1', commit: 'e', channel: null }).includes('stable: not moved'));
});
