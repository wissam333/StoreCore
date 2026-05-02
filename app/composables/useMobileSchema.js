// store-app/composables/useMobileSchema.js
//
// FIX: @capacitor-community/sqlite does NOT support multiple statements in a
// single db.execute() call on all platforms. Passing a string with several
// CREATE TABLE statements separated by semicolons works on some builds but
// silently hangs or throws on others — causing the infinite loading screen.
//
// Each DDL statement is now executed individually. Migrations are unchanged.

import { getMobileDb } from "./useMobileDb";

// Run one SQL statement at a time — safe across all capacitor-sqlite versions
const exec = async (db, sql) => {
  await db.execute(sql.trim());
};

const migrateFromPreferences = async (db) => {
  try {
    const { Preferences } = await import("@capacitor/preferences");
    const r = await Preferences.get({ key: "sqlitedb" });
    if (!r?.value) return; // nothing to migrate

    await Preferences.remove({ key: "sqlitedb" });
    console.log("[schema] Cleared legacy sql.js preferences data");
  } catch {}
};

export const initMobileSchema = async () => {
  const db = await getMobileDb();
  await migrateFromPreferences(db);

  // ── Tables ─────────────────────────────────────────────────────────────────
  await exec(
    db,
    `
    CREATE TABLE IF NOT EXISTS categories (
      id          TEXT    PRIMARY KEY,
      name        TEXT    NOT NULL,
      description TEXT,
      version     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    DEFAULT (datetime('now')),
      updated_at  TEXT    DEFAULT (datetime('now')),
      _deleted    INTEGER DEFAULT 0,
      synced_at   TEXT
    )
  `,
  );

  await exec(
    db,
    `
    CREATE TABLE IF NOT EXISTS products (
      id           TEXT    PRIMARY KEY,
      name         TEXT    NOT NULL,
      description  TEXT,
      category_id  TEXT,
      barcode      TEXT,
      buy_price    REAL    NOT NULL DEFAULT 0,
      sell_price   REAL    NOT NULL DEFAULT 0,
      currency     TEXT    NOT NULL DEFAULT 'SP',
      stock        INTEGER NOT NULL DEFAULT 0,
      min_stock    INTEGER DEFAULT 0,
      unit         TEXT    DEFAULT 'piece',
      image_url    TEXT,
      is_active    INTEGER DEFAULT 1,
      version      INTEGER NOT NULL DEFAULT 1,
      created_at   TEXT    DEFAULT (datetime('now')),
      updated_at   TEXT    DEFAULT (datetime('now')),
      _deleted     INTEGER DEFAULT 0,
      synced_at    TEXT
    )
  `,
  );

  await exec(
    db,
    `
    CREATE TABLE IF NOT EXISTS customers (
      id           TEXT    PRIMARY KEY,
      name         TEXT    NOT NULL,
      phone        TEXT,
      address      TEXT,
      notes        TEXT,
      total_orders INTEGER DEFAULT 0,
      total_spent  REAL    DEFAULT 0,
      last_order   TEXT,
      version      INTEGER NOT NULL DEFAULT 1,
      created_at   TEXT    DEFAULT (datetime('now')),
      updated_at   TEXT    DEFAULT (datetime('now')),
      _deleted     INTEGER DEFAULT 0,
      synced_at    TEXT
    )
  `,
  );

  await exec(
    db,
    `
    CREATE TABLE IF NOT EXISTS orders (
      id               TEXT    PRIMARY KEY,
      customer_id      TEXT,
      order_date       TEXT    DEFAULT (datetime('now')),
      status           TEXT    NOT NULL DEFAULT 'pending',
      total_sp         REAL    DEFAULT 0,
      total_usd        REAL    DEFAULT 0,
      paid_amount      REAL    DEFAULT 0,
      display_currency TEXT    DEFAULT 'SP',
      notes            TEXT,
      version          INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT    DEFAULT (datetime('now')),
      updated_at       TEXT    DEFAULT (datetime('now')),
      _deleted         INTEGER DEFAULT 0,
      synced_at        TEXT
    )
  `,
  );

  await exec(
    db,
    `
    CREATE TABLE IF NOT EXISTS order_items (
      id                 TEXT    PRIMARY KEY,
      order_id           TEXT    NOT NULL,
      product_id         TEXT,
      product_name       TEXT    NOT NULL,
      quantity           INTEGER NOT NULL DEFAULT 1,
      sell_price_at_sale REAL    NOT NULL,
      currency_at_sale   TEXT    NOT NULL DEFAULT 'SP',
      line_total_sp      REAL    NOT NULL DEFAULT 0,
      version            INTEGER NOT NULL DEFAULT 1,
      created_at         TEXT    DEFAULT (datetime('now')),
      updated_at         TEXT    DEFAULT (datetime('now')),
      _deleted           INTEGER DEFAULT 0,
      synced_at          TEXT
    )
  `,
  );

  await exec(
    db,
    `
    CREATE TABLE IF NOT EXISTS dues (
      id          TEXT    PRIMARY KEY,
      customer_id TEXT,
      order_id    TEXT,
      amount      REAL    NOT NULL,
      currency    TEXT    NOT NULL DEFAULT 'SP',
      amount_sp   REAL    NOT NULL DEFAULT 0,
      description TEXT,
      due_date    TEXT,
      paid        INTEGER DEFAULT 0,
      paid_at     TEXT,
      version     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    DEFAULT (datetime('now')),
      updated_at  TEXT    DEFAULT (datetime('now')),
      _deleted    INTEGER DEFAULT 0,
      synced_at   TEXT
    )
  `,
  );

  await exec(
    db,
    `
    CREATE TABLE IF NOT EXISTS order_payments (
      id          TEXT    PRIMARY KEY,
      order_id    TEXT    NOT NULL REFERENCES orders(id),
      amount      REAL    NOT NULL,
      currency    TEXT    NOT NULL DEFAULT 'SP',
      amount_sp   REAL    NOT NULL DEFAULT 0,
      note        TEXT,
      paid_at     TEXT    DEFAULT (datetime('now')),
      version     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    DEFAULT (datetime('now')),
      updated_at  TEXT    DEFAULT (datetime('now')),
      _deleted    INTEGER DEFAULT 0,
      synced_at   TEXT
    );
  `,
  );

  await exec(
    db,
    `
    CREATE TABLE IF NOT EXISTS staff (
      id          TEXT    PRIMARY KEY,
      full_name   TEXT    NOT NULL,
      username    TEXT    UNIQUE,
      password    TEXT,
      role        TEXT,
      phone       TEXT,
      email       TEXT,
      is_active   INTEGER DEFAULT 1,
      version     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    DEFAULT (datetime('now')),
      updated_at  TEXT    DEFAULT (datetime('now')),
      _deleted    INTEGER DEFAULT 0,
      synced_at   TEXT
    )
  `,
  );

  await exec(
    db,
    `
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `,
  );

  await exec(
    db,
    `
    CREATE TABLE IF NOT EXISTS sync_queue (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name  TEXT    NOT NULL,
      operation   TEXT    NOT NULL,
      row_id      TEXT    NOT NULL,
      payload     TEXT,
      queued_at   TEXT    DEFAULT (datetime('now')),
      synced_at   TEXT,
      retry_count INTEGER DEFAULT 0,
      changed_fields TEXT
      
    )
  `,
  );

  await exec(
    db,
    `
    CREATE TABLE IF NOT EXISTS sync_meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    )
  `,
  );

  // ── Migrations (safe to re-run — errors are swallowed) ────────────────────
  const migrations = [
    `ALTER TABLE categories  ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE products    ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE customers   ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE orders      ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE order_items ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE dues        ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE staff       ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE sync_queue ADD COLUMN changed_fields TEXT`,
  ];

  for (const sql of migrations) {
    try {
      await db.run(sql);
    } catch {
      // Column already exists — expected on all subsequent launches
    }
  }

  // ── Default settings (INSERT OR IGNORE — idempotent) ─────────────────────
  const defaultSettings = [
    ["store_name", "My Store"],
    ["store_address", ""],
    ["store_phone", ""],
    ["dollar_rate", "15000"],
    ["report_currency", "SP"],
    ["sync_base", ""],
    ["sync_token", ""],
  ];

  for (const [key, value] of defaultSettings) {
    await db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, [
      key,
      value,
    ]);
  }

  await db.run(
    `INSERT OR IGNORE INTO sync_meta (key, value) VALUES ('last_synced_at', NULL)`,
  );

  // ── Seed admin if no staff exist ──────────────────────────────────────────
  const staffResult = await db.query(`SELECT COUNT(*) as n FROM staff`);
  if ((staffResult.values?.[0]?.n ?? 0) === 0) {
    const { generateUuid } = await import("./useUuid");
    await db.run(
      `INSERT INTO staff (id, full_name, username, password, role, is_active) VALUES (?, ?, ?, ?, ?, ?)`,
      [generateUuid(), "Admin", "admin", "admin", "admin", 1],
    );
  }

  // ── Seed default category if empty ────────────────────────────────────────
  const catResult = await db.query(`SELECT COUNT(*) as n FROM categories`);
  if ((catResult.values?.[0]?.n ?? 0) === 0) {
    const { generateUuid } = await import("./useUuid");
    await db.run(`INSERT INTO categories (id, name) VALUES (?, ?)`, [
      generateUuid(),
      "General",
    ]);
  }
};
