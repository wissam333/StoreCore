// store-app/composables/useMobileDb.js

let _db = null;
let _initPromise = null;
let _saveTimer = null;
let _SQL = null;

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

// ── Safe base64 encode that handles large Uint8Arrays ─────────────────────────
// btoa(String.fromCharCode(...bytes)) crashes on arrays > ~1MB due to
// call stack limits. This chunked version is safe at any size.
const uint8ToBase64 = (bytes) => {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

const base64ToUint8 = (b64) => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

// ── Load sql.js — tries local import first, then CDN as last resort ───────────
//
// Capacitor on Android serves the app at http://localhost — the wasm file
// must be reachable at that origin. We try multiple strategies:
//  1. Dynamic import('sql.js') — works if bundler inlines/handles it
//  2. Fetch wasm from known Capacitor local URL
//  3. Fetch wasm from CDN (requires internet — last resort only)
//
const loadSQL = async () => {
  if (_SQL) return _SQL;

  // Strategy 1: dynamic import (best case — bundler handles wasm location)
  try {
    const initSqlJs = (await import("sql.js")).default;
    _SQL = await initSqlJs({
      locateFile: (filename) => {
        // Try all likely paths Capacitor might serve the file from
        // The correct one depends on your Nuxt output + cap sync setup
        return `/${filename}`;
      },
    });
    console.log("[mobileDb] sql.js loaded via import()");
    return _SQL;
  } catch (e) {
    console.warn("[mobileDb] import() strategy failed:", e?.message);
  }

  // Strategy 2: fetch wasm manually and pass as ArrayBuffer
  // This bypasses locateFile entirely — most reliable in Capacitor WebView
  try {
    const initSqlJs = (await import("sql.js")).default;
    const wasmUrls = ["/sql-wasm.wasm", "./sql-wasm.wasm", "sql-wasm.wasm"];

    let wasmBinary = null;
    for (const url of wasmUrls) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          wasmBinary = await res.arrayBuffer();
          console.log("[mobileDb] wasm fetched from:", url);
          break;
        }
      } catch {}
    }

    if (wasmBinary) {
      _SQL = await initSqlJs({ wasmBinary });
      console.log("[mobileDb] sql.js loaded with wasmBinary");
      return _SQL;
    }
  } catch (e) {
    console.warn("[mobileDb] wasmBinary strategy failed:", e?.message);
  }

  throw new Error(
    "sql.js could not be initialized. Make sure sql-wasm.wasm is in your public/ folder and cap sync was run.",
  );
};

// ── Save DB bytes → base64 → Preferences (debounced) ─────────────────────────
const scheduleSave = (rawDb) => {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    try {
      const bytes = rawDb.export();
      const b64 = uint8ToBase64(bytes); // safe for large DBs
      await prefSet(PREF_KEY, b64);
    } catch (e) {
      console.warn("[mobileDb] save error:", e?.message);
    }
  }, 600);
};

// ── Wrapper ───────────────────────────────────────────────────────────────────
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

      const saved = await prefGet(PREF_KEY);
      let rawDb;
      if (saved) {
        rawDb = new SQL.Database(base64ToUint8(saved));
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

export const flushMobileDb = async () => {
  if (!_db) return;
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  const bytes = _db._raw.export();
  const b64 = uint8ToBase64(bytes);
  await prefSet(PREF_KEY, b64);
};
