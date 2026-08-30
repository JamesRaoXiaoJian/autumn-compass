import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const reservePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close((error) => {
      if (error) reject(error);
      else resolve(address.port);
    });
  });
});

const waitForHealth = async (baseUrl, child, output) => {
  const deadline = Date.now() + 6_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early\n${output.join('')}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return response.json();
    } catch {
      // The process may still be loading the native SQLite binding.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`server did not become healthy\n${output.join('')}`);
};

const startServer = async (databasePath, port) => {
  const output = [];
  const child = spawn(process.execPath, ['src/index.mjs'], {
    cwd: serverDirectory,
    env: {
      ...process.env,
      AUTUMN_COMPASS_API_HOST: '127.0.0.1',
      AUTUMN_COMPASS_API_PORT: String(port),
      AUTUMN_COMPASS_DB_PATH: databasePath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, child, output);
  return { child, baseUrl, output };
};

const stopServer = async (server) => {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => server.child.once('exit', resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error('server did not stop')), 5_000)),
  ]);
};

const jsonRequest = async (baseUrl, pathname, method, body) => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
};

const readSseEvent = async (reader, expectedName) => {
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) throw new Error(`SSE ended before ${expectedName}`);
    buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const eventName = block.split('\n').find((line) => line.startsWith('event: '))?.slice(7);
      const data = block.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
      if (eventName === expectedName && data) return JSON.parse(data);
      boundary = buffer.indexOf('\n\n');
    }
  }
};

