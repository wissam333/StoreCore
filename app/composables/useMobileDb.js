// store-app/composables/useMobileDb.js

let _db = null;
let _initPromise = null;

const DB_NAME = "storeapp";

// ── Native path: @capacitor-community/sqlite ──────────────────────────────────
const initNativeDb = async () => {
  const { defineCustomElements } = await import("jeep-sqlite/loader");
  defineCustomElements(window);

  if (!document.querySelector("jeep-sqlite")) {
    const jeep = document.createElement("jeep-sqlite");
    document.body.appendChild(jeep);
    await customElements.whenDefined("jeep-sqlite");
  }

  const { CapacitorSQLite, SQLiteConnection } = await import(
    "@capacitor-community/sqlite"
  );
  const sqlite = new SQLiteConnection(CapacitorSQLite);

  const ret = await sqlite.checkConnectionsConsistency();
  const isConn = (await sqlite.isConnection(DB_NAME, false)).result;

  let db;
  if (ret.result && isConn) {
    db = await sqlite.retrieveConnection(DB_NAME, false);
  } else {
    db = await sqlite.createConnection(
      DB_NAME,
      false,
      "no-encryption",
      1,
      false,
    );
  }

  await db.open();
  await db.execute("PRAGMA foreign_keys = ON;");

  return {
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
};

// ── Web/Electron path: sql.js from CDN (has internet, so fine) ───────────────
const initWebDb = async () => {
  const PREF_KEY = "sqlitedb";

  const prefGet = async (key) => {
    const { Preferences } = await import("@capacitor/preferences");
    const r = await Preferences.get({ key });
    return r?.value ?? null;
  };

  const prefSet = async (key, value) => {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.set({ key, value });
  };

  let _saveTimer = null;
  const scheduleSave = (rawDb) => {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(async () => {
      try {
        const bytes = rawDb.export();
        const b64 = btoa(String.fromCharCode(...bytes));
        await prefSet(PREF_KEY, b64);
      } catch (e) {
        console.warn("[mobileDb] save error:", e?.message);
      }
    }, 600);
  };

  await new Promise((resolve, reject) => {
    if (window.initSqlJs) return resolve();
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("sql.js failed to load"));
    document.head.appendChild(s);
  });

  const SQL = await window.initSqlJs({
    locateFile: (f) =>
      `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${f}`,
  });

  const saved = await prefGet(PREF_KEY);
  let rawDb;
  if (saved) {
    const binary = atob(saved);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    rawDb = new SQL.Database(bytes);
  } else {
    rawDb = new SQL.Database();
  }

  rawDb.run("PRAGMA foreign_keys = ON;");

  return {
    execute: async (sql) => {
      rawDb.run(sql);
      scheduleSave(rawDb);
      return { changes: {} };
    },
    run: async (sql, params = []) => {
      rawDb.run(sql, params);
      scheduleSave(rawDb);
      return { changes: { changes: rawDb.getRowsModified() } };
    },
    query: async (sql, params = []) => {
      const stmt = rawDb.prepare(sql);
      stmt.bind(params);
      const values = [];
      while (stmt.step()) values.push(stmt.getAsObject());
      stmt.free();
      return { values };
    },
    _raw: rawDb,
  };
};

// ── Detect environment ────────────────────────────────────────────────────────
const isNativePlatform = () => {
  return !!window?.Capacitor?.isNativePlatform?.();
};

// ── Main export ───────────────────────────────────────────────────────────────
export const getMobileDb = async () => {
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      _db = isNativePlatform() ? await initNativeDb() : await initWebDb();
      return _db;
    } catch (e) {
      _initPromise = null;
      throw e;
    }
  })();

  return _initPromise;
};

export const resetMobileDb = () => {
  if (_db?._sqlite) {
    _db._sqlite.closeConnection(DB_NAME, false).catch(() => {});
  }
  _db = null;
  _initPromise = null;
};

export const flushMobileDb = async () => {
  // Native SQLite writes immediately — no flush needed
  // Web/Electron sql.js flush (if _raw exists)
  if (_db?._raw) {
    const bytes = _db._raw.export();
    const b64 = btoa(String.fromCharCode(...bytes));
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.set({ key: "sqlitedb", value: b64 });
  }
};
