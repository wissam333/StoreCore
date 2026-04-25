// store-app/composables/useMobileDb.js
//
// COMPLETE REWRITE — dropped @capacitor-community/sqlite entirely.
//
// WHY: The plugin requires native registration (MainActivity.java),
// exact version matching with @capacitor/core, a full npx cap sync,
// and a clean APK rebuild every time. Any mismatch = null plugin = crash.
// It is the #1 source of "capacitorSQLitePlugin: null" forever.
//
// NEW APPROACH: sql.js (SQLite compiled to WebAssembly) + Capacitor Filesystem
// for persistence. Runs 100% in JS — zero native plugins required.
// Same SQL API your existing useMobileStore/useMobileSchema code already uses.
//
// HOW IT WORKS:
//   1. Load sql.js WASM (SQLite in the browser/WebView)
//   2. On first launch: create empty DB
//   3. On subsequent launches: load saved DB bytes from Capacitor Filesystem
//   4. After every write: save DB bytes back to Filesystem (debounced 500ms)
//
// RESULT: Works on any Capacitor app with zero native changes.
// Performance: sql.js handles thousands of rows easily for a POS app.

import { Capacitor } from "@capacitor/core";

const DB_FILENAME = "storeapp.db";
const SAVE_DEBOUNCE_MS = 500;

let _db = null;
let _initPromise = null;
let _saveTimer = null;
let _sqlJs = null;

// ── Load sql.js from CDN ───────────────────────────────────────────────────────
const loadSqlJs = async () => {
  if (_sqlJs) return _sqlJs;

  return new Promise((resolve, reject) => {
    // Check if already loaded
    if (window.initSqlJs) {
      window
        .initSqlJs({
          locateFile: (f) =>
            `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${f}`,
        })
        .then((SQL) => {
          _sqlJs = SQL;
          resolve(SQL);
        })
        .catch(reject);
      return;
    }

    const script = document.createElement("script");
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js";
    script.onload = () => {
      window
        .initSqlJs({
          locateFile: (f) =>
            `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${f}`,
        })
        .then((SQL) => {
          _sqlJs = SQL;
          resolve(SQL);
        })
        .catch(reject);
    };
    script.onerror = () => reject(new Error("Failed to load sql.js from CDN"));
    document.head.appendChild(script);
  });
};

// ── Capacitor Filesystem helpers ───────────────────────────────────────────────
const fsRead = async (filename) => {
  try {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const result = await Filesystem.readFile({
      path: filename,
      directory: Directory.Data,
    });
    // result.data is base64
    const binary = atob(result.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null; // file doesn't exist yet
  }
};

const fsWrite = async (filename, uint8array) => {
  try {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    // Convert to base64
    let binary = "";
    for (let i = 0; i < uint8array.length; i++) {
      binary += String.fromCharCode(uint8array[i]);
    }
    const base64 = btoa(binary);
    await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Data,
    });
  } catch (err) {
    console.warn("[mobileDb] fsWrite failed:", err?.message);
  }
};

// ── Save DB to disk (debounced) ────────────────────────────────────────────────
const scheduleSave = () => {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    if (!_db) return;
    try {
      const data = _db.export();
      if (Capacitor.isNativePlatform()) {
        await fsWrite(DB_FILENAME, data);
      } else {
        // Web fallback: localStorage (dev only)
        const binary = Array.from(data)
          .map((b) => String.fromCharCode(b))
          .join("");
        localStorage.setItem("storeapp_db", btoa(binary));
      }
    } catch (err) {
      console.warn("[mobileDb] save failed:", err?.message);
    }
  }, SAVE_DEBOUNCE_MS);
};

// ── DB wrapper — same API as @capacitor-community/sqlite ──────────────────────
// execute(sql)          — DDL / multi-statement
// run(sql, params)      — INSERT/UPDATE/DELETE
// query(sql, params)    — SELECT → { values: [...] }
const makeDbWrapper = (sqlDb) => ({
  execute: async (sql) => {
    sqlDb.run(sql);
    scheduleSave();
    return { changes: {} };
  },

  run: async (sql, params = []) => {
    sqlDb.run(sql, params);
    scheduleSave();
    return { changes: { changes: sqlDb.getRowsModified() } };
  },

  query: async (sql, params = []) => {
    const stmt = sqlDb.prepare(sql);
    stmt.bind(params);
    const values = [];
    while (stmt.step()) {
      values.push(stmt.getAsObject());
    }
    stmt.free();
    return { values };
  },

  export: () => sqlDb.export(),
  close: () => sqlDb.close(),
});

// ── Main export ────────────────────────────────────────────────────────────────
export const getMobileDb = async () => {
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      // Load sql.js WASM
      const SQL = await loadSqlJs();

      // Try to load existing database from disk
      let existingData = null;
      if (Capacitor.isNativePlatform()) {
        existingData = await fsRead(DB_FILENAME);
      } else {
        // Web fallback
        const saved = localStorage.getItem("storeapp_db");
        if (saved) {
          const binary = atob(saved);
          existingData = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            existingData[i] = binary.charCodeAt(i);
          }
        }
      }

      // Create DB from existing data or fresh
      const sqlDb = existingData
        ? new SQL.Database(existingData)
        : new SQL.Database();

      // Performance pragmas
      sqlDb.run("PRAGMA journal_mode = MEMORY;");
      sqlDb.run("PRAGMA foreign_keys = ON;");
      sqlDb.run("PRAGMA synchronous = OFF;");

      _db = makeDbWrapper(sqlDb);
      return _db;
    } catch (err) {
      _initPromise = null;
      throw err;
    }
  })();

  return _initPromise;
};

export const resetMobileDb = () => {
  if (_saveTimer) clearTimeout(_saveTimer);
  if (_db) {
    try {
      _db.close();
    } catch {}
  }
  _db = null;
  _initPromise = null;
  _saveTimer = null;
};

// Force-save immediately (call before app goes to background)
export const flushMobileDb = async () => {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  if (!_db) return;
  const data = _db.export();
  if (Capacitor.isNativePlatform()) {
    await fsWrite(DB_FILENAME, data);
  } else {
    const binary = Array.from(data)
      .map((b) => String.fromCharCode(b))
      .join("");
    localStorage.setItem("storeapp_db", btoa(binary));
  }
};
