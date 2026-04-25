// store-app/composables/useMobileDb.js
//
// FIXES:
//  1. Replaced Cordova "deviceready" + document.readyState with a proper
//     Capacitor-native readiness poll. Capacitor does NOT fire "deviceready";
//     its bridge is ready when window.Capacitor.isPluginAvailable() returns
//     true for the plugin we need.
//  2. _initPromise is now cleared on failure so a subsequent getMobileDb()
//     call can retry instead of re-throwing a stale rejected promise forever.
//  3. Added an explicit CapacitorSQLite availability check with a poll loop
//     (up to 5 s) before attempting createConnection — prevents the
//     "capacitorSQLitePlugin: null" error on slower Android WebViews.
//  4. Added PRAGMA WAL + foreign_keys after open for consistency with the
//     Electron SQLite setup.

import { Capacitor } from "@capacitor/core";

let _db = null;
let _initPromise = null;

// ── Capacitor bridge readiness ────────────────────────────────────────────────
// Capacitor's native bridge is ready when:
//   a) window.Capacitor exists AND
//   b) window.Capacitor.Plugins["CapacitorSQLite"] is registered
//
// This typically happens within 0-300 ms of the WebView starting, but on
// low-end Android devices it can take up to 2-3 s. We poll instead of
// using a one-shot timeout.
const waitForCapacitorSQLitePlugin = (timeoutMs = 8000) =>
  new Promise((resolve, reject) => {
    const start = Date.now();

    const check = () => {
      // Plugin is registered when its key appears in window.Capacitor.Plugins
      // OR when CapacitorSQLite is directly available on the global object
      // (both patterns exist depending on capacitor version).
      const cap = window?.Capacitor;
      if (
        cap &&
        (cap.Plugins?.CapacitorSQLite ||
          cap.isPluginAvailable?.("CapacitorSQLite"))
      ) {
        return resolve();
      }

      if (Date.now() - start >= timeoutMs) {
        return reject(
          new Error(
            `CapacitorSQLite plugin not available after ${
              timeoutMs / 1000
            }s. ` +
              "Ensure @capacitor-community/sqlite is installed, synced (npx cap sync), " +
              "and the plugin is registered in MainActivity / AppDelegate.",
          ),
        );
      }

      setTimeout(check, 100);
    };

    check();
  });

// ── Main export ───────────────────────────────────────────────────────────────
export const getMobileDb = async () => {
  // Fast path: connection already open
  if (_db) return _db;

  // In-flight: join the existing init promise
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      // ── Guard: native only ──────────────────────────────────────────────────
      if (!Capacitor.isNativePlatform()) {
        throw new Error(
          "SQLite is only available on native Android/iOS. " +
            "Use the Electron path (window.store) for desktop or run on a device/emulator.",
        );
      }

      // ── Wait for native bridge to register the plugin ─────────────────────
      // This is the core fix: replaces the Cordova "deviceready" / readyState
      // hack with a real poll against the Capacitor plugin registry.
      await waitForCapacitorSQLitePlugin(8000);

      // ── Dynamic import (tree-shaken away on web builds) ───────────────────
      const { CapacitorSQLite, SQLiteConnection } = await import(
        "@capacitor-community/sqlite"
      );

      // Belt-and-suspenders check after the poll resolved
      if (!CapacitorSQLite) {
        throw new Error(
          "CapacitorSQLite is null after plugin poll resolved. " +
            "This is unexpected — please file a bug with your Capacitor version.",
        );
      }

      const sqlite = new SQLiteConnection(CapacitorSQLite);

      // ── Consistency check (recommended by plugin docs) ────────────────────
      // Closes any stale open connections left over from a hot-reload or crash.
      const consistencyResult = await sqlite.checkConnectionsConsistency();
      const isConn = (await sqlite.isConnection("storeapp", false)).result;

      let db;
      if (isConn) {
        // Re-use the existing connection (hot-reload / HMR safe)
        db = await sqlite.retrieveConnection("storeapp", false);
      } else {
        db = await sqlite.createConnection(
          "storeapp", // database name
          false, // encrypted
          "no-encryption",
          1, // version
          false, // readonly
        );
      }

      await db.open();

      // ── Performance + integrity pragmas ───────────────────────────────────
      await db.execute("PRAGMA journal_mode = WAL;");
      await db.execute("PRAGMA foreign_keys = ON;");

      _db = db;
      return _db;
    } catch (err) {
      // CRITICAL: clear the promise so the next getMobileDb() call can retry
      // instead of re-throwing this stale error forever.
      _initPromise = null;
      throw err;
    }
  })();

  return _initPromise;
};

// ── Reset helper (for testing / manual retry after a permissions fix) ─────────
export const resetMobileDb = () => {
  _db = null;
  _initPromise = null;
};
