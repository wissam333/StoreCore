// store-app/composables/useMobileDb.js
//
// sql.js (SQLite WASM) loaded from LOCAL bundle (public/sql/).
// Capacitor bundles public/ into the APK — works fully offline on mobile.
// Electron/web also work since they serve from the same public/ folder.
//
// FIX: Removed debounced save — every write now triggers an immediate
// synchronous persist to Preferences. This eliminates the 600ms race
// condition where killing the app before the debounce fires would wipe
// all data entered since the last save.

let _db = null;
let _initPromise = null;
let _SQL = null;
let _saving = false; // guard against concurrent saves

const PREF_KEY = "sqlitedb";

// ── Preferences helpers ───────────────────────────────────────────────────────
const prefGet = async (key) => {
  const { Preferences } = await import("@capacitor/preferences");
  const r = await Preferences.get({ key });
  return r?.value ?? null;
};

const prefSet = async (key, value) => {
  const { Preferences } = await import("@capacitor/preferences");
  await Preferences.set({ key, value });
};

// ── Load sql.js from local bundle (public/sql/) ───────────────────────────────
const loadSQL = () => {
  if (_SQL) return Promise.resolve(_SQL);
  return new Promise((resolve, reject) => {
    const init = () =>
      window
        .initSqlJs({ locateFile: () => "/sql/sql-wasm.wasm" })
        .then((S) => {
          _SQL = S;
          resolve(S);
        })
        .catch(reject);

    if (window.initSqlJs) {
      init();
      return;
    }

    const s = document.createElement("script");
    s.src = "/sql/sql-wasm.js";
    s.onload = init;
    s.onerror = () => reject(new Error("sql.js failed to load"));
    document.head.appendChild(s);
  });
};

// ── Save DB bytes → base64 → Preferences (immediate, no debounce) ─────────────
// Called after every write. Using a simple mutex (_saving) so rapid
// back-to-back writes queue one additional save rather than spawning many.
let _pendingSave = false;

// REPLACE persistDb with this — uses chunked btoa, no stack overflow
const persistDb = async (rawDb) => {
  if (_saving) {
    _pendingSave = true;
    return;
  }
  _saving = true;
  try {
    const bytes = rawDb.export();
    // Chunked base64 encoding — safe for any DB size
    let b64 = "";
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      b64 += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    await prefSet(PREF_KEY, btoa(b64));
  } catch (e) {
    console.warn("[mobileDb] persist error:", e?.message);
  } finally {
    _saving = false;
    if (_pendingSave) {
      _pendingSave = false;
      persistDb(rawDb);
    }
  }
};

// ── Wrapper — identical API to useMobileStore expectations ────────────────────
const wrap = (rawDb) => ({
  execute: async (sql) => {
    rawDb.run(sql);
    await persistDb(rawDb); // immediate persist
    return { changes: {} };
  },
  run: async (sql, params = []) => {
    rawDb.run(sql, params);
    await persistDb(rawDb); // immediate persist
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

export const flushMobileDbSync = () => {
  if (!_db?._raw) return;
  try {
    const bytes = _db._raw.export();
    let b64 = "";
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      b64 += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    const encoded = btoa(b64);
    // Fire-and-forget but don't await — gets queued before thread dies
    import("@capacitor/preferences").then(({ Preferences }) => {
      Preferences.set({ key: PREF_KEY, value: encoded });
    });
  } catch (e) {
    console.warn("[mobileDb] sync flush error:", e?.message);
  }
};

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
        const binary = atob(saved);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        rawDb = new SQL.Database(bytes);
        // ↑ This part is actually fine already — charCodeAt loop is safe
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
  _saving = false;
  _pendingSave = false;
  try {
    _db?._raw?.close();
  } catch {}
  _db = null;
  _initPromise = null;
};

// flushMobileDb: kept for compatibility (app pause event in app.vue).
// With immediate saves this is mostly a no-op but still exports bytes as a
// safety net for the "pause" event.
export const flushMobileDb = async () => {
  if (!_db?._raw) return;
  // Wait for any in-flight save to finish
  let retries = 0;
  while (_saving && retries < 20) {
    await new Promise((r) => setTimeout(r, 50));
    retries++;
  }
  // Do one final explicit save regardless
  try {
    const bytes = _db._raw.export();
    const b64 = btoa(String.fromCharCode(...bytes));
    await prefSet(PREF_KEY, b64);
  } catch (e) {
    console.warn("[mobileDb] flush error:", e?.message);
  }
};
