// store-app/composables/useMobileDb.js
//
// FIX: The previous "waitForCapacitorSQLitePlugin" poll caused infinite
// loading because it waited for window.Capacitor.Plugins.CapacitorSQLite
// to appear — but that key is only populated AFTER the dynamic import runs.
// The poll was blocking the import that would have unblocked it.
//
// Correct sequence:
//   1. Run the dynamic import first — this is what registers the plugin.
//   2. Add a single short delay on Android to let the JNI bridge settle.
//   3. checkConnectionsConsistency + isConnection guard before createConnection.
//   4. Clear _initPromise on failure so retry works.

import { Capacitor } from "@capacitor/core";

let _db = null;
let _initPromise = null;

export const getMobileDb = async () => {
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      if (!Capacitor.isNativePlatform()) {
        throw new Error(
          "SQLite is only available on native Android/iOS. " +
            "For desktop use window.store (Electron). For browser testing use mock data.",
        );
      }

      // The import IS the plugin registration — do it first.
      const { CapacitorSQLite, SQLiteConnection } = await import(
        "@capacitor-community/sqlite"
      );

      if (!CapacitorSQLite) {
        throw new Error(
          "CapacitorSQLite is null after import. " +
            "Run: npx cap sync, rebuild APK, and verify the plugin is registered " +
            "in MainActivity.java (Android) or AppDelegate.swift (iOS).",
        );
      }

      // On Android: give the JNI bridge one tick to settle after import.
      // On iOS: this is a no-op.
      if (Capacitor.getPlatform() === "android") {
        await new Promise((r) => setTimeout(r, 300));
      }

      const sqlite = new SQLiteConnection(CapacitorSQLite);

      // Clean up stale connections from crashes / HMR
      try {
        await sqlite.checkConnectionsConsistency();
      } catch {
        // Non-fatal — throws when no connections exist yet
      }

      // Reuse existing connection on hot-reload instead of throwing
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

      // WAL mode + foreign keys (mirrors the Electron setup)
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

// Call this before retrying after a permissions change or plugin error
export const resetMobileDb = () => {
  _db = null;
  _initPromise = null;
};
