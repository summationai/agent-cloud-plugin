#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parse as parseYaml } from 'yaml';
import { unzipSync } from 'fflate';
import { checkOpenaiReview, validateIcon } from './release-config.mjs';

const ajv = new Ajv2020({ strict: true, allErrors: true });
const schemas = Object.fromEntries(['plugin', 'mcp'].map(name => [name, ajv.compile(JSON.parse(readFileSync(new URL(`../schemas/${name}.schema.json`, import.meta.url), 'utf8')))]));
const hashPattern = /^[a-f0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const versionPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const stackPattern = /^[a-z0-9-]+$/;
const startersRepository = 'https://github.com/summationai/agc-starters';
const maxArchiveBytes = 20 * 1024 * 1024;
const packageManagerFiles = new Set(['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', '.yarnrc.yml', 'deno.json', 'composer.json', 'bower.json']);

/** @param {any} starters */
export function validateStartersPin(starters) {
  if (!starters || typeof starters !== 'object' || Array.isArray(starters)) throw Error('Invalid starter pin.');
  if (typeof starters.version !== 'string' || !versionPattern.test(starters.version)) throw Error('Invalid starter pin version.');
  if (typeof starters.commit !== 'string' || !commitPattern.test(starters.commit)) throw Error('Invalid starter pin commit.');
  if (typeof starters.sha256 !== 'string' || !hashPattern.test(starters.sha256)) throw Error('Invalid starter pin sha256.');
  if (!Array.isArray(starters.stacks) || !starters.stacks.length || new Set(starters.stacks).size !== starters.stacks.length || starters.stacks.some(stack => typeof stack !== 'string' || !stackPattern.test(stack))) throw Error('Invalid starter pin stacks.');
  if (starters.repository !== startersRepository) throw Error('Invalid starter pin repository.');
  const expectedArchiveUrl = `${startersRepository}/releases/download/${starters.version}/starters-${starters.version}.tgz`;
  if (starters.archive_url !== expectedArchiveUrl) throw Error('Invalid starter pin archive_url.');
  return starters;
}

/** @param {string} stdout @param {string} version */
export function parseLsRemoteTagCommit(stdout, version) {
  const ref = `refs/tags/${version}`;
  const peeled = `${ref}^{}`;
  let direct;
  for (const line of String(stdout).split('\n')) {
    const [sha, name] = line.trim().split(/\s+/);
    if (!sha || !name || !commitPattern.test(sha)) continue;
    if (name === peeled) return sha;
    if (name === ref) direct = sha;
  }
  return direct;
}

/** @param {string} repository @param {string} version */
function defaultResolveTag(repository, version) {
  const out = execFileSync('git', ['-c', 'credential.helper=', 'ls-remote', '--tags', `${repository}.git`, `refs/tags/${version}`, `refs/tags/${version}^{}`], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return parseLsRemoteTagCommit(out, version);
}

/** @param {string} url */
async function defaultFetchArchive(url) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw Error(`Failed to download starter archive (${response.status}): ${url}`);
  if (response.url && !response.url.startsWith('https://')) throw Error(`Starter archive redirect must stay HTTPS: ${response.url}`);
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > maxArchiveBytes) throw Error(`Starter archive exceeds size limit: ${contentLength} bytes.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxArchiveBytes) throw Error(`Starter archive exceeds size limit: ${bytes.length} bytes.`);
  return bytes;
}

/** @param {any} pins @param {{ resolveTag?: (repository: string, version: string) => string | undefined | Promise<string | undefined>, fetchArchive?: (url: string) => Buffer | Uint8Array | Promise<Buffer | Uint8Array> }} [options] */
export async function verifyStartersPin(pins, { resolveTag = defaultResolveTag, fetchArchive = defaultFetchArchive } = {}) {
  if (!pins || typeof pins !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(pins.protocol_version)) throw Error('Invalid public protocol_version.');
  const starters = validateStartersPin(pins.starters);
  const tagCommit = await resolveTag(starters.repository, starters.version);
  if (!tagCommit || !commitPattern.test(tagCommit)) throw Error(`Starter tag ${starters.version} was not found at ${starters.repository}.`);
  if (tagCommit !== starters.commit) throw Error(`Starter tag ${starters.version} resolves to ${tagCommit}, not pinned ${starters.commit}.`);
  const archive = Buffer.from(await fetchArchive(starters.archive_url));
  const actualSha = createHash('sha256').update(archive).digest('hex');
  if (actualSha !== starters.sha256) throw Error(`Starter archive sha256 is ${actualSha}, not pinned ${starters.sha256}.`);
  return { valid: true, version: starters.version, commit: starters.commit, sha256: starters.sha256 };
}
export function validateTarget(files, target) {
  if (!['combined', 'openai', 'claude'].includes(target)) throw Error('Unknown artifact target.');
  const json = path => { if (!files.has(path)) throw Error(`Missing ${path}`); return JSON.parse(files.get(path).toString()); };
  const resource = path => {
    if (typeof path !== 'string' || !path.startsWith('./') || path.split('/').some(part => part === '..') || !files.has(path.slice(2))) throw Error('Manifest references an unavailable local resource.');
    return files.get(path.slice(2));
  };
  for (const [path, bytes] of files) {
    if (path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) throw Error(`Unsafe artifact path: ${path}`);
    if (bytes.length > 2 * 1024 * 1024) throw Error(`Oversized artifact resource: ${path}`);
    if (/\.(?:md|mjs|json)$/.test(path)) {
      const text = bytes.toString();
      if (/github\.com\/summationai\/agent-cloud(?:[\/\s"']|$)|e2e\/plugins\/|npm run build -w|\/Users\/|\/private\/tmp\//.test(text)) throw Error(`Private build context leaked into ${path}`);
      if (/^import .* from ['"](?!node:)/m.test(text) && path.endsWith('.mjs')) throw Error(`Helper has an external runtime dependency: ${path}`);
      if (path.endsWith('.md')) for (const [, link] of text.matchAll(/\]\(([^)]+)\)/g)) {
        if (/^https?:/.test(link) || link.startsWith('#')) continue;
        const local = posix.normalize(posix.join(posix.dirname(path), link.split('#')[0]));
        if (!files.has(local) || local.startsWith('../')) throw Error(`Unresolved resource: ${path} -> ${link}`);
      }
    }
  }
  if (target !== 'claude') {
    const manifest = json('plugin.json');
    const extension = manifest.extensions?.['com.openai'];
    const mcp = json('mcp.json');
    checkOpenaiReview(extension?.review, target, mcp);
    for (const [name, value] of [['plugin', manifest], ['mcp', mcp]]) if (!schemas[name](value)) throw Error(`Invalid portable ${name}: ${JSON.stringify(schemas[name].errors)}`);
    resource(extension?.onboardingSkill);
    const listing = extension?.interface;
    for (const [key, max] of [['displayName', 30], ['shortDescription', 30], ['longDescription', 4000], ['developerName', 80]]) if (typeof listing?.[key] !== 'string' || !listing[key].length || listing[key].length > max) throw Error(`Invalid OpenAI listing ${key}.`);
    for (const key of ['composerIcon', 'logo']) if (listing[key]) validateIcon(resource(listing[key]));
  }
  if (target !== 'openai') {
    const manifest = json('.claude-plugin/plugin.json'), mcp = json('.mcp.json');
    if (manifest.name !== 'agent-cloud' || !manifest.version || !manifest.description || !manifest.displayName) throw Error('Invalid Claude identity.');
    if (!mcp.mcpServers || Object.values(mcp.mcpServers).some(server => server.type !== 'http' || !server.url?.startsWith('https://'))) throw Error('Invalid Claude remote MCP configuration.');
    if (manifest.icon) validateIcon(resource(manifest.icon));
  }
  if (target === 'openai' && (files.has('.mcp.json') || files.has('.claude-plugin/plugin.json'))) throw Error('OpenAI ZIP contains Claude configuration.');
  if (target === 'claude' && (files.has('mcp.json') || files.has('plugin.json'))) throw Error('Claude ZIP contains portable configuration.');
  // The OpenAI submission ZIP has no canvas: the portal connects one MCP server, so the canvas skill would have no tools.
  if (target === 'openai' && [...files.keys()].some(path => /canvas/.test(path))) throw Error('OpenAI ZIP contains the canvas.');
  for (const name of ['setup', 'build-and-host', 'manage-app', ...(target === 'openai' ? [] : ['canvas'])]) {
    const text = files.get(`skills/${name}/SKILL.md`)?.toString();
    const match = text?.match(/^---\n([\s\S]*?)\n---\n/);
    if (!match) throw Error(`Missing skill metadata: ${name}`);
    const fields = parseYaml(match[1]);
    if (fields.name !== name || typeof fields.description !== 'string' || !fields.description.length) throw Error(`Invalid skill: ${name}`);
  }
  const bundle = json('bundle.json');
  if (!files.has('README.md') || !files.has('references/starters.json')) throw Error('Artifact is not self-contained.');
  validateStartersPin(json('references/starters.json'));
  // Codex runs the bundled connection helper. The Claude directory accepts no scripts from an unverified organization,
  // so the Claude tree holds only Markdown, JSON, the license and images, no package-manager configuration (which can
  // end in .json or .yaml), no .claude folder or second .claude-plugin folder, and no file that starts with #!.
  if (target !== 'claude' && !files.has('scripts/connect-codex.mjs')) throw Error('Artifact is not self-contained.');
  if (target === 'claude') for (const [path, bytes] of files) {
    if (!/\.(?:md|txt|json|ya?ml|png|jpe?g|gif|webp|ico)$/.test(path) && path !== 'LICENSE') throw Error(`Claude directory refuses this file type: ${path}`);
    if (packageManagerFiles.has(posix.basename(path))) throw Error(`Claude directory refuses package-manager configuration: ${path}`);
    if (path.split('/').includes('.claude') || (path.split('/').includes('.claude-plugin') && path !== '.claude-plugin/plugin.json')) throw Error(`Claude directory refuses this folder: ${path}`);
    if (bytes.subarray(0, 2).toString() === '#!') throw Error(`Claude directory refuses a file that starts with #!: ${path}`);
  }
  if (JSON.stringify([...files.keys()].sort()) !== JSON.stringify([...Object.keys(bundle.files), 'bundle.json'].sort())) throw Error('Incomplete bundle inventory.');
  for (const [path, info] of Object.entries(bundle.files)) {
    const bytes = files.get(path);
    if (!hashPattern.test(info.sha256) || info.sha256 !== createHash('sha256').update(bytes).digest('hex') || info.bytes !== bytes.length) throw Error(`Resource integrity mismatch: ${path}`);
  }
  for (const path of ['plugin.json', '.claude-plugin/plugin.json'].filter(path => files.has(path))) {
    const manifest = json(path);
    if (manifest.version !== bundle.version || manifest.name !== bundle.name) throw Error('Manifest and bundle versions differ.');
  }
  for (const path of ['mcp.json', '.mcp.json'].filter(path => files.has(path))) {
    // agent.cloud's own server, which must match the bundle, and at most the canvas beside it, over HTTPS.
    const { canvas, ...servers } = json(path).mcpServers;
    if (Object.values(servers).length !== 1 || Object.values(servers)[0].url !== bundle.resource) throw Error('Manifest and bundle environments differ.');
    if (canvas && (target === 'openai' || !canvas.url?.startsWith('https://'))) throw Error('Invalid canvas MCP configuration.');
  }
  return { target, valid: true, files: files.size, version: bundle.version, protocol_version: bundle.protocol_version, environment: bundle.environment };
}