test('HTTP API migrates once, broadcasts, rejects conflicts, and survives restart', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'autumn-compass-http-'));
  const databasePath = path.join(directory, 'workspace.sqlite');
  const port = await reservePort();
  let server;
  context.after(async () => {
    await stopServer(server);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  server = await startServer(databasePath, port);
  const firstHealthResponse = await fetch(`${server.baseUrl}/api/health`);
  assert.equal(firstHealthResponse.headers.get('x-frame-options'), 'DENY');
  assert.match(firstHealthResponse.headers.get('content-security-policy') || '', /frame-ancestors 'none'/u);
  let health = await firstHealthResponse.json();
  assert.equal(health.initialized, false);

  const empty = await jsonRequest(server.baseUrl, '/api/workspace/bootstrap', 'POST', {
    items: {}, clientId: 'empty-browser',
  });
  assert.equal(empty.response.status, 200);
  assert.equal(empty.body.initialized, false);
  assert.equal(empty.body.revision, 0);

  const migrated = await jsonRequest(server.baseUrl, '/api/workspace/bootstrap', 'POST', {
    items: { 'autumn-compass-jobs': '[1]' }, clientId: 'legacy-browser',
  });
  assert.equal(migrated.response.status, 201);
  assert.equal(migrated.body.imported, true);
  assert.equal(migrated.body.revision, 1);
  if (process.platform !== 'win32') {
    for (const candidate of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
      if (fs.existsSync(candidate)) assert.equal(fs.statSync(candidate).mode & 0o777, 0o600);
    }
  }

  const staleEmptyInitialization = await jsonRequest(server.baseUrl, '/api/workspace', 'PUT', {
    items: {}, clientId: 'empty-browser', baseRevision: 0,
  });
  assert.equal(staleEmptyInitialization.response.status, 409);
  assert.equal(staleEmptyInitialization.body.error.code, 'REVISION_CONFLICT');
  const afterInitializationRace = await (await fetch(`${server.baseUrl}/api/workspace`)).json();
  assert.equal(afterInitializationRace.revision, 1);
  assert.equal(afterInitializationRace.items['autumn-compass-jobs'], '[1]');

  const staleBootstrap = await jsonRequest(server.baseUrl, '/api/workspace/bootstrap', 'POST', {
    items: { 'autumn-compass-jobs': '[stale]' }, clientId: 'second-browser',
  });
  assert.equal(staleBootstrap.body.imported, false);
  assert.equal(staleBootstrap.body.items['autumn-compass-jobs'], '[1]');

  const sseController = new AbortController();
  const sseResponse = await fetch(`${server.baseUrl}/api/events`, { signal: sseController.signal });
  assert.equal(sseResponse.status, 200);
  const reader = sseResponse.body.getReader();
  const ready = await readSseEvent(reader, 'ready');
  assert.equal(ready.revision, 1);

  const writePromise = jsonRequest(server.baseUrl, '/api/workspace/item', 'PUT', {
    key: 'autumn-compass-notes', value: '[]', clientId: 'legacy-browser', baseRevision: 1,
  });
  const eventPromise = readSseEvent(reader, 'workspace');
  const [write, event] = await Promise.all([writePromise, eventPromise]);
  assert.equal(write.body.revision, 2);
  assert.equal(event.revision, 2);
  assert.deepEqual(event.changedKeys, ['autumn-compass-notes']);
  sseController.abort();

  const invalid = await jsonRequest(server.baseUrl, '/api/workspace/item', 'PUT', {
    key: 'foreign-key', value: 'x', clientId: 'legacy-browser',
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error.code, 'INVALID_KEY');

  const crossOrigin = await fetch(`${server.baseUrl}/api/workspace/item`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Origin: 'https://malicious.example' },
    body: JSON.stringify({
      key: 'autumn-compass-notes', value: '["cross-origin"]', clientId: 'malicious-page', baseRevision: 2,
    }),
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal((await crossOrigin.json()).error.code, 'ORIGIN_FORBIDDEN');
  assert.equal((await (await fetch(`${server.baseUrl}/api/workspace`)).json()).items['autumn-compass-notes'], '[]');

  const replaced = await jsonRequest(server.baseUrl, '/api/workspace', 'PUT', {
    items: { 'autumn-compass-jobs': '[2]' }, clientId: 'legacy-browser', baseRevision: 2,
  });
  assert.equal(replaced.body.revision, 3);
  assert.deepEqual(replaced.body.items, { 'autumn-compass-jobs': '[2]' });

  const conflict = await jsonRequest(server.baseUrl, '/api/workspace/item', 'PUT', {
    key: 'autumn-compass-jobs', value: '[3]', clientId: 'stale-browser', baseRevision: 1,
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.error.code, 'REVISION_CONFLICT');

  const removed = await jsonRequest(server.baseUrl, '/api/workspace/item', 'DELETE', {
    key: 'autumn-compass-jobs', clientId: 'legacy-browser', baseRevision: 3,
  });
  assert.equal(removed.body.revision, 4);
  assert.equal(removed.body.deleted, true);

  await stopServer(server);
  server = await startServer(databasePath, port);
  health = await (await fetch(`${server.baseUrl}/api/health`)).json();
  assert.equal(health.initialized, true);
  assert.equal(health.revision, 4);
  const persisted = await (await fetch(`${server.baseUrl}/api/workspace`)).json();
  assert.deepEqual(persisted.items, {});
});

test('HTTP API publishes and refreshes a private recruitment-maintenance projection', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'autumn-compass-http-scope-'));
  const databasePath = path.join(directory, 'workspace.sqlite');
  const scopePath = path.join(directory, 'recruitment-maintenance-scope.json');
  const port = await reservePort();
  let server;
  context.after(async () => {
    await stopServer(server);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  server = await startServer(databasePath, port);
  assert.equal(fs.existsSync(scopePath), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(scopePath, 'utf8')).jobs, []);

  const jobsKey = 'autumn-compass-jobs-2027-v7';
  const deletedIdsKey = 'autumn-compass-deleted-job-ids-2027-v1';
  const deletedFingerprintsKey = 'autumn-compass-deleted-job-fingerprints-2027-v1';
  const firstJobs = [{
    id: 'target-safe', company: '安全云科', title: '后端开发工程师',
    url: 'https://jobs.example/safe', recruitmentStatus: '已开放',
    maintenanceStatus: '自动维护',
    referralUrl: 'https://example.com/private-referral', referralCode: 'LOCAL-ONLY-CODE',
    status: '面试',
    statusHistory: [{ fromStatus: '已投递', toStatus: '面试', changedAt: '2026-08-21T02:00:00.000Z' }],
    priority: 'S', appliedAt: '2026-08-01', nextStep: '私人计划', notes: '私人备注',
  }];
  const migrated = await jsonRequest(server.baseUrl, '/api/workspace/bootstrap', 'POST', {
    items: {
      [jobsKey]: JSON.stringify(firstJobs),
      [deletedIdsKey]: JSON.stringify(['target-old']),
      [deletedFingerprintsKey]: JSON.stringify(['code:安全云科:old']),
      'autumn-compass-resume-document': JSON.stringify({ profile: { email: 'private@example.com' } }),
    },
    clientId: 'scope-test',
  });
  assert.equal(migrated.response.status, 201);

  const response = await fetch(`${server.baseUrl}/api/recruitment-maintenance-scope`);
  assert.equal(response.status, 200);
  const scope = await response.json();
  assert.equal(scope.version, 2);
  assert.equal(scope.workspaceRevision, 1);
  assert.equal(scope.jobs.length, 1);
  assert.equal(scope.jobs[0].company, '安全云科');
  assert.equal(scope.jobs[0].maintenanceStatus, '自动维护');
  assert.equal(scope.jobs[0].userMaintained, false);
  assert.deepEqual(scope.deletedJobIds, ['target-old']);
  assert.deepEqual(scope.deletedJobFingerprints, ['code:安全云科:old']);
  for (const forbidden of ['status', 'statusHistory', 'priority', 'appliedAt', 'nextStep', 'notes', 'referralUrl', 'referralCode']) {
    assert.equal(Object.hasOwn(scope.jobs[0], forbidden), false);
  }
  assert.doesNotMatch(JSON.stringify(scope), /private@example\.com|private-referral|LOCAL-ONLY-CODE|私人计划|私人备注/u);
  assert.deepEqual(JSON.parse(fs.readFileSync(scopePath, 'utf8')), scope);
  if (process.platform !== 'win32') assert.equal(fs.statSync(scopePath).mode & 0o777, 0o600);

  const updated = await jsonRequest(server.baseUrl, '/api/workspace/item', 'PUT', {
    key: jobsKey,
    value: JSON.stringify([{ id: 'job-custom', company: '新增公司', title: '服务端开发', userEditedAt: '2026-08-21' }]),
    clientId: 'scope-test',
    baseRevision: 1,
  });
  assert.equal(updated.response.status, 200);
  const updatedFile = JSON.parse(fs.readFileSync(scopePath, 'utf8'));
  assert.equal(updatedFile.workspaceRevision, 2);
  assert.equal(updatedFile.jobs[0].company, '新增公司');
  assert.equal(updatedFile.jobs[0].userMaintained, true);

  const crossOrigin = await fetch(`${server.baseUrl}/api/recruitment-maintenance-scope`, {
    headers: { Origin: 'https://malicious.example' },
  });
  assert.equal(crossOrigin.status, 403);
});
