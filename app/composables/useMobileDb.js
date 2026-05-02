// store-app/composables/useMobileDb.js
//
// Native SQLite via @capacitor-community/sqlite
// Works fully offline — no CDN, no WASM, no base64 serialization.
// API is identical to the old sql.js wrapper so useMobileStore.js is untouched.

let _db = null;
let _initPromise = null;

const DB_NAME = "storeapp";

// ── Main export ───────────────────────────────────────────────────────────────
export const getMobileDb = async () => {
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      const { CapacitorSQLite, SQLiteConnection } = await import(
        "@capacitor-community/sqlite"
      );

      const sqlite = new SQLiteConnection(CapacitorSQLite);

      // Check connection consistency (required by the plugin)
      const ret = await sqlite.checkConnectionsConsistency();
      const isConn = (await sqlite.isConnection(DB_NAME, false)).result;

      let db;
      if (ret.result && isConn) {
        db = await sqlite.retrieveConnection(DB_NAME, false);
      } else {
        db = await sqlite.createConnection(
          DB_NAME,
          false, // encrypted
          "no-encryption",
          1, // version
          false, // readonly
        );
      }

      await db.open();

      await db.execute("PRAGMA foreign_keys = ON;");

      // ── Wrap to match the exact API useMobileStore expects ───────────────
      _db = {
        execute: async (sql) => {
          const r = await db.execute(sql);
          return { changes: r.changes ?? {} };
        },
        run: async (sql, params = []) => {
          const r = await db.run(sql, params);
          return { changes: r.changes ?? { changes: 0 } };
        },
        query: async (sql, params = []) => {
          const r = await db.query(sql, params);
          return { values: r.values ?? [] };
        },
        _sqlite: sqlite,
        _db: db,
      };

      return _db;
    } catch (e) {
      _initPromise = null;
      throw e;
    }
  })();

  return _initPromise;
};

export const resetMobileDb = () => {
  // Close the connection cleanly if open
  if (_db?._sqlite && _db?._db) {
    _db._sqlite.closeConnection(DB_NAME, false).catch(() => {});
  }
  _db = null;
  _initPromise = null;
};

// flushMobileDb is a no-op now — native SQLite writes to disk immediately
export const flushMobileDb = async () => {};
