#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { extname } from 'node:path';
import { readFileSync } from 'node:fs';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const tracked = execFileSync('git', ['ls-files', '-z', '--cached'], { cwd: root })
  .toString('utf8').split('\0').filter(Boolean);
const untracked = execFileSync('git', ['ls-files', '-z', '--others', '--exclude-standard'], { cwd: root })
  .toString('utf8').split('\0').filter(Boolean);
const files = [...new Set([...tracked, ...untracked])].sort();
const errors = [];

const forbiddenExactPaths = new Set([
  'AGENTS.md',
  'automation/private-sync-prompt.md',
  'automation/systemd/fall-recruitment-maintenance.service',
  'automation/windows/BOOTSTRAP_PROMPT.md',
  'docs/WINDOWS_MIGRATION.md',
  'scripts/create-private-migration-package.sh',
  'scripts/private-sync/README.md',
  'scripts/runtime-qa.cjs',
]);
const forbiddenPrefixes = ['interview_prep/', 'research/', 'resume/'];
const forbiddenExtensions = new Set([
  '.age', '.db', '.doc', '.docx', '.key', '.p12', '.pdf', '.pem', '.pfx',
  '.sqlite', '.sqlite3', '.zip',
]);
const binaryExtensions = new Set(['.gif', '.ico', '.jpeg', '.jpg', '.png', '.webp', '.woff', '.woff2']);

for (const file of files) {
  const lower = file.toLowerCase();
  const extension = extname(lower);
  const basename = lower.split('/').at(-1) || '';
  if (forbiddenExactPaths.has(file) || forbiddenPrefixes.some((prefix) => file.startsWith(prefix))) {
    errors.push(`${file}: private operator/career path must not be tracked`);
  }
  if (forbiddenExtensions.has(extension)
    || /\.(?:db|sqlite|sqlite3)-(?:journal|shm|wal)$/u.test(lower)
    || /(?:^|\/)autumn-compass-(?:workspace|profile).*\.json$/iu.test(file)
    || /(?:^|\/)(?:autumn-compass|[^/]+)-resume\.(?:json|md)$/iu.test(file)) {
    errors.push(`${file}: private database, export, document, key, or archive type is forbidden`);
  }
  if ((basename.startsWith('.env') && basename !== '.env.example')
    || ['.netrc', '.npmrc', '.pypirc'].includes(basename)
    || /^(?:id_ed25519|id_ecdsa|id_rsa)/u.test(basename)) {
    errors.push(`${file}: local credential/config file must not be tracked`);
  }
  if (file.startsWith('apps/web/public/company-logos/')
    && file !== 'apps/web/public/company-logos/README.md') {
    errors.push(`${file}: third-party company logo assets are local-only`);
  }
}

const stageRows = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: root })
  .toString('utf8').split('\0').filter(Boolean);
for (const row of stageRows) {
  const [metadata, file = ''] = row.split('\t');
  const [mode] = metadata.split(' ');
  if (mode === '120000') errors.push(`${file}: symbolic links are not allowed in the public tree`);
  if (mode === '160000') errors.push(`${file}: Git submodules are not allowed in the public tree`);
}

const textRules = [
  ['Chinese mobile number', /\b1[3-9]\d{9}\b/gu],
  ['absolute Linux home path', /\/home\/[A-Za-z0-9._-]+\//gu],
  ['absolute Windows user path', /[A-Za-z]:\\Users\\[^\\\s]+\\/gu],
  ['complete SSH SHA256 fingerprint', /SHA256:[A-Za-z0-9+/]{43}(?:\s|$)/gu],
  ['private key material', /-----BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----/gu],
  ['SSH public key material', /\bssh-(?:rsa|ed25519)\s+[A-Za-z0-9+/]{40,}={0,3}/gu],
  ['referral/tracking query parameter', /[?&](?:share_token|shareId|recommendCode|referralCode)=[^\s&#"']+/giu],
];
const emailPattern = /[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/giu;
const ipv4Pattern = /\b(?:\d{1,3}\.){3}\d{1,3}\b/gu;

for (const file of files) {
  if (errors.some((error) => error.startsWith(`${file}:`))) continue;
  let buffer;
  try {
    buffer = readFileSync(`${root}/${file}`);
  } catch {
    try {
      buffer = execFileSync('git', ['show', `:${file}`], { cwd: root, encoding: 'buffer' });
    } catch {
      errors.push(`${file}: cannot read tracked content`);
      continue;
    }
  }
  if (binaryExtensions.has(extname(file).toLowerCase())) continue;
  if (buffer.includes(0)) {
    errors.push(`${file}: unexpected binary file`);
    continue;
  }
  const source = buffer.toString('utf8');
  for (const [label, pattern] of textRules) {
    pattern.lastIndex = 0;
    const match = pattern.exec(source);
    if (match) {
      const line = source.slice(0, match.index).split('\n').length;
      errors.push(`${file}:${line}: ${label}`);
    }
  }
  emailPattern.lastIndex = 0;
  for (const match of source.matchAll(emailPattern)) {
    const domain = match[1].toLowerCase();
    if (domain === 'example.com' || domain.endsWith('.example')) continue;
    const line = source.slice(0, match.index).split('\n').length;
    errors.push(`${file}:${line}: email address`);
    break;
  }
  ipv4Pattern.lastIndex = 0;
  for (const match of source.matchAll(ipv4Pattern)) {
    const octets = match[0].split('.').map(Number);
    if (octets.some((octet) => octet > 255)) continue;
    if (octets[0] === 127 || match[0] === '0.0.0.0') continue;
    const line = source.slice(0, match.index).split('\n').length;
    errors.push(`${file}:${line}: non-loopback literal IPv4 address`);
    break;
  }
}

const recruitmentPath = 'apps/web/src/data/recruitment.ts';
if (files.includes(recruitmentPath)) {
  const source = readFileSync(`${root}/${recruitmentPath}`, 'utf8');
  const populatedReferral = /\breferral(?:Url|Code|Note)\s*:\s*(['"`])(?:(?!\1).)+\1/gu.exec(source);
  if (populatedReferral) {
    const line = source.slice(0, populatedReferral.index).split('\n').length;
    errors.push(`${recruitmentPath}:${line}: populated private referral field in public seed`);
  }
}

const manifestPath = `${root}/apps/extension/public/manifest.json`;
try {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  const forbidden = permissions.filter((permission) => !['activeTab', 'scripting', 'storage'].includes(permission));
  if (forbidden.length) errors.push(`apps/extension/public/manifest.json: excessive permissions: ${forbidden.join(', ')}`);
  if (Array.isArray(manifest.host_permissions) && manifest.host_permissions.length) {
    errors.push('apps/extension/public/manifest.json: persistent host_permissions are forbidden');
  }
  if (Array.isArray(manifest.content_scripts) && manifest.content_scripts.length) {
    errors.push('apps/extension/public/manifest.json: persistent content_scripts are forbidden');
  }
} catch (error) {
  errors.push(`apps/extension/public/manifest.json: cannot validate manifest (${error.message})`);
}

if (errors.length) {
  console.error('Public-tree check failed:');
  for (const error of [...new Set(errors)]) console.error(`- ${error}`);
  console.error('\nThis check covers the current tree only; it does not sanitize Git history.');
  process.exit(1);
}

console.log(`Public-tree check passed (${files.length} tracked/non-ignored files).`);
console.log('Reminder: publish from a clean new history if older commits ever contained private data.');
