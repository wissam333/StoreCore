const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./C0o599Qe.js","./CqHG6KKt.js","./entry.9VHxcgW3.css","./CC5hy8mN.js"])))=>i.map(i=>d[i]);
import{_ as r}from"#entry";import{getMobileDb as N}from"./CJiXDk3D.js";const E=async(T,e)=>{await T.execute(e.trim())},i=async T=>{try{const{Preferences:e}=await r(async()=>{const{Preferences:d}=await import("./C0o599Qe.js");return{Preferences:d}},__vite__mapDeps([0,1,2,3]),import.meta.url);if(!(await e.get({key:"sqlitedb"}))?.value)return;await e.remove({key:"sqlitedb"}),console.log("[schema] Cleared legacy sql.js preferences data")}catch{}},s=async()=>{const T=await N();await i(),await E(T,`
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
  `),await E(T,`
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
  `),await E(T,`
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
  `),await E(T,`
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
  `),await E(T,`
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
  `),await E(T,`
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
  `),await E(T,`
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
  `),await E(T,`
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
  `),await E(T,`
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `),await E(T,`
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
  `),await E(T,`
    CREATE TABLE IF NOT EXISTS sync_meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    )
  `);const e=["ALTER TABLE categories  ADD COLUMN version INTEGER NOT NULL DEFAULT 1","ALTER TABLE products    ADD COLUMN version INTEGER NOT NULL DEFAULT 1","ALTER TABLE customers   ADD COLUMN version INTEGER NOT NULL DEFAULT 1","ALTER TABLE orders      ADD COLUMN version INTEGER NOT NULL DEFAULT 1","ALTER TABLE order_items ADD COLUMN version INTEGER NOT NULL DEFAULT 1","ALTER TABLE dues        ADD COLUMN version INTEGER NOT NULL DEFAULT 1","ALTER TABLE staff       ADD COLUMN version INTEGER NOT NULL DEFAULT 1","ALTER TABLE sync_queue ADD COLUMN changed_fields TEXT"];for(const t of e)try{await T.run(t)}catch{}const L=[["store_name","My Store"],["store_address",""],["store_phone",""],["dollar_rate","15000"],["report_currency","SP"],["sync_base",""],["sync_token",""]];for(const[t,a]of L)await T.run("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",[t,a]);if(await T.run("INSERT OR IGNORE INTO sync_meta (key, value) VALUES ('last_synced_at', NULL)"),((await T.query("SELECT COUNT(*) as n FROM staff")).values?.[0]?.n??0)===0){const{generateUuid:t}=await r(async()=>{const{generateUuid:a}=await import("./wodZJkL-.js");return{generateUuid:a}},[],import.meta.url);await T.run("INSERT INTO staff (id, full_name, username, password, role, is_active) VALUES (?, ?, ?, ?, ?, ?)",[t(),"Admin","admin","admin","admin",1])}};export{s as initMobileSchema};
