// my-app/db/schema.js
// Run this once on first launch to set up all tables + the sync queue.

export function initSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    -- ─────────────────────────────────────────────────────────────────────
    --  PATIENTS
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS patients (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name      TEXT    NOT NULL,
      gender         TEXT    CHECK(gender IN ('male','female','other')),
      dob            TEXT,
      phone          TEXT,
      email          TEXT,
      address        TEXT,
      blood_type     TEXT,
      allergies      TEXT,
      notes          TEXT,
      visit_count    INTEGER DEFAULT 0,
      last_visit     TEXT,
      created_at     TEXT    DEFAULT (datetime('now')),
      updated_at     TEXT    DEFAULT (datetime('now')),
      _deleted       INTEGER DEFAULT 0,
      synced_at      TEXT
    );

    -- ─────────────────────────────────────────────────────────────────────
    --  STAFF
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS staff (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name   TEXT    NOT NULL,
      username    TEXT    UNIQUE,
      password    TEXT,
      role        TEXT    CHECK(role IN ('admin','doctor','nurse','receptionist')),
      specialty   TEXT,
      phone       TEXT,
      email       TEXT,
      is_active   INTEGER DEFAULT 1,
      created_at  TEXT    DEFAULT (datetime('now')),
      updated_at  TEXT    DEFAULT (datetime('now')),
      _deleted    INTEGER DEFAULT 0,
      synced_at   TEXT
    );

    -- ─────────────────────────────────────────────────────────────────────
    --  VISITS
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS visits (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id       INTEGER REFERENCES patients(id),
      doctor_id        INTEGER REFERENCES staff(id),
      visit_date       TEXT    DEFAULT (datetime('now')),
      chief_complaint  TEXT,
      diagnosis        TEXT,
      treatment        TEXT,
      notes            TEXT,
      status           TEXT    DEFAULT 'open' CHECK(status IN ('open','closed','followup')),
      fee              REAL    DEFAULT 0,
      paid             INTEGER DEFAULT 0,
      created_at       TEXT    DEFAULT (datetime('now')),
      updated_at       TEXT    DEFAULT (datetime('now')),
      _deleted         INTEGER DEFAULT 0,
      synced_at        TEXT
    );

    -- ─────────────────────────────────────────────────────────────────────
    --  PRESCRIPTIONS
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS prescriptions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      visit_id     INTEGER REFERENCES visits(id),
      patient_id   INTEGER REFERENCES patients(id),
      drug_name    TEXT    NOT NULL,
      dose         TEXT,
      route        TEXT,
      frequency    TEXT,
      duration     TEXT,
      instructions TEXT,
      created_at   TEXT    DEFAULT (datetime('now')),
      updated_at   TEXT    DEFAULT (datetime('now')),
      _deleted     INTEGER DEFAULT 0,
      synced_at    TEXT
    );

    -- ─────────────────────────────────────────────────────────────────────
    --  INVESTIGATIONS
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS investigations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      visit_id    INTEGER REFERENCES visits(id),
      patient_id  INTEGER REFERENCES patients(id),
      test_name   TEXT    NOT NULL,
      test_type   TEXT,
      ordered_at  TEXT    DEFAULT (datetime('now')),
      result      TEXT,
      result_at   TEXT,
      status      TEXT    DEFAULT 'pending' CHECK(status IN ('pending','resulted','reviewed')),
      notes       TEXT,
      created_at  TEXT    DEFAULT (datetime('now')),
      updated_at  TEXT    DEFAULT (datetime('now')),
      _deleted    INTEGER DEFAULT 0,
      synced_at   TEXT
    );

    -- ─────────────────────────────────────────────────────────────────────
    --  APPOINTMENTS
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS appointments (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id   INTEGER REFERENCES patients(id),
      doctor_id    INTEGER REFERENCES staff(id),
      appt_date    TEXT    NOT NULL,
      duration_min INTEGER DEFAULT 30,
      reason       TEXT,
      status       TEXT    DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','cancelled','no_show')),
      notes        TEXT,
      created_at   TEXT    DEFAULT (datetime('now')),
      updated_at   TEXT    DEFAULT (datetime('now')),
      _deleted     INTEGER DEFAULT 0,
      synced_at    TEXT
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
    --  SYNC QUEUE  (outbox pattern — every write enqueues here)
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS sync_queue (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name  TEXT    NOT NULL,
      operation   TEXT    NOT NULL CHECK(operation IN ('insert','update','delete')),
      row_id      INTEGER NOT NULL,
      payload     TEXT,                         -- JSON snapshot of the row
      queued_at   TEXT    DEFAULT (datetime('now')),
      synced_at   TEXT                          -- NULL = pending
    );

    -- ─────────────────────────────────────────────────────────────────────
    --  SYNC META  (tracks last successful sync timestamp)
    -- ─────────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS sync_meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    -- Seed default settings if not present
    INSERT OR IGNORE INTO settings (key, value) VALUES
      ('clinic_name',   'My Clinic'),
      ('clinic_address',''),
      ('clinic_phone',  ''),
      ('currency',      'USD'),
      ('sync_base',     ''),
      ('sync_token',    '');

    INSERT OR IGNORE INTO sync_meta (key, value) VALUES ('last_synced_at', NULL);
  `);

  // Seed a default admin if table is empty
  const count = db.prepare("SELECT COUNT(*) as n FROM staff").get();
  if (count.n === 0) {
    db.prepare(`
      INSERT INTO staff (full_name, username, password, role, is_active)
      VALUES ('Admin', 'admin', 'admin', 'admin', 1)
    `).run();
  }
}
