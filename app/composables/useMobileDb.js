// store-app/composables/useMobileDb.js

let _db = null;
let _initPromise = null;

const DB_NAME = "app_db";

export const getMobileDb = async () => {
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      const { CapacitorSQLite, SQLiteConnection } = await import(
        "@capacitor-community/sqlite"
      );

      const sqlite = new SQLiteConnection(CapacitorSQLite);
      const db = await sqlite.createConnection(
        DB_NAME,
        false,
        "no-encryption",
        1,
        false,
      );
      await db.open();
      _db = db;
      return _db;
    } catch (e) {
      _initPromise = null;
      throw e;
    }
  })();

  return _initPromise;
};

export const resetMobileDb = async () => {
  try {
    if (_db) await _db.close();
  } catch {}
  _db = null;
  _initPromise = null;
};

export const flushMobileDb = async () => {
  // Native SQLite writes to disk automatically — nothing to flush
};
