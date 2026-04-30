// store-app/composables/useMobileDb.js
//
// sql.js (SQLite WASM) + @capacitor/preferences for persistence.
// Zero native plugins. No MainActivity changes. No cap sync needed.
//
// Preferences stores the DB as a base64 string under key "sqlitedb".
// sql.js runs SQLite entirely in JS — same execute/run/query API as before.

let _db = null;
let _initPromise = null;
let _saveTimer = null;
let _SQL = null;

const PREF_KEY = "sqlitedb";

// ── Preferences helpers (already working in your app) ─────────────────────────
const prefGet = async (key) => {
  const { Preferences } = await import("@capacitor/preferences");
  const r = await Preferences.get({ key });
  return r?.value ?? null;
};

const prefSet = async (key, value) => {
  const { Preferences } = await import("@capacitor/preferences");
  await Preferences.set({ key, value });
};

// ── Load sql.js WASM from CDN ─────────────────────────────────────────────────
const loadSQL = () => {
  if (_SQL) return Promise.resolve(_SQL);
  return new Promise((resolve, reject) => {
    if (window.initSqlJs) {
      window
        .initSqlJs({
          locateFile: (f) =>
            `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${f}`,
        })
        .then((S) => {
          _SQL = S;
          resolve(S);
        })
        .catch(reject);
      return;
    }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js";
    s.onload = () =>
      window
        .initSqlJs({
          locateFile: (f) =>
            `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${f}`,
        })
        .then((S) => {
          _SQL = S;
          resolve(S);
        })
        .catch(reject);
    s.onerror = () =>
      reject(new Error("sql.js failed to load — check internet connection"));
    document.head.appendChild(s);
  });
};

// ── Save DB bytes → base64 → Preferences (debounced) ─────────────────────────
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

// ── Wrapper — identical API to @capacitor-community/sqlite ────────────────────
const wrap = (rawDb) => ({
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
});

// ── Main export ───────────────────────────────────────────────────────────────
export const getMobileDb = async () => {
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      const SQL = await loadSQL();

      // Load saved DB if it exists
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

      _db = wrap(rawDb);
      return _db;
    } catch (e) {
      _initPromise = null;
      throw e;
    }
  })();

  return _initPromise;
};

export const resetMobileDb = () => {
  if (_saveTimer) clearTimeout(_saveTimer);
  try {
    _db?._raw?.close();
  } catch {}
  _db = null;
  _initPromise = null;
};

// Call before app goes to background to force an immediate save
export const flushMobileDb = async () => {
  if (!_db) return;
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  const bytes = _db._raw.export();
  const b64 = btoa(String.fromCharCode(...bytes));
  await prefSet(PREF_KEY, b64);
};
