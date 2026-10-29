#!/usr/bin/env node
// PLG-1/29/30: one versioned source -> one public repository + provider ZIPs.
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zipSync } from 'fflate';
import { loadReleaseConfig } from './release-config.mjs';
import { readArtifactZip, validateTarget } from './validate.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const sources = [
  'skills/setup/SKILL.md', 'skills/build-and-host/SKILL.md', 'skills/manage-app/SKILL.md',
  'references/connection.md', 'references/continuity.md', 'references/local-publishing.md', 'references/why-agent-cloud.md', 'scripts/connect-codex.mjs',
];
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sorted = map => [...map].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
const stat = path => { try { return lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; } };

/** @param {{ environment?: string, out?: string, sourceRoot?: string, configPath?: string, target?: string, release?: boolean }} [options] */
export function buildPackage({ environment = 'production', out, sourceRoot = packageRoot, configPath, target = 'all', release = false } = {}) {
  if (!['production', 'staging'].includes(environment)) throw Error('Choose production or staging; custom endpoints are not supported.');
  if (!['all', 'openai', 'claude'].includes(target)) throw Error('Choose target all, openai or claude.');
  sourceRoot = realpathSync(sourceRoot);
  const read = path => {
    const source = join(sourceRoot, path);
    if (!lstatSync(source).isFile() || realpathSync(source) !== resolve(source)) throw Error(`Package input must be a regular file without symlink parents: ${path}`);
    return readFileSync(source);
  };
  const { version } = JSON.parse(read('package.json').toString());
  const { protocol_version: protocolVersion, starters } = JSON.parse(read('pins.json').toString());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(protocolVersion) || !/^[a-f0-9]{40}$/.test(starters?.commit) || !/^[a-f0-9]{64}$/.test(starters?.sha256)) throw Error('Invalid public protocol/starter pins.');
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw Error('A versioned plugin package is required.');
  const { config, license, icon } = loadReleaseConfig(sourceRoot, configPath);
  const origin = environment === 'staging' ? 'https://staging-agent.cloud' : 'https://agent.cloud';
  const name = 'agent-cloud', marketplaceName = config.marketplace.name + (environment === 'staging' ? '-staging' : '');
  const serverName = environment === 'staging' ? 'agent-cloud-staging' : 'agent-cloud';
  // Installs follow this branch, never a version tag, so marketplace updates reach each new release.
  const variables = { version, environment, origin, marketplaceName, channel: 'stable', repository: config.repository, repositorySlug: config.repository.replace('https://github.com/', ''), displayName: config.plugin.displayName, stagingFlag: environment === 'staging' ? ' --staging' : '' };
  const render = path => Buffer.from(read(path).toString().replace(/\{\{([A-Za-z]+)\}\}/g, (_match, key) => {
    if (!(key in variables)) throw Error(`Unknown documentation variable: ${key}`);
    return variables[key];
  }));
  // Never recursively copy the source directory, fixtures, dependencies or history.
  const shared = new Map(sources.map(path => [path, read(path)]));
  for (const file of ['README.md', 'CLIENTS.md', 'ACCEPTANCE.md']) shared.set(file, render(`content/${file}`));
  const licenseStatus = Buffer.from(`# Licensing\n\n${config.license.id && license ? `Configured identifier: ${config.license.id}. The reviewed license text is included in LICENSE.` : 'Licensing has not been configured. This candidate does not invent a license or grant public redistribution rights. The release owner must supply the approved identifier and license text before publishing.'}\n`);
  shared.set('LICENSE-STATUS.md', licenseStatus);
  if (license) shared.set('LICENSE', license);
  if (icon) shared.set(icon.path, icon.bytes);
  shared.set('references/starters.json', json(starters));
  const identity = { name, version, description: config.plugin.description, author: config.plugin.author, homepage: config.plugin.homepage, repository: config.repository, keywords: config.plugin.keywords, ...(config.license.id ? { license: config.license.id } : {}) };
  const openai = new Map([
    ['plugin.json', json({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', ...identity, extensions: { 'com.openai': {
      onboardingSkill: './skills/setup/SKILL.md', interface: { displayName: config.plugin.displayName, shortDescription: config.plugin.shortDescription, longDescription: config.plugin.description, developerName: config.plugin.author.name, category: config.marketplace.category, websiteURL: config.plugin.homepage,
        ...Object.fromEntries(['supportURL', 'privacyPolicyURL', 'termsOfServiceURL'].filter(key => config.plugin[key]).map(key => [key, config.plugin[key]])),
        ...(icon ? { composerIcon: `./${icon.path}`, logo: `./${icon.path}` } : {}),
      }, ...(config.openai.review ? { review: config.openai.review } : {}),
    } } })],
    // M0-qualified protected-resource discovery/DCR; the portable 1.0.0 server
    // schema rejects inline auth extensions. No credentials are bundled.
    ['mcp.json', json({ $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: { [serverName]: { type: 'streamable-http', url: `${origin}/mcp` } } })],
  ]);
  const claude = new Map([
    ['.claude-plugin/plugin.json', json({ ...identity, displayName: config.plugin.displayName,
      ...Object.fromEntries(['supportURL', 'documentationURL', 'privacyPolicyURL', 'termsOfServiceURL'].filter(key => config.plugin[key]).map(key => [key.replace('URL', 'Url'), config.plugin[key]])),
      ...(icon ? { icon: `./${icon.path}` } : {}),
    })],
    ['.mcp.json', json({ mcpServers: { [serverName]: { type: 'http', url: `${origin}/mcp` } } })],
  ]);
  const bundle = (files, artifactTarget) => {
    const result = new Map(files);
    result.set('bundle.json', json({ name, version, environment, target: artifactTarget, repository: config.repository, resource: `${origin}/mcp`, protocol_version: protocolVersion,
      capabilities: { setup: true, management: 'requires-connected-M1-service', cli_publishing: 'M3-acceptance-pending', uploader: false, persistent_profile: false },
      files: Object.fromEntries(sorted(result).map(([path, bytes]) => [path, { sha256: digest(bytes), bytes: bytes.length }])),
    }));
    return result;
  };
  const combined = bundle([...shared, ...openai, ...claude], 'combined');
  const targetNames = target === 'all' ? ['openai', 'claude'] : [target];
  const archives = new Map(), validations = [validateTarget(combined, 'combined')];
  for (const name of targetNames) {
    const files = bundle([...shared, ...(name === 'openai' ? openai : claude)], name);
    // A fixed ZIP wall-clock timestamp and sorted entries give reproducible bytes.
    const bytes = Buffer.from(zipSync(Object.fromEntries(sorted(files)), { level: 9, mtime: new Date(1980, 0, 1) }));
    validations.push(validateTarget(readArtifactZip(bytes), name));
    archives.set(`submissions/agent-cloud-${version}-${environment}-${name}.zip`, bytes);
  }
  const commonGaps = [
    ...(!config.license.id || !license ? ['Configure the approved license identifier and license text.'] : []),
    ...['supportURL', 'documentationURL', 'privacyPolicyURL', 'termsOfServiceURL'].filter(key => !config.plugin[key]).map(key => `Configure plugin.${key}.`),
    ...(!icon ? ['Configure a reviewed listing icon.'] : []),
    ...(environment !== 'production' ? ['Public release-ready builds must target production.'] : []),
  ];
  const review = config.openai.review;
  const openaiGaps = [
    ...(!review?.demo_recording_url ? ['Supply the reviewer-accessible demo recording URL.'] : []),
    ...((review?.test_cases?.positive?.length ?? 0) !== 5 || (review?.test_cases?.negative?.length ?? 0) !== 3 ? ['Supply exactly five positive and three negative MCP review cases.'] : []),
  ];
  const readiness = Object.fromEntries(targetNames.map(name => [name, [...commonGaps, ...(name === 'openai' ? openaiGaps : [])]]));
  const report = { version, environment, repository: config.repository, generated: true, validation: validations, submission_metadata_gaps: readiness, publication: { performed_by_build: false, source_repository: 'not_checked', submission: 'not_checked', listing: 'not_checked' }, note: 'Structural validation does not establish live-client acceptance, licensing approval, URL accessibility, provider review or publication.' };
  if (release && Object.values(readiness).some(gaps => gaps.length)) throw Error(`Release configuration is incomplete: ${JSON.stringify(readiness)}`);
  const repository = new Map();
  for (const [path, bytes] of combined) repository.set(`plugins/${name}/${path}`, bytes);
  repository.set('README.md', Buffer.from(shared.get('README.md').toString().replaceAll('(CLIENTS.md)', '(plugins/agent-cloud/CLIENTS.md)').replaceAll('(ACCEPTANCE.md)', '(plugins/agent-cloud/ACCEPTANCE.md)').replaceAll('(references/connection.md)', '(plugins/agent-cloud/references/connection.md)') + '\n## Maintain this source repository\n\nThis repository includes the editable workflow sources, helpers, templates, configuration, pinned dependencies, tests and build tools. Run `npm ci`, `npm test`, `npm run typecheck` and `npm run build` with Node 24.22.1 or later. Read [DEVELOPMENT.md](DEVELOPMENT.md) for source layout, generated-tree checks and both submission targets.\n'));
  repository.set('DEVELOPMENT.md', render('content/DEVELOPMENT.md'));
  repository.set('PUBLISHING.md', render('content/PUBLISHING.md'));
  repository.set('LICENSE-STATUS.md', licenseStatus); if (license) repository.set('LICENSE', license);
  repository.set('release.json', json({ name, version, environment, repository: config.repository, bundle_sha256: digest(combined.get('bundle.json')), license: config.license.id, targets: targetNames }));
  repository.set('release-report.json', json(report));
  repository.set('.agents/plugins/marketplace.json', json({ name: marketplaceName, interface: { displayName: config.marketplace.displayName }, plugins: [{ name, source: { source: 'local', path: `./plugins/${name}` }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: config.marketplace.category }] }));
  repository.set('.claude-plugin/marketplace.json', json({ name: marketplaceName, owner: config.marketplace.owner, metadata: { description: config.marketplace.description }, plugins: [{ name, source: `./plugins/${name}`, description: config.plugin.description }] }));
  // Publish maintainable source as well as the ready-to-install tree. No private
  // imports, workspace lock, dependency directory or Git history is exported.
  for (const path of [...sources, 'package.json', 'package-lock.json', 'tsconfig.json', 'pins.json', '.gitignore',
    'scripts/build.mjs', 'scripts/release-config.mjs', 'scripts/validate.mjs', 'scripts/generated.mjs',
    'schemas/plugin.schema.json', 'schemas/mcp.schema.json',
    'content/README.md', 'content/CLIENTS.md', 'content/ACCEPTANCE.md', 'content/PUBLISHING.md', 'content/DEVELOPMENT.md',
    'test/package.test.ts', 'test/setup.test.ts', 'test/release.test.ts', 'test/source.test.ts', 'test/connection.test.ts', 'test/fixtures/setup.json',
    '.github/workflows/check.yml']) repository.set(path, read(path));
  repository.set('release.config.json', json({ ...config, license: { ...config.license, file: license ? 'release-assets/LICENSE' : null }, plugin: { ...config.plugin, icon: icon ? 'release-assets/icon.png' : null } }));
  if (license) repository.set('release-assets/LICENSE', license);
  if (icon) repository.set('release-assets/icon.png', icon.bytes);
  let destination;
  if (out !== undefined) {
    if (!isAbsolute(out)) throw Error('--out must be an absolute, nonexisting directory.');
    destination = resolve(out);
    if (stat(destination)) throw Error('Output already exists; choose a new directory. Nothing was overwritten.');
  } else {
    const dist = join(packageRoot, 'dist'); mkdirSync(dist, { recursive: true });
    if (realpathSync(dist) !== resolve(dist)) throw Error('The default dist directory must not be a symlink.');
    destination = join(dist, environment);
    if (stat(destination)?.isSymbolicLink()) throw Error('The default output must not be a symlink.');
    rmSync(destination, { recursive: true, force: true });
  }
  const output = new Map([...archives, ['release-report.json', json(report)]]);
  for (const [path, bytes] of repository) output.set(`repository/${path}`, bytes);
  output.set('SHA256SUMS', Buffer.from(sorted(output).map(([path, bytes]) => `${digest(bytes)}  ${path}\n`).join('')));
  for (const [path, bytes] of output) { const file = join(destination, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes, { flag: 'wx' }); }
  const root = join(destination, 'repository');
  return { version, environment, repository: root, marketplace: root, plugin: join(root, 'plugins', name), submissions: [...archives.keys()].map(path => join(destination, path)), report: join(destination, 'release-report.json'), checksums: join(destination, 'SHA256SUMS'), bundle_sha256: digest(combined.get('bundle.json')) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--staging') { options.environment = 'staging'; continue; }
      if (args[i] === '--release') { options.release = true; continue; }
      const key = { '--out': 'out', '--config': 'configPath', '--target': 'target' }[args[i]];
      if (key && args[i + 1] && !args[i + 1].startsWith('--') && !options[key]) { options[key] = args[++i]; continue; }
      throw Error('Use build.mjs [--staging] [--config release.json] [--target all|openai|claude] [--release] [--out /absolute/new/directory].');
    }
    console.log(JSON.stringify(buildPackage(options)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