export function readArtifactDirectory(directory, prefix = '') {
  const files = new Map();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isSymbolicLink()) throw Error(`Artifact symlink refused: ${path}`);
    if (entry.isDirectory()) for (const [child, bytes] of readArtifactDirectory(join(directory, entry.name), `${path}/`)) files.set(child, bytes);
    else if (entry.isFile()) files.set(path, readFileSync(join(directory, entry.name)));
    else throw Error(`Unsupported artifact entry: ${path}`);
  }
  return files;
}
export function readArtifactZip(bytes) {
  return new Map(Object.entries(unzipSync(bytes, { filter: file => {
    if (file.originalSize > 2 * 1024 * 1024) throw Error('Oversized ZIP resource.');
    return true;
  } })).map(([path, value]) => [path, Buffer.from(value)]));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [target, path, ...extra] = process.argv.slice(2);
    if (target === 'pins') {
      if (extra.length) throw Error('Use validate.mjs pins [/path/to/pins.json]');
      const pinsPath = path ? resolve(path) : fileURLToPath(new URL('../pins.json', import.meta.url));
      console.log(JSON.stringify(await verifyStartersPin(JSON.parse(readFileSync(pinsPath, 'utf8')))));
    } else {
      if (!path || extra.length) throw Error('Use validate.mjs combined|openai|claude /absolute/plugin-directory-or.zip');
      const files = path.endsWith('.zip') ? readArtifactZip(readFileSync(path)) : readArtifactDirectory(path);
      console.log(JSON.stringify(validateTarget(files, target)));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
