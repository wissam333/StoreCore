// store-app/composables/useMobileDb.js
import { Capacitor } from "@capacitor/core";

let _db = null;
let _initPromise = null;

export const getMobileDb = async () => {
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    // Web fallback (for browser preview)
    if (!Capacitor.isNativePlatform()) {
      throw new Error("SQLite only available on native platforms");
    }

    // Wait for Capacitor to be fully ready
    await new Promise((resolve) => {
      if (document.readyState === "complete") {
        resolve();
      } else {
        window.addEventListener("deviceready", resolve, { once: true });
        // Fallback: resolve anyway after 2s to prevent hanging
        setTimeout(resolve, 2000);
      }
    });

    // Dynamic import — only loads the plugin on native
    const { CapacitorSQLite, SQLiteConnection } = await import(
      "@capacitor-community/sqlite"
    );

    if (!CapacitorSQLite) {
      throw new Error(
        "CapacitorSQLite plugin is null. Check that @capacitor-community/sqlite is installed and synced.",
      );
    }

    const sqlite = new SQLiteConnection(CapacitorSQLite);

    const db = await sqlite.createConnection(
      "storeapp",
      false,
      "no-encryption",
      1,
      false,
    );
    await db.open();
    _db = db;
    return _db;
  })();

  return _initPromise;
};
