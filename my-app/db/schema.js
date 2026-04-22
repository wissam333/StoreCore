// store-app/db/schema.js
// Run once on first launch to create all tables + sync infrastructure.

export function initSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    -- ─────────────────────────────────────────────────────────────────────
    --  CATEGORIES
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS categories (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      description TEXT,
      created_at  TEXT    DEFAULT (datetime('now')),
      updated_at  TEXT    DEFAULT (datetime('now')),
      _deleted    INTEGER DEFAULT 0,
      synced_at   TEXT
    );

    -- ─────────────────────────────────────────────────────────────────────
    --  PRODUCTS
    --  buy_price  = what the owner paid (cost price)
    --  sell_price = what the customer pays (sale price)
    --  currency   = 'SP' | 'USD'
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS products (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL,
      description  TEXT,
      category_id  INTEGER REFERENCES categories(id),
      barcode      TEXT,
      buy_price    REAL    NOT NULL DEFAULT 0,
      sell_price   REAL    NOT NULL DEFAULT 0,
      currency     TEXT    NOT NULL DEFAULT 'SP' CHECK(currency IN ('SP','USD')),
      stock        INTEGER NOT NULL DEFAULT 0,
      min_stock    INTEGER DEFAULT 0,   -- low-stock alert threshold
      unit         TEXT    DEFAULT 'piece',
      image_url    TEXT,
      is_active    INTEGER DEFAULT 1,
      created_at   TEXT    DEFAULT (datetime('now')),
      updated_at   TEXT    DEFAULT (datetime('now')),
      _deleted     INTEGER DEFAULT 0,
      synced_at    TEXT
    );

    -- ─────────────────────────────────────────────────────────────────────
    --  CUSTOMERS
    --  Can be created on-the-fly from an order (just a name), or fully manually.
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS customers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL,
      phone        TEXT,
      address      TEXT,
      notes        TEXT,
      total_orders INTEGER DEFAULT 0,
      total_spent  REAL    DEFAULT 0,   -- running sum in SP (converted)
      last_order   TEXT,
      created_at   TEXT    DEFAULT (datetime('now')),
      updated_at   TEXT    DEFAULT (datetime('now')),
      _deleted     INTEGER DEFAULT 0,
      synced_at    TEXT
    );

    -- ─────────────────────────────────────────────────────────────────────
    --  ORDERS
    --  status: 'pending' | 'partly_paid' | 'paid'
    --  currency: the currency the order total is expressed in (for display)
    --  paid_amount: how much has been received so far
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS orders (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id  INTEGER REFERENCES customers(id),
      order_date   TEXT    DEFAULT (datetime('now')),
      status       TEXT    NOT NULL DEFAULT 'pending'
                           CHECK(status IN ('pending','partly_paid','paid')),
      total_sp     REAL    DEFAULT 0,   -- grand total converted to SP
      total_usd    REAL    DEFAULT 0,   -- grand total converted to USD
      paid_amount  REAL    DEFAULT 0,   -- in the order's display currency
      display_currency TEXT DEFAULT 'SP' CHECK(display_currency IN ('SP','USD')),
      notes        TEXT,
      created_at   TEXT    DEFAULT (datetime('now')),
      updated_at   TEXT    DEFAULT (datetime('now')),
      _deleted     INTEGER DEFAULT 0,
      synced_at    TEXT
    );

    -- ─────────────────────────────────────────────────────────────────────
    --  ORDER ITEMS
    --  Snapshot of price at time of sale (price may change later)
    --  sell_price_at_sale  = actual price used
    --  currency_at_sale    = 'SP' | 'USD'
    --  line_total_sp       = converted to SP at sale time
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS order_items (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id            INTEGER NOT NULL REFERENCES orders(id),
      product_id          INTEGER REFERENCES products(id),
      product_name        TEXT    NOT NULL,   -- snapshot
      quantity            INTEGER NOT NULL DEFAULT 1,
      sell_price_at_sale  REAL    NOT NULL,
      currency_at_sale    TEXT    NOT NULL DEFAULT 'SP',
      line_total_sp       REAL    NOT NULL DEFAULT 0,
      created_at          TEXT    DEFAULT (datetime('now')),
      updated_at          TEXT    DEFAULT (datetime('now')),
      _deleted            INTEGER DEFAULT 0,
      synced_at           TEXT
    );

    -- ─────────────────────────────────────────────────────────────────────
    --  DUES (ديون) — standalone debt records, separate from orders
    --  A due can reference an order OR be a free-standing debt.
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS dues (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id  INTEGER REFERENCES customers(id),
      order_id     INTEGER REFERENCES orders(id),   -- nullable
      amount       REAL    NOT NULL,
      currency     TEXT    NOT NULL DEFAULT 'SP' CHECK(currency IN ('SP','USD')),
      amount_sp    REAL    NOT NULL DEFAULT 0,       -- converted for reports
      description  TEXT,
      due_date     TEXT,
      paid         INTEGER DEFAULT 0,
      paid_at      TEXT,
      created_at   TEXT    DEFAULT (datetime('now')),
      updated_at   TEXT    DEFAULT (datetime('now')),
      _deleted     INTEGER DEFAULT 0,
      synced_at    TEXT
    );

    -- ─────────────────────────────────────────────────────────────────────
    --  STAFF
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS staff (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name   TEXT    NOT NULL,
      username    TEXT    UNIQUE,
      password    TEXT,
      role        TEXT    CHECK(role IN ('admin','cashier','manager')),
      phone       TEXT,
      email       TEXT,
      is_active   INTEGER DEFAULT 1,
      created_at  TEXT    DEFAULT (datetime('now')),
      updated_at  TEXT    DEFAULT (datetime('now')),
      _deleted    INTEGER DEFAULT 0,
      synced_at   TEXT
    );

    -- ─────────────────────────────────────────────────────────────────────
    --  SETTINGS
    --  Includes: dollar_rate (1 USD = X SP), report_currency, store info...
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ─────────────────────────────────────────────────────────────────────
    --  SYNC QUEUE  (outbox pattern)
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS sync_queue (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name  TEXT    NOT NULL,
      operation   TEXT    NOT NULL CHECK(operation IN ('insert','update','delete')),
      row_id      INTEGER NOT NULL,
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
      ('store_name',        'My Store'),
      ('store_address',     ''),
      ('store_phone',       ''),
      ('dollar_rate',       '15000'),   -- 1 USD = 15000 SP default
      ('report_currency',   'SP'),      -- 'SP' | 'USD' — used in reports/stats
      ('sync_base',         ''),
      ('sync_token',        '');

    INSERT OR IGNORE INTO sync_meta (key, value) VALUES ('last_synced_at', NULL);
  `);

  // Seed default admin if staff table is empty
  const count = db.prepare("SELECT COUNT(*) as n FROM staff").get();
  if (count.n === 0) {
    db.prepare(
      `
      INSERT INTO staff (full_name, username, password, role, is_active)
      VALUES ('Admin', 'admin', 'admin', 'admin', 1)
    `,
    ).run();
  }

  // Seed sample categories if empty
  const catCount = db.prepare("SELECT COUNT(*) as n FROM categories").get();
  if (catCount.n === 0) {
    db.prepare(`INSERT INTO categories (name) VALUES ('General')`).run();
  }
}
