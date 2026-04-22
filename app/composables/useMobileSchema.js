// store-app/composables/useMobileSchema.js
import { getMobileDb } from "./useMobileDb";

export const initMobileSchema = async () => {
  const db = await getMobileDb();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS categories (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      description TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now')),
      _deleted    INTEGER DEFAULT 0,
      synced_at   TEXT
    );

    CREATE TABLE IF NOT EXISTS products (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      description  TEXT,
      category_id  INTEGER,
      barcode      TEXT,
      buy_price    REAL NOT NULL DEFAULT 0,
      sell_price   REAL NOT NULL DEFAULT 0,
      currency     TEXT NOT NULL DEFAULT 'SP',
      stock        INTEGER NOT NULL DEFAULT 0,
      min_stock    INTEGER DEFAULT 0,
      unit         TEXT DEFAULT 'piece',
      image_url    TEXT,
      is_active    INTEGER DEFAULT 1,
      created_at   TEXT DEFAULT (datetime('now')),
      updated_at   TEXT DEFAULT (datetime('now')),
      _deleted     INTEGER DEFAULT 0,
      synced_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS customers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      phone        TEXT,
      address      TEXT,
      notes        TEXT,
      total_orders INTEGER DEFAULT 0,
      total_spent  REAL DEFAULT 0,
      last_order   TEXT,
      created_at   TEXT DEFAULT (datetime('now')),
      updated_at   TEXT DEFAULT (datetime('now')),
      _deleted     INTEGER DEFAULT 0,
      synced_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS orders (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id      INTEGER,
      order_date       TEXT DEFAULT (datetime('now')),
      status           TEXT NOT NULL DEFAULT 'pending',
      total_sp         REAL DEFAULT 0,
      total_usd        REAL DEFAULT 0,
      paid_amount      REAL DEFAULT 0,
      display_currency TEXT DEFAULT 'SP',
      notes            TEXT,
      created_at       TEXT DEFAULT (datetime('now')),
      updated_at       TEXT DEFAULT (datetime('now')),
      _deleted         INTEGER DEFAULT 0,
      synced_at        TEXT
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id           INTEGER NOT NULL,
      product_id         INTEGER,
      product_name       TEXT NOT NULL,
      quantity           INTEGER NOT NULL DEFAULT 1,
      sell_price_at_sale REAL NOT NULL,
      currency_at_sale   TEXT NOT NULL DEFAULT 'SP',
      line_total_sp      REAL NOT NULL DEFAULT 0,
      created_at         TEXT DEFAULT (datetime('now')),
      updated_at         TEXT DEFAULT (datetime('now')),
      _deleted           INTEGER DEFAULT 0,
      synced_at          TEXT
    );

    CREATE TABLE IF NOT EXISTS dues (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      order_id    INTEGER,
      amount      REAL NOT NULL,
      currency    TEXT NOT NULL DEFAULT 'SP',
      amount_sp   REAL NOT NULL DEFAULT 0,
      description TEXT,
      due_date    TEXT,
      paid        INTEGER DEFAULT 0,
      paid_at     TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now')),
      _deleted    INTEGER DEFAULT 0,
      synced_at   TEXT
    );

    CREATE TABLE IF NOT EXISTS staff (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name   TEXT NOT NULL,
      username    TEXT UNIQUE,
      password    TEXT,
      role        TEXT,
      phone       TEXT,
      email       TEXT,
      is_active   INTEGER DEFAULT 1,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now')),
      _deleted    INTEGER DEFAULT 0,
      synced_at   TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name  TEXT NOT NULL,
      operation   TEXT NOT NULL,
      row_id      INTEGER NOT NULL,
      payload     TEXT,
      queued_at   TEXT DEFAULT (datetime('now')),
      synced_at   TEXT,
      retry_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sync_meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  await db.execute(`
    INSERT OR IGNORE INTO settings (key, value) VALUES
      ('store_name',      'My Store'),
      ('store_address',   ''),
      ('store_phone',     ''),
      ('dollar_rate',     '15000'),
      ('report_currency', 'SP'),
      ('sync_base',       ''),
      ('sync_token',      '');

    INSERT OR IGNORE INTO sync_meta (key, value) VALUES ('last_synced_at', NULL);
  `);

  // Seed admin if empty
  const staffResult = await db.query(`SELECT COUNT(*) as n FROM staff`);
  if ((staffResult.values?.[0]?.n ?? 0) === 0) {
    await db.run(
      `INSERT INTO staff (full_name, username, password, role, is_active) VALUES (?, ?, ?, ?, ?)`,
      ["Admin", "admin", "admin", "admin", 1],
    );
  }

  const catResult = await db.query(`SELECT COUNT(*) as n FROM categories`);
  if ((catResult.values?.[0]?.n ?? 0) === 0) {
    await db.run(`INSERT INTO categories (name) VALUES (?)`, ["General"]);
  }
};
