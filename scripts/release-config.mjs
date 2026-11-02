import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { PNG } from 'pngjs';

const text = { type: 'string', minLength: 1, maxLength: 2048 };
const optionalText = { anyOf: [text, { type: 'null' }] };
const person = { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 80 }, email: { type: 'string', minLength: 1, maxLength: 320 }, url: text } };
const caseProperties = { description: text, prompt: text, tools_triggered: text, expected_behavior: text, file_attachment_urls: { type: 'array', maxItems: 10, items: text }, expected_output_url: text };
const testCasesSchema = { type: 'object', additionalProperties: false, properties: {
  positive: { type: 'array', maxItems: 5, items: { type: 'object', additionalProperties: false, required: ['description', 'prompt', 'tools_triggered', 'expected_behavior'], properties: caseProperties } },
  negative: { type: 'array', maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['description', 'prompt'], properties: caseProperties } },
} };
const reviewSchema = { type: 'object', additionalProperties: false, properties: {
  demo_recording_url: text, commerce: { type: 'boolean' }, commerce_description: text,
} };
const serverReviewSchema = { type: 'object', additionalProperties: false, properties: { test_cases: testCasesSchema } };
const nullableServerReview = { anyOf: [serverReviewSchema, { type: 'null' }] };
const schema = {
  type: 'object', additionalProperties: false, required: ['repository', 'marketplace', 'plugin', 'license', 'openai'],
  properties: {
    repository: { type: 'string', pattern: '^https://github\\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' },
    marketplace: { type: 'object', additionalProperties: false, required: ['name', 'displayName', 'description', 'owner', 'category'], properties: { name: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }, displayName: text, description: text, owner: person, category: text } },
    plugin: { type: 'object', additionalProperties: false, required: ['displayName', 'shortDescription', 'description', 'author', 'homepage', 'keywords'], properties: { displayName: { type: 'string', minLength: 1, maxLength: 30 }, shortDescription: { type: 'string', minLength: 1, maxLength: 30 }, description: { type: 'string', minLength: 1, maxLength: 4000 }, author: person, homepage: text, supportURL: optionalText, documentationURL: optionalText, privacyPolicyURL: optionalText, termsOfServiceURL: optionalText, icon: optionalText, keywords: { type: 'array', maxItems: 20, items: text } } },
    license: { type: 'object', additionalProperties: false, required: ['id', 'file'], properties: { id: optionalText, file: optionalText } },
    openai: { type: 'object', additionalProperties: false, required: ['review'], properties: {
      review: { anyOf: [reviewSchema, { type: 'null' }] },
      mcpServers: { type: 'object', additionalProperties: false, properties: { 'agent-cloud': nullableServerReview, canvas: nullableServerReview } },
    } },
  },
};
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
const validateServerReview = new Ajv2020({ strict: true, allErrors: true }).compile(serverReviewSchema);
const casesIn = review => [...(review?.test_cases?.positive ?? []), ...(review?.test_cases?.negative ?? [])];
const caseUrls = review => casesIn(review).flatMap(item => [...(item.file_attachment_urls ?? []), item.expected_output_url]);
function publicUrls(values) {
  for (const value of values.filter(Boolean)) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw Error('Public metadata URLs must be HTTPS without embedded credentials.');
  }
}

// The portable 1.0.0 transport schema has no server extensions. Validate the OpenAI
// submission extension separately, then validate a transport-only copy against
// that unchanged upstream schema.
export function portableMcpConfig(mcp, review) {
  if (review?.test_cases !== undefined) throw Error('Declare MCP review cases per server, not in plugin-level review.test_cases.');
  return { ...mcp, mcpServers: Object.fromEntries(Object.entries(mcp.mcpServers ?? {}).map(([name, server]) => {
    const { extensions, ...transport } = server;
    if (extensions !== undefined) {
      if (!extensions || typeof extensions !== 'object' || Array.isArray(extensions) || Object.keys(extensions).some(key => key !== 'com.openai')) throw Error(`Invalid MCP server extensions: ${name}.`);
      const openai = extensions['com.openai'];
      if (!openai || typeof openai !== 'object' || Array.isArray(openai) || Object.keys(openai).some(key => key !== 'review') || !validateServerReview(openai.review)) throw Error(`Invalid OpenAI MCP review metadata: ${name}.`);
      publicUrls(caseUrls(openai.review));
    }
    return [name, transport];
  })) };
}

