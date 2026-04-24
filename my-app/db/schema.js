// store-app/db/schema.js
// Run once on first launch to create all tables + sync infrastructure.
// Called synchronously from main.js — no top-level await allowed here.

export function initSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    -- ─────────────────────────────────────────────────────────────────────
    --  CATEGORIES
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS categories (
      id          TEXT    PRIMARY KEY,
      name        TEXT    NOT NULL,
      description TEXT,
      version     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    DEFAULT (datetime('now')),
      updated_at  TEXT    DEFAULT (datetime('now')),
      _deleted    INTEGER DEFAULT 0,
      synced_at   TEXT
    );

    -- ─────────────────────────────────────────────────────────────────────
    --  PRODUCTS
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS products (
      id           TEXT    PRIMARY KEY,
      name         TEXT    NOT NULL,
      description  TEXT,
      category_id  TEXT    REFERENCES categories(id),
      barcode      TEXT,
      buy_price    REAL    NOT NULL DEFAULT 0,
      sell_price   REAL    NOT NULL DEFAULT 0,
      currency     TEXT    NOT NULL DEFAULT 'SP' CHECK(currency IN ('SP','USD')),
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
    );

    -- ─────────────────────────────────────────────────────────────────────
    --  CUSTOMERS
    -- ─────────────────────────────────────────────────────────────────────
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
    );

    -- ─────────────────────────────────────────────────────────────────────
    --  ORDERS
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS orders (
      id               TEXT    PRIMARY KEY,
      customer_id      TEXT    REFERENCES customers(id),
      order_date       TEXT    DEFAULT (datetime('now')),
      status           TEXT    NOT NULL DEFAULT 'pending'
                               CHECK(status IN ('pending','partly_paid','paid')),
      total_sp         REAL    DEFAULT 0,
      total_usd        REAL    DEFAULT 0,
      paid_amount      REAL    DEFAULT 0,
      display_currency TEXT    DEFAULT 'SP' CHECK(display_currency IN ('SP','USD')),
      notes            TEXT,
      version          INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT    DEFAULT (datetime('now')),
      updated_at       TEXT    DEFAULT (datetime('now')),
      _deleted         INTEGER DEFAULT 0,
      synced_at        TEXT
    );

    -- ─────────────────────────────────────────────────────────────────────
    --  ORDER ITEMS
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS order_items (
      id                  TEXT    PRIMARY KEY,
      order_id            TEXT    NOT NULL REFERENCES orders(id),
      product_id          TEXT    REFERENCES products(id),
      product_name        TEXT    NOT NULL,
      quantity            INTEGER NOT NULL DEFAULT 1,
      sell_price_at_sale  REAL    NOT NULL,
      currency_at_sale    TEXT    NOT NULL DEFAULT 'SP',
      line_total_sp       REAL    NOT NULL DEFAULT 0,
      version             INTEGER NOT NULL DEFAULT 1,
      created_at          TEXT    DEFAULT (datetime('now')),
      updated_at          TEXT    DEFAULT (datetime('now')),
      _deleted            INTEGER DEFAULT 0,
      synced_at           TEXT
    );

    -- ─────────────────────────────────────────────────────────────────────
    --  DUES (ديون)
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS dues (
      id          TEXT    PRIMARY KEY,
      customer_id TEXT    REFERENCES customers(id),
      order_id    TEXT    REFERENCES orders(id),
      amount      REAL    NOT NULL,
      currency    TEXT    NOT NULL DEFAULT 'SP' CHECK(currency IN ('SP','USD')),
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
    );

    -- ─────────────────────────────────────────────────────────────────────
    --  STAFF
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS staff (
      id          TEXT    PRIMARY KEY,
      full_name   TEXT    NOT NULL,
      username    TEXT    UNIQUE,
      password    TEXT,
      role        TEXT    CHECK(role IN ('admin','cashier','manager')),
      phone       TEXT,
      email       TEXT,
      is_active   INTEGER DEFAULT 1,
      version     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    DEFAULT (datetime('now')),
      updated_at  TEXT    DEFAULT (datetime('now')),
      _deleted    INTEGER DEFAULT 0,
      synced_at   TEXT
    );

    -- ─────────────────────────────────────────────────────────────────────
    --  SETTINGS
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ─────────────────────────────────────────────────────────────────────
    --  SYNC QUEUE  (outbox pattern)
    --  row_id is TEXT to hold UUIDs
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS sync_queue (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name  TEXT    NOT NULL,
      operation   TEXT    NOT NULL CHECK(operation IN ('insert','update','delete')),
      row_id      TEXT    NOT NULL,
      payload     TEXT,
      queued_at   TEXT    DEFAULT (datetime('now')),
      synced_at   TEXT,
      retry_count INTEGER DEFAULT 0
    );

    -- ─────────────────────────────────────────────────────────────────────
    --  SYNC META
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS sync_meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    -- ── Default settings ────────────────────────────────────────────────
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

  // ── Migration: add version column to existing installs ───────────────────
  // Safe to run multiple times — we catch the "duplicate column" error.
  const migrations = [
    `ALTER TABLE categories  ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE products    ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE customers   ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE orders      ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE order_items ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE dues        ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE staff       ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
  ];
  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch {
      /* column already exists — ignore */
    }
  }

  // ── UUID helper — crypto.randomUUID() is global in Node 19+ ─────────────
  // Electron ships Node 20+, so this is always available in the main process.
  const uuid = () => crypto.randomUUID();

  // ── Seed default admin if staff table is empty ───────────────────────────
  const staffCount = db.prepare(`SELECT COUNT(*) as n FROM staff`).get();
  if (staffCount.n === 0) {
    db.prepare(
      `INSERT INTO staff (id, full_name, username, password, role, is_active)
       VALUES (?, 'Admin', 'admin', 'admin', 'admin', 1)`,
    ).run(uuid());
  }

  // ── Seed default category if categories table is empty ───────────────────
  const catCount = db.prepare(`SELECT COUNT(*) as n FROM categories`).get();
  if (catCount.n === 0) {
    db.prepare(`INSERT INTO categories (id, name) VALUES (?, 'General')`).run(
      uuid(),
    );
  }
}
