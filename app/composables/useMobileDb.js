// store-app/composables/useMobileDb.js
//
// FIX: "capacitorSQLitePlugin: null" means the import resolved but the native
// bridge hasn't wired up the plugin object yet. This happens on Android when
// the WebView fires JS before the Java plugin registration completes.
//
// Solution: import first (triggers registration), then poll the imported
// object itself until it's non-null, with a clear timeout error.

import { Capacitor } from "@capacitor/core";

let _db = null;
let _initPromise = null;

// ── Wait for the plugin object to become non-null ─────────────────────────────
// @capacitor-community/sqlite exports CapacitorSQLite which is a reference to
// the native bridge object. On Android it can be null for a few hundred ms
// after the import resolves while the Java side finishes registering.
const waitForPlugin = (CapacitorSQLite, timeoutMs = 10000) =>
  new Promise((resolve, reject) => {
    // Already ready
    if (
      CapacitorSQLite &&
      typeof CapacitorSQLite.createConnection === "function"
    ) {
      return resolve(CapacitorSQLite);
    }

    const start = Date.now();
    const timer = setInterval(() => {
      if (
        CapacitorSQLite &&
        typeof CapacitorSQLite.createConnection === "function"
      ) {
        clearInterval(timer);
        return resolve(CapacitorSQLite);
      }
      if (Date.now() - start >= timeoutMs) {
        clearInterval(timer);
        return reject(
          new Error(
            "capacitorSQLitePlugin: null after " +
              timeoutMs / 1000 +
              "s.\n" +
              "Fix checklist:\n" +
              "1. Run: npx cap sync\n" +
              "2. Rebuild the APK (not just hot-reload)\n" +
              "3. Android: verify CapacitorSQLitePlugin is in MainActivity.java\n" +
              "   add(CapacitorSQLitePlugin.class)\n" +
              "4. iOS: run pod install in /ios",
          ),
        );
      }
    }, 100);
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

      // Step 1: import — this triggers the native registration
      const { CapacitorSQLite, SQLiteConnection } = await import(
        "@capacitor-community/sqlite"
      );

      // Step 2: wait until the imported object is actually wired up
      // (the import can resolve before the Java bridge finishes on Android)
      const plugin = await waitForPlugin(CapacitorSQLite, 10000);

      // Step 3: open connection
      const sqlite = new SQLiteConnection(plugin);

      try {
        await sqlite.checkConnectionsConsistency();
      } catch {
        // Non-fatal — throws when no connections exist yet
      }

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
      _initPromise = null;
      throw err;
    }
  })();

  return _initPromise;
};

export const resetMobileDb = () => {
  _db = null;
  _initPromise = null;
};
