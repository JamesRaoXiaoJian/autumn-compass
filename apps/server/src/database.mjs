import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { HttpError } from './validation.mjs';

const nowIso = () => new Date().toISOString();

const sameWorkspace = (rows, items) => {
  if (rows.length !== Object.keys(items).length) return false;
  return rows.every(({ key, value }) => Object.hasOwn(items, key) && items[key] === value);
};

const changedWorkspaceKeys = (rows, items) => {
  const existing = new Map(rows.map(({ key, value }) => [key, value]));
  const changed = new Set();
  for (const [key, value] of Object.entries(items)) {
    if (existing.get(key) !== value) changed.add(key);
    existing.delete(key);
  }
  for (const key of existing.keys()) changed.add(key);
  return [...changed].sort();
};

export class WorkspaceDatabase {
  constructor(databasePath, { enforcePrivateDirectory = false } = {}) {
    const databaseDirectory = path.dirname(databasePath);
    const createdDirectory = fs.mkdirSync(databaseDirectory, { recursive: true, mode: 0o700 });
    if (createdDirectory || enforcePrivateDirectory) {
      try {
        fs.chmodSync(databaseDirectory, 0o700);
      } catch {
        // Windows and some mounted filesystems do not implement POSIX permissions.
      }
    }
    this.databasePath = databasePath;
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        revision INTEGER NOT NULL CHECK (revision >= 0),
        updated_at TEXT NOT NULL,
        initialized INTEGER NOT NULL DEFAULT 0 CHECK (initialized IN (0, 1))
      );

      CREATE TABLE IF NOT EXISTS workspace_items (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.db.prepare(`
      INSERT OR IGNORE INTO workspace_meta (id, revision, updated_at, initialized)
      VALUES (1, 0, ?, 0)
    `).run(nowIso());

    try {
      fs.chmodSync(databasePath, 0o600);
    } catch {
      // Windows and some mounted filesystems do not implement POSIX permissions.
    }

    this.selectMeta = this.db.prepare('SELECT revision, updated_at AS updatedAt, initialized FROM workspace_meta WHERE id = 1');
    this.selectAll = this.db.prepare('SELECT key, value FROM workspace_items ORDER BY key');
    this.selectItem = this.db.prepare('SELECT value FROM workspace_items WHERE key = ?');
    this.insertItem = this.db.prepare(`
      INSERT INTO workspace_items (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    this.deleteItemStatement = this.db.prepare('DELETE FROM workspace_items WHERE key = ?');
    this.deleteAll = this.db.prepare('DELETE FROM workspace_items');
    this.updateMeta = this.db.prepare(`
      UPDATE workspace_meta SET revision = ?, updated_at = ?, initialized = 1 WHERE id = 1
    `);

    this.bootstrapTransaction = this.db.transaction((items, clientId) => {
      const meta = this._meta();
      if (meta.initialized) {
        return { response: { ...this._snapshot(clientId), imported: false }, event: null };
      }
      if (Object.keys(items).length === 0) {
        return { response: { ...this._snapshot(clientId), imported: false }, event: null };
      }

      const updatedAt = nowIso();
      for (const [key, value] of Object.entries(items)) this.insertItem.run(key, value, updatedAt);
      const revision = meta.revision + 1;
      this.updateMeta.run(revision, updatedAt);
      return {
        response: { ...this._snapshot(clientId), imported: true },
        event: {
          type: 'workspace', revision, updatedAt, clientId,
          changedKeys: Object.keys(items).sort(), fullReplace: true,
        },
      };
    });

    this.putItemTransaction = this.db.transaction(({ key, value, clientId, baseRevision }) => {
      const meta = this._meta();
      this._assertRevision(baseRevision, meta.revision);
      const existing = this.selectItem.get(key);
      const changed = !meta.initialized || !existing || existing.value !== value;
      if (!changed) {
        return {
          response: { ...this._metadata(clientId), key, value, changed: false },
          event: null,
        };
      }

      const updatedAt = nowIso();
      this.insertItem.run(key, value, updatedAt);
      const revision = meta.revision + 1;
      this.updateMeta.run(revision, updatedAt);
      return {
        response: { revision, updatedAt, initialized: true, clientId, key, value, changed: true },
        event: { type: 'workspace', revision, updatedAt, clientId, changedKeys: [key], fullReplace: false },
      };
    });

    this.deleteItemTransaction = this.db.transaction(({ key, clientId, baseRevision }) => {
      const meta = this._meta();
      this._assertRevision(baseRevision, meta.revision);
      const result = this.deleteItemStatement.run(key);
      const deleted = result.changes > 0;
      const changed = deleted || !meta.initialized;
      if (!changed) {
        return {
          response: { ...this._metadata(clientId), key, deleted: false, changed: false },
          event: null,
        };
      }

      const updatedAt = nowIso();
      const revision = meta.revision + 1;
      this.updateMeta.run(revision, updatedAt);
      return {
        response: { revision, updatedAt, initialized: true, clientId, key, deleted, changed: true },
        event: { type: 'workspace', revision, updatedAt, clientId, changedKeys: deleted ? [key] : [], fullReplace: false },
      };
    });

    this.replaceTransaction = this.db.transaction(({ items, clientId, baseRevision }) => {
      const meta = this._meta();
      this._assertRevision(baseRevision, meta.revision);
      const rows = this.selectAll.all();
      const changedKeys = changedWorkspaceKeys(rows, items);
      const changed = !meta.initialized || !sameWorkspace(rows, items);
      if (!changed) {
        return { response: { ...this._snapshot(clientId), changed: false }, event: null };
      }

      const updatedAt = nowIso();
      this.deleteAll.run();
      for (const [key, value] of Object.entries(items)) this.insertItem.run(key, value, updatedAt);
      const revision = meta.revision + 1;
      this.updateMeta.run(revision, updatedAt);
      return {
        response: { ...this._snapshot(clientId), changed: true },
        event: { type: 'workspace', revision, updatedAt, clientId, changedKeys, fullReplace: true },
      };
    });
  }

  _meta() {
    const meta = this.selectMeta.get();
    return { ...meta, initialized: Boolean(meta.initialized) };
  }

  _metadata(clientId = null) {
    return { ...this._meta(), clientId };
  }

  _snapshot(clientId = null) {
    const items = Object.create(null);
    for (const row of this.selectAll.all()) items[row.key] = row.value;
    return { items, ...this._metadata(clientId) };
  }

  _assertRevision(expected, actual) {
    if (expected !== undefined && expected !== actual) {
      throw new HttpError(409, 'REVISION_CONFLICT', '服务端数据已更新，请先获取最新 workspace 后重试。', {
        expectedRevision: expected,
        currentRevision: actual,
      });
    }
  }

  snapshot(clientId = null) {
    return this._snapshot(clientId);
  }

  bootstrap(items, clientId) {
    return this.bootstrapTransaction(items, clientId);
  }

  putItem(input) {
    return this.putItemTransaction(input);
  }

  deleteItem(input) {
    return this.deleteItemTransaction(input);
  }

  replace(input) {
    return this.replaceTransaction(input);
  }

  close() {
    this.db.close();
  }
}
