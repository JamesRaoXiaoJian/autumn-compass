import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('SQLite workspace bootstrap, mutations and persistence are transactional', async (context) => {
  let WorkspaceDatabase;
  try {
    ({ WorkspaceDatabase } = await import('../src/database.mjs'));
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && String(error.message).includes('better-sqlite3')) {
      context.skip('better-sqlite3 尚未安装；只执行静态与验证层测试。');
      return;
    }
    throw error;
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'autumn-compass-server-'));
  const databasePath = path.join(directory, 'workspace.sqlite');
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  let database = new WorkspaceDatabase(databasePath);
  const empty = database.bootstrap({}, 'empty-browser');
  assert.equal(empty.response.imported, false);
  assert.equal(empty.response.initialized, false);
  assert.equal(empty.response.revision, 0);

  const first = database.bootstrap({ 'autumn-compass-jobs': '[1]' }, 'browser-a');
  assert.equal(first.response.imported, true);
  assert.equal(first.response.revision, 1);
  assert.equal(first.response.items['autumn-compass-jobs'], '[1]');

  const second = database.bootstrap({ 'autumn-compass-jobs': '[stale]' }, 'browser-b');
  assert.equal(second.response.imported, false);
  assert.equal(second.response.items['autumn-compass-jobs'], '[1]');

  const write = database.putItem({
    key: 'autumn-compass-notes', value: '[]', clientId: 'browser-a', baseRevision: 1,
  });
  assert.equal(write.response.revision, 2);
  assert.deepEqual(write.event.changedKeys, ['autumn-compass-notes']);

  assert.throws(
    () => database.putItem({ key: 'autumn-compass-notes', value: '[2]', clientId: 'browser-b', baseRevision: 1 }),
    (error) => error.code === 'REVISION_CONFLICT' && error.status === 409,
  );

  const removed = database.deleteItem({ key: 'autumn-compass-jobs', clientId: 'browser-a' });
  assert.equal(removed.response.deleted, true);
  assert.equal(removed.response.revision, 3);
  database.close();

  database = new WorkspaceDatabase(databasePath);
  const restored = database.snapshot();
  assert.equal(restored.revision, 3);
  assert.deepEqual({ ...restored.items }, { 'autumn-compass-notes': '[]' });
  database.close();
});
