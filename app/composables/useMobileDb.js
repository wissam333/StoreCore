// store-app/composables/useMobileDb.js
import { Capacitor } from "@capacitor/core";

let _db = null;

export const getMobileDb = async () => {
  if (_db) return _db;

  if (!Capacitor.isNativePlatform()) {
    throw new Error("SQLite only available on native platforms");
  }

  // Dynamic import — only loads the plugin on native
  const { CapacitorSQLite, SQLiteConnection } =
    await import("@capacitor-community/sqlite");
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
};
