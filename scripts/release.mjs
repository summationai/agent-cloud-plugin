// PUB-1 to PUB-11 (PUBLISHING.md): the release workflow's decisions, as functions of plain inputs. The workflow
// (.github/workflows/release.yml) only gathers those inputs, calls the CLI at the bottom and runs the commands it names.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadReleaseConfig } from './release-config.mjs';

export const CHANNEL = 'stable';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Semver: `major.minor.patch` with an optional pre-release. */
export function parseVersion(version) {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
  if (!m) throw Error(`${version} isn't a version (major.minor.patch, with an optional -pre-release).`);
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
}
export const isPrerelease = version => parseVersion(version).pre.length > 0;
/** Semver precedence: negative when `a` comes before `b`. */
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) - Number(q);
    return pn ? -1 : qn ? 1 : p < q ? -1 : 1;
  }
  return 0;
}
const versionOfTag = tag => { try { return /^v/.test(tag) ? (parseVersion(tag.slice(1)), tag.slice(1)) : undefined; } catch { return undefined; } };

/** PUB-2: every file that carries the version, against package.json's. */
export function versionMismatches(versions) {
  const want = versions['package.json'];
  return Object.entries(versions).filter(([, v]) => v !== want).map(([path, v]) => `${path} has ${v ?? 'no version'}, package.json has ${want}`);
}

/**
 * PUB-1, PUB-2, PUB-8: what this run does for `version` at `head`. `tags` maps each tag to its commit.
 * `publish` for a new version, `resume` when its own tag is already at this commit, `skip` when the version didn't change
 * (a push only), `fail` with why otherwise.
 */
export function planVersion({ version, parentVersion, head, tags, dispatched = false }) {
  if (!dispatched && version === parentVersion) return { action: 'skip', why: `the version stayed ${version}` };
  parseVersion(version);
  const own = tags[`v${version}`];
  if (own && own !== head) return { action: 'fail', why: `v${version} already points at ${own}, not ${head}; a tag never moves: bump the version` };
  const higher = Object.keys(tags).filter(t => t !== `v${version}`).map(versionOfTag).filter(v => v && compareVersions(version, v) <= 0);
  if (higher.length) return { action: 'fail', why: `${version} isn't higher than v${higher.sort(compareVersions).at(-1)}` };
  return own ? { action: 'resume', why: `v${version} is already at ${head}: picking up where the last run stopped` } : { action: 'publish', why: version === parentVersion ? `a manual run for ${version}` : `${parentVersion ?? 'nothing'} → ${version}` };
}

/** PUB-4: what the release-ready build selects, by content: the license and the listing. */
export function releaseSelection(root) {
  const { config, license, icon } = loadReleaseConfig(root);
  const { icon: _path, ...plugin } = config.plugin;
  return { license: { id: config.license.id, text: license ? sha256(license) : null }, listing: { marketplace: config.marketplace, plugin, openai: config.openai, icon: icon ? sha256(icon.bytes) : null } };
}
/** PUB-4: what changed that the release owner decides; with no released tag, everything is new. */
export function ownerChanges(previous, next) {
  if (!previous) return ['there is no released tag yet'];
  const changes = [];
  if (previous.license.id !== next.license.id) changes.push(`license identifier ${previous.license.id} → ${next.license.id}`);
  if (previous.license.text !== next.license.text) changes.push('license text');
  for (const key of ['marketplace', 'plugin', 'openai']) if (JSON.stringify(previous.listing[key]) !== JSON.stringify(next.listing[key])) changes.push(`listing: ${key}`);
  if (previous.listing.icon !== next.listing.icon) changes.push('listing: icon');
  return changes;
}