export function mcpReviewGaps(servers) {
  return Object.entries(servers).flatMap(([name, server]) => {
    const cases = server.extensions?.['com.openai']?.review?.test_cases;
    return cases?.positive?.length === 5 && cases?.negative?.length === 3 ? [] : [`Supply exactly five positive and three negative MCP review cases for ${name}.`];
  });
}
function merge(base, override) {
  return Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(override)])].map(key => {
    const value = override[key];
    return [key, value === undefined ? base[key] : value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object' ? merge(base[key], value) : value];
  }));
}
export function selectedFile(path, maxBytes = 2 * 1024 * 1024) {
  if (!lstatSync(path).isFile() || realpathSync(path) !== resolve(path)) throw Error('Release resources must be regular files without symlink parents.');
  const bytes = readFileSync(path);
  if (!bytes.length || bytes.length > maxBytes) throw Error('Release resource is empty or too large.');
  return bytes;
}
export function loadReleaseConfig(sourceRoot, overridePath) {
  const defaults = JSON.parse(readFileSync(resolve(sourceRoot, 'release.config.json'), 'utf8'));
  const configRoot = overridePath ? realpathSync(dirname(resolve(overridePath))) : sourceRoot;
  const overrides = overridePath ? JSON.parse(selectedFile(resolve(configRoot, basename(overridePath))).toString()) : {};
  const config = merge(defaults, overrides);
  if (!validate(config)) throw Error(`Invalid release configuration: ${JSON.stringify(validate.errors)}`);
  if (config.repository.replace(/\.git$/, '') === 'https://github.com/summationai/agent-cloud') throw Error('Distribution must use a dedicated public repository.');
  publicUrls([config.plugin.homepage, ...['supportURL', 'documentationURL', 'privacyPolicyURL', 'termsOfServiceURL'].map(key => config.plugin[key]), config.marketplace.owner.url, config.plugin.author.url, config.openai.review?.demo_recording_url, ...Object.values(config.openai.mcpServers ?? {}).flatMap(caseUrls)]);
  function rejectCredentials(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (/test_credentials|reviewer_instructions|password|secret|token/i.test(key)) throw Error('Reviewer credentials and secrets do not belong in public metadata.');
      rejectCredentials(child);
    }
  }
  rejectCredentials(config.openai);
  const licenseRoot = overrides.license?.file !== undefined ? configRoot : sourceRoot;
  const iconRoot = overrides.plugin?.icon !== undefined ? configRoot : sourceRoot;
  const license = config.license.file ? selectedFile(resolve(licenseRoot, config.license.file), 256 * 1024) : null;
  let icon = null;
  if (config.plugin.icon) {
    const extension = extname(config.plugin.icon).toLowerCase();
    if (extension !== '.png') throw Error('Use a reviewed square PNG listing icon, 512–2048 pixels.');
    const bytes = selectedFile(resolve(iconRoot, config.plugin.icon));
    validateIcon(bytes);
    icon = { path: `assets/icon${extension}`, bytes };
  }
  return { config, license, icon };
}

export function validateIcon(bytes) {
  if (bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.readUInt32BE(16) !== bytes.readUInt32BE(20) || bytes.readUInt32BE(16) < 512 || bytes.readUInt32BE(16) > 2048) throw Error('Use a complete square PNG listing icon, 512–2048 pixels.');
  try { PNG.sync.read(bytes, { checkCRC: true }); } catch { throw Error('Listing PNG is incomplete or fails image/CRC validation.'); }
}
