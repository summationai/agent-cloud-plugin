#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parse as parseYaml } from 'yaml';
import { unzipSync } from 'fflate';
import { portableMcpConfig, validateIcon } from './release-config.mjs';

const ajv = new Ajv2020({ strict: true, allErrors: true });
const schemas = Object.fromEntries(['plugin', 'mcp'].map(name => [name, ajv.compile(JSON.parse(readFileSync(new URL(`../schemas/${name}.schema.json`, import.meta.url), 'utf8')))]));
const hashPattern = /^[a-f0-9]{64}$/;
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
    // Only portal submissions permit review extensions. Validate installed
    // bytes directly so metadata stripping cannot hide a runtime parse error.
    const transport = portableMcpConfig(mcp, extension?.review);
    for (const [name, value] of [['plugin', manifest], ['mcp', target === 'combined' ? mcp : transport]]) if (!schemas[name](value)) throw Error(`Invalid portable ${name}: ${JSON.stringify(schemas[name].errors)}`);
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
  for (const name of ['setup', 'build-and-host', 'manage-app', 'canvas']) {
    const text = files.get(`skills/${name}/SKILL.md`)?.toString();
    const match = text?.match(/^---\n([\s\S]*?)\n---\n/);
    if (!match) throw Error(`Missing skill metadata: ${name}`);
    const fields = parseYaml(match[1]);
    if (fields.name !== name || typeof fields.description !== 'string' || !fields.description.length) throw Error(`Invalid skill: ${name}`);
  }
  const bundle = json('bundle.json');
  if (!files.has('README.md') || !files.has('scripts/connect-codex.mjs') || !files.has('references/starters.json')) throw Error('Artifact is not self-contained.');
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
    if (canvas && !canvas.url?.startsWith('https://')) throw Error('Invalid canvas MCP configuration.');
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
    if (!path || extra.length) throw Error('Use validate.mjs combined|openai|claude /absolute/plugin-directory-or.zip');
    const files = path.endsWith('.zip') ? readArtifactZip(readFileSync(path)) : readArtifactDirectory(path);
    console.log(JSON.stringify(validateTarget(files, target)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