/** PUB-5, PUB-7: SHA256SUMS as `sum  name` lines. */
export function parseSums(text) {
  return Object.fromEntries(text.split('\n').filter(Boolean).map(line => {
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trim());
    if (!m) throw Error(`SHA256SUMS has a line that isn't "sum  name": ${line}`);
    return [m[2], m[1]];
  }));
}
/**
 * PUB-5, PUB-7: what's wrong with a release's ZIPs. `sums` is SHA256SUMS' text, which names every build output by its path
 * in dist/production (`submissions/<zip>` for the ZIPs). `built` maps each ZIP's path there to the build's digest, and
 * `assets` maps each release asset's name to its digest as downloaded. Empty when every ZIP is in the release and matches both.
 */
export function assetProblems({ sums, assets, built }) {
  const listed = parseSums(sums), problems = [];
  if (!Object.keys(built).length) problems.push('the build made no ZIP');
  for (const [path, digest] of Object.entries(built)) {
    const name = path.split('/').at(-1);
    if (listed[path] !== digest) problems.push(`${path}: SHA256SUMS says ${listed[path] ?? 'nothing'}, the build made ${digest}`);
    if (assets[name] === undefined) problems.push(`${name} is missing from the release`);
    else if (assets[name] !== digest) problems.push(`${name}: the release has ${assets[name]}, the build made ${digest}`);
  }
  for (const name of Object.keys(assets)) if (name.endsWith('.zip') && !Object.keys(built).some(p => p.endsWith(`/${name}`))) problems.push(`the release has ${name}, which the build didn't make`);
  return problems;
}

/** PUB-7, PUB-9: the channel read back after a push must be the commit it was pushed to. */
export function channelProblem(readBack, want) {
  return readBack === want ? undefined : `${CHANNEL} reads ${readBack || 'nothing'} from GitHub, not ${want}`;
}

/**
 * PUB-9: where a rollback may move the channel. `released` lists the tags with a GitHub release, `channelVersion` is the
 * version the channel is at now. Only an older, released, non-pre-release tag.
 */
export function rollbackTarget({ to, tags, released, channelVersion }) {
  const version = versionOfTag(to);
  if (!version) return { why: `${to} isn't a version tag (v<version>)` };
  if (!tags[to]) return { why: `${to} isn't a tag here` };
  if (!released.includes(to)) return { why: `${to} has no GitHub release` };
  if (isPrerelease(version)) return { why: `${to} is a pre-release, which ${CHANNEL} never carries` };
  if (compareVersions(version, channelVersion) >= 0) return { why: `${to} isn't older than ${CHANNEL}'s ${channelVersion}` };
  return { commit: tags[to] };
}

/**
 * PUB-11: the job summary.
 * @param {{ what: string, version: string, tag: string, commit: string, release?: string, assets?: Record<string, string>, owner?: string | null, channel?: { from: string, to: string } | null }} fields
 */
export function summary({ what, version, tag, commit, release, assets = {}, owner, channel }) {
  return [`## ${what} agent.cloud ${version}`, '',
    `- Tag: \`${tag}\` at \`${commit}\``,
    ...(release ? [`- Release: ${release}`] : []),
    ...Object.entries(assets).map(([name, digest]) => `- \`${name}\`: \`${digest}\``),
    `- Release owner: ${owner ?? 'not asked: no license or listing change'}`,
    `- ${CHANNEL}: ${channel ? `\`${channel.from || 'nothing'}\` → \`${channel.to}\`` : 'not moved'}`, ''].join('\n');
}

// The workflow's calls. Each prints what it decided and writes its outputs to $GITHUB_OUTPUT.
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
function output(values) {
  for (const [key, value] of Object.entries(values)) {
    console.log(`${key}=${value}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}
