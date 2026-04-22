// my-app/db/connection.js
import { createRequire } from 'module';
import { app } from 'electron';
import path from 'path';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

let _db = null;

export function getDb() {
  if (!_db) {
    const dbPath = path.join(app.getPath('userData'), 'app.db');
    _db = new Database(dbPath);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
  }
  return _db;
}