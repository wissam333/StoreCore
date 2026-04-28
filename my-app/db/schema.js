// store-app/db/schema.js
// Run once on first launch to create all tables + sync infrastructure.
// Called synchronously from main.js — no top-level await allowed here.

export function initSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

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

    -- ── ORDER PAYMENTS (new — tracks every individual payment) ──────────────
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

    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name     TEXT    NOT NULL,
      operation      TEXT    NOT NULL CHECK(operation IN ('insert','update','delete')),
      row_id         TEXT    NOT NULL,
      payload        TEXT,
      queued_at      TEXT    DEFAULT (datetime('now')),
      synced_at      TEXT,
      retry_count    INTEGER DEFAULT 0,
      changed_fields TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

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

  // ── Migrations (safe to re-run) ───────────────────────────────────────────
  const migrations = [
    `ALTER TABLE categories  ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE products    ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE customers   ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE orders      ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE order_items ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE dues        ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE staff       ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE sync_queue  ADD COLUMN changed_fields TEXT`,
    `CREATE TABLE IF NOT EXISTS order_payments (
      id          TEXT    PRIMARY KEY,
      order_id    TEXT    NOT NULL,
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
    )`,
  ];
  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch {
      /* already exists */
    }
  }

  const uuid = () => crypto.randomUUID();

  const staffCount = db.prepare(`SELECT COUNT(*) as n FROM staff`).get();
  if (staffCount.n === 0) {
    db.prepare(
      `INSERT INTO staff (id, full_name, username, password, role, is_active)
       VALUES (?, 'Admin', 'admin', 'admin', 'admin', 1)`,
    ).run(uuid());
  }

  const catCount = db.prepare(`SELECT COUNT(*) as n FROM categories`).get();
  if (catCount.n === 0) {
    db.prepare(`INSERT INTO categories (id, name) VALUES (?, 'General')`).run(
      uuid(),
    );
  }

  // ── Backfill: migrate existing paid_amount into order_payments ─────────────
  // Only runs once — checks if any payments already exist for each order.
  try {
    const paidOrders = db
      .prepare(
        `
      SELECT id, paid_amount, display_currency, total_sp
      FROM orders
      WHERE paid_amount > 0 AND _deleted = 0
    `,
      )
      .all();

    for (const o of paidOrders) {
      const existing = db
        .prepare(`SELECT COUNT(*) as n FROM order_payments WHERE order_id = ?`)
        .get(o.id);
      if (existing.n === 0) {
        db.prepare(
          `
          INSERT INTO order_payments (id, order_id, amount, currency, amount_sp, note, paid_at)
          VALUES (?, ?, ?, ?, ?, 'Migrated payment', datetime('now'))
        `,
        ).run(
          uuid(),
          o.id,
          o.paid_amount,
          o.display_currency,
          o.display_currency === "USD"
            ? o.paid_amount *
                (parseFloat(
                  db
                    .prepare(
                      `SELECT value FROM settings WHERE key='dollar_rate'`,
                    )
                    .get()?.value ?? "15000",
                ) || 15000)
            : o.paid_amount,
        );
      }
    }
  } catch (e) {
    console.warn("[schema] backfill skipped:", e.message);
  }
}
