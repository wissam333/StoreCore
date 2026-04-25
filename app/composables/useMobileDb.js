// store-app/composables/useMobileDb.js
//
// ROOT CAUSE OF "capacitorSQLitePlugin: null":
//
// @capacitor-community/sqlite's named export `CapacitorSQLite` is NOT the
// plugin instance. It is a stub generated at build time. On native Android/iOS,
// the REAL plugin lives at:
//
//   window.Capacitor.Plugins.CapacitorSQLite
//
// The SQLiteConnection constructor reads from that path internally. If the
// native bridge hasn't registered the plugin yet when SQLiteConnection() is
// called, it caches `null` and every subsequent call throws
// "capacitorSQLitePlugin: null".
//
// SOLUTION:
//   1. Do NOT rely on the named import. Read directly from Capacitor.Plugins.
//   2. Poll Capacitor.Plugins.CapacitorSQLite until it's a real object.
//   3. Only THEN construct SQLiteConnection — it will find the plugin already
//      registered and cache the real object instead of null.

import { Capacitor } from "@capacitor/core";

let _db = null;
let _initPromise = null;

// ── Wait for the native plugin to appear in Capacitor.Plugins ─────────────────
const waitForNativePlugin = (timeoutMs = 8000) =>
  new Promise((resolve, reject) => {
    const start = Date.now();

    const check = () => {
      const plugin = window?.Capacitor?.Plugins?.CapacitorSQLite;
      // Must be an object with at least one method — not null, not a stub
      if (
        plugin &&
        typeof plugin === "object" &&
        typeof plugin.createConnection === "function"
      ) {
        return resolve(plugin);
      }
      if (Date.now() - start >= timeoutMs) {
        return reject(
          new Error(
            "capacitorSQLitePlugin: null — native plugin never registered.\n\n" +
              "Required fixes (ALL must be done):\n" +
              "1. npx cap sync android\n" +
              "2. Full rebuild — do NOT use live reload / hot reload\n" +
              "3. Open android/app/src/main/java/.../MainActivity.java and verify:\n" +
              "     import com.getcapacitor.community.database.sqlite.CapacitorSQLitePlugin;\n" +
              "     registerPlugin(CapacitorSQLitePlugin.class);\n" +
              "   is present inside onCreate() BEFORE super.onCreate()\n" +
              "4. Check your @capacitor-community/sqlite version matches your\n" +
              "   Capacitor core version (@capacitor/core)",
          ),
        );
      }
      setTimeout(check, 150);
    };

    check();
  });

export const getMobileDb = async () => {
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      if (!Capacitor.isNativePlatform()) {
        throw new Error(
          "SQLite is only available on native Android/iOS. " +
            "For desktop use window.store (Electron).",
        );
      }

      // Step 1: trigger the module load (side-effect: starts native registration)
      const { SQLiteConnection } = await import("@capacitor-community/sqlite");

      // Step 2: wait for the REAL plugin object in Capacitor.Plugins
      // This is what SQLiteConnection reads internally — we must ensure it's
      // populated BEFORE calling new SQLiteConnection()
      await waitForNativePlugin(8000);

      // Step 3: NOW construct SQLiteConnection — plugin is guaranteed registered
      const sqlite = new SQLiteConnection(
        window.Capacitor.Plugins.CapacitorSQLite,
      );

      // Clean up any stale open connections from crashes or HMR
      try {
        await sqlite.checkConnectionsConsistency();
      } catch {
        // Non-fatal
      }

      // Reuse existing connection on hot-reload
      const isConn = (await sqlite.isConnection("storeapp", false)).result;

      const db = isConn
        ? await sqlite.retrieveConnection("storeapp", false)
        : await sqlite.createConnection(
            "storeapp",
            false,
            "no-encryption",
            1,
            false,
          );

      await db.open();
      await db.execute("PRAGMA journal_mode = WAL;");
      await db.execute("PRAGMA foreign_keys = ON;");

      _db = db;
      return _db;
    } catch (err) {
      _initPromise = null; // allow retry
      throw err;
    }
  })();

  return _initPromise;
};

export const resetMobileDb = () => {
  _db = null;
  _initPromise = null;
};