function tagsHere() {
  const lines = git('for-each-ref', '--format=%(refname:short) %(*objectname) %(objectname)', 'refs/tags');
  return Object.fromEntries(lines.split('\n').filter(Boolean).map(l => { const [name, peeled, object] = l.split(' '); return [name, peeled || object]; }));
}
function selectionAt(ref) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-cloud-release-')));
  try {
    execFileSync('sh', ['-c', 'git archive "$1" | tar -x -C "$2"', 'archive', ref, dir]);
    return releaseSelection(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const digests = (dir, prefix = '') => Object.fromEntries(readdirSync(dir).filter(n => n.endsWith('.zip')).map(n => [`${prefix}${n}`, sha256(readFileSync(join(dir, n)))]));

export function main(argv, root = process.cwd()) {
  const [command, ...rest] = argv;
  const flag = name => { const i = rest.indexOf(`--${name}`); return i === -1 ? undefined : rest[i + 1]; };
  const read = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
  if (command === 'plan') {
    const version = read('package.json').version;
    const head = git('rev-parse', 'HEAD');
    const dispatched = flag('version') !== undefined;
    if (dispatched && flag('version') !== version) throw Error(`This commit's version is ${version}, not ${flag('version')}.`);
    let parentVersion;
    try { parentVersion = JSON.parse(git('show', 'HEAD^1:package.json')).version; } catch { parentVersion = undefined; }
    const tags = tagsHere();
    const plan = planVersion({ version, parentVersion, head, tags, dispatched });
    const mismatched = plan.action === 'skip' ? [] : versionMismatches({
      'package.json': version, 'package-lock.json': read('package-lock.json').version, 'release.json': read('release.json').version,
      'plugins/agent-cloud/plugin.json': read('plugins/agent-cloud/plugin.json').version,
      'plugins/agent-cloud/.claude-plugin/plugin.json': read('plugins/agent-cloud/.claude-plugin/plugin.json').version,
      'plugins/agent-cloud/bundle.json': read('plugins/agent-cloud/bundle.json').version,
    });
    if (plan.action === 'fail' || mismatched.length) throw Error([plan.action === 'fail' ? plan.why : '', ...mismatched].filter(Boolean).join('; '));
    const go = plan.action !== 'skip';
    const previous = Object.keys(tags).filter(t => t !== `v${version}`).map(versionOfTag).filter(v => v && !isPrerelease(v)).sort(compareVersions).at(-1);
    let before = null;
    if (go && previous) try { before = selectionAt(`v${previous}`); } catch (e) { before = { unreadable: `v${previous}'s license and listing can't be read (${e instanceof Error ? e.message : e})` }; }
    const changes = !go ? [] : before?.unreadable ? [before.unreadable] : ownerChanges(before, releaseSelection(root));
    console.log(plan.why);
    output({ publish: go, resume: plan.action === 'resume', version, prerelease: isPrerelease(version), needs_owner: changes.length > 0, changes: changes.join('; ') || 'none' });
    return;
  }
  if (command === 'verify') {
    // --built is dist/production: its ZIPs are under submissions/, as SHA256SUMS names them.
    const problems = assetProblems({ sums: readFileSync(join(flag('assets'), 'SHA256SUMS'), 'utf8'), assets: digests(flag('assets')), built: digests(join(flag('built'), 'submissions'), 'submissions/') });
    if (problems.length) throw Error(`The release's assets don't verify: ${problems.join('; ')}`);
    console.log('The release\'s assets match SHA256SUMS and the build.');
    return;
  }
  if (command === 'channel') {
    const problem = channelProblem(flag('read'), flag('want'));
    if (problem) throw Error(problem);
    console.log(`${CHANNEL} is at ${flag('want')}.`);
    return;
  }
  if (command === 'rollback') {
    const target = rollbackTarget({ to: flag('to'), tags: tagsHere(), released: (flag('released') ?? '').split(',').filter(Boolean), channelVersion: flag('channel-version') });
    if (!target.commit) throw Error(`Rollback refused: ${target.why}.`);
    output({ commit: target.commit });
    return;
  }
  if (command === 'summary') {
    const text = summary(JSON.parse(flag('json')));
    console.log(text);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
    return;
  }
  throw Error('Use release.mjs plan [--version <v>] | verify --assets <dir> --built <dist/production> | channel --read <sha> --want <sha> | rollback --to v<version> --released <tags> --channel-version <v> | summary --json <fields>.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(1); }
}
