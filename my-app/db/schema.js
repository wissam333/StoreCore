// store-app/db/schema.js
// Run once on first launch to create all tables + sync infrastructure.
// Called synchronously from main.js — no top-level await allowed here.

// ── Permission keys (single source of truth) ──────────────────────────────────
// Any change here must be mirrored in useMobileSchema.js
export const ALL_PERMISSIONS = {
  products: ["view", "add", "edit", "delete"],
  orders: ["view", "add", "edit", "delete"],
  customers: ["view", "add", "edit", "delete"],
  dues: ["view", "add", "edit", "delete"],
  reports: ["view"],
  settings: ["view", "edit"],
  staff: ["view", "manage"],
};

// Flat object — all permissions set to given value
export const buildPermissions = (defaultValue = false) => {
  const out = {};
  for (const [module, actions] of Object.entries(ALL_PERMISSIONS)) {
    for (const action of actions) {
      out[`${module}.${action}`] = defaultValue;
    }
  }
  return out;
};

// Admin gets everything true, named roles get everything false (customised later)
export const ADMIN_PERMISSIONS = buildPermissions(true);
export const DEFAULT_PERMISSIONS = buildPermissions(false);

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

    -- ── ROLES ─────────────────────────────────────────────────────────────────
    -- permissions: JSON blob — flat key/value e.g. {"products.view":true, ...}
    -- is_system: 1 = built-in role that cannot be deleted (admin only)
    CREATE TABLE IF NOT EXISTS roles (
      id          TEXT    PRIMARY KEY,
      name        TEXT    NOT NULL UNIQUE,
      permissions TEXT    NOT NULL DEFAULT '{}',
      is_system   INTEGER DEFAULT 0,
      version     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    DEFAULT (datetime('now')),
      updated_at  TEXT    DEFAULT (datetime('now')),
      _deleted    INTEGER DEFAULT 0,
      synced_at   TEXT
    );

    -- ── STAFF ─────────────────────────────────────────────────────────────────
    -- role_id: FK → roles.id  (replaces the old plain-text role column)
    -- pin:     optional 4-6 digit PIN stored as salt:sha256hash, used for
    --          quick re-auth and fingerprint-backed login on mobile
    -- password: salt:sha256hash after first login (plain 'admin' only on seed)
    -- last_login: ISO datetime of most recent successful login
    CREATE TABLE IF NOT EXISTS staff (
      id          TEXT    PRIMARY KEY,
      full_name   TEXT    NOT NULL,
      username    TEXT    UNIQUE,
      password    TEXT,
      pin         TEXT,
      role_id     TEXT    REFERENCES roles(id),
      role        TEXT,
      phone       TEXT,
      email       TEXT,
      is_active   INTEGER DEFAULT 1,
      last_login  TEXT,
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
    // New columns added in this version
    `ALTER TABLE staff ADD COLUMN pin       TEXT`,
    `ALTER TABLE staff ADD COLUMN role_id   TEXT REFERENCES roles(id)`,
    `ALTER TABLE staff ADD COLUMN last_login TEXT`,
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
    `CREATE TABLE IF NOT EXISTS roles (
      id          TEXT    PRIMARY KEY,
      name        TEXT    NOT NULL UNIQUE,
      permissions TEXT    NOT NULL DEFAULT '{}',
      is_system   INTEGER DEFAULT 0,
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
      /* already exists — expected */
    }
  }

  const uuid = () => crypto.randomUUID();

  // ── Seed admin role ───────────────────────────────────────────────────────
  // is_system = 1 means it cannot be deleted from the UI
  const adminRoleRow = db
    .prepare(`SELECT id FROM roles WHERE name = 'Administrator' LIMIT 1`)
    .get();

  let adminRoleId = adminRoleRow?.id;

  if (!adminRoleId) {
    adminRoleId = uuid();
    db.prepare(
      `
      INSERT INTO roles (id, name, permissions, is_system)
      VALUES (?, 'Administrator', ?, 1)
    `,
    ).run(adminRoleId, JSON.stringify(ADMIN_PERMISSIONS));
  }

  // ── Seed cashier role (all false — admin customises later) ────────────────
  const cashierRoleExists = db
    .prepare(`SELECT id FROM roles WHERE name = 'Cashier' LIMIT 1`)
    .get();

  if (!cashierRoleExists) {
    // Sensible cashier defaults: can view+add orders, view products/customers
    const cashierPerms = {
      ...DEFAULT_PERMISSIONS,
      "products.view": true,
      "orders.view": true,
      "orders.add": true,
      "customers.view": true,
      "customers.add": true,
      "dues.view": true,
    };
    db.prepare(
      `
      INSERT INTO roles (id, name, permissions, is_system)
      VALUES (?, 'Cashier', ?, 0)
    `,
    ).run(uuid(), JSON.stringify(cashierPerms));
  }

  // ── Seed admin staff account ──────────────────────────────────────────────
  // password = 'admin' stored plain — IPC login handler hashes it on first use
  // and replaces this value. It never stays plain after the first login.
  const staffCount = db.prepare(`SELECT COUNT(*) as n FROM staff`).get();
  if (staffCount.n === 0) {
    db.prepare(
      `
      INSERT INTO staff (id, full_name, username, password, role, role_id, is_active)
      VALUES (?, 'Admin', 'admin', 'admin', 'admin', ?, 1)
    `,
    ).run(uuid(), adminRoleId);
  } else {
    // Backfill role_id for existing admin accounts that pre-date this migration
    db.prepare(
      `
      UPDATE staff SET role_id = ?
      WHERE role = 'admin' AND role_id IS NULL
    `,
    ).run(adminRoleId);
  }

  // ── Backfill: migrate existing paid_amount into order_payments ─────────────
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
        const rate =
          parseFloat(
            db
              .prepare(`SELECT value FROM settings WHERE key='dollar_rate'`)
              .get()?.value ?? "15000",
          ) || 15000;
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
          o.display_currency === "USD" ? o.paid_amount * rate : o.paid_amount,
        );
      }
    }
  } catch (e) {
    console.warn("[schema] backfill skipped:", e.message);
  }
}
