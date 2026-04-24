// store-app/license/licenseManager.js
import pkg from "node-machine-id";
const { machineIdSync } = pkg;
import { app } from "electron";
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";

const LICENSE_SERVER = "https://storecore-backend.onrender.com";
const GRACE_DAYS = 7;

// ── Simple file-based store ───────────────────────────────────────────────────
const getStorePath = () => path.join(app.getPath("userData"), "license.json");

const store = {
  get: (key) => {
    try {
      if (!existsSync(getStorePath())) return null;
      const data = JSON.parse(readFileSync(getStorePath(), "utf8"));
      return data[key] ?? null;
    } catch {
      return null;
    }
  },
  set: (key, value) => {
    try {
      let data = {};
      if (existsSync(getStorePath())) {
        data = JSON.parse(readFileSync(getStorePath(), "utf8"));
      }
      data[key] = value;
      writeFileSync(getStorePath(), JSON.stringify(data, null, 2));
    } catch {}
  },
  delete: (key) => {
    try {
      if (!existsSync(getStorePath())) return;
      const data = JSON.parse(readFileSync(getStorePath(), "utf8"));
      delete data[key];
      writeFileSync(getStorePath(), JSON.stringify(data, null, 2));
    } catch {}
  },
};

// ── Machine ID ────────────────────────────────────────────────────────────────
export const getMachineId = () => machineIdSync({ original: true });

// ── Save license locally after activation ─────────────────────────────────────
const saveLicense = (key) => {
  store.set("license_key", key);
  store.set("last_verified_at", new Date().toISOString());
};

// ── Check grace period ────────────────────────────────────────────────────────
const isWithinGrace = () => {
  const last = store.get("last_verified_at");
  if (!last) return false;
  const diff = (Date.now() - new Date(last).getTime()) / (1000 * 60 * 60 * 24);
  return diff < GRACE_DAYS;
};

// ── Persist to SQLite settings ────────────────────────────────────────────────
const persistToSettings = (db, key) => {
  if (!db) return;
  try {
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    ).run("license_key", key);

    const existing = db
      .prepare(`SELECT value FROM settings WHERE key='sync_base'`)
      .get();
    if (!existing?.value?.trim()) {
      db.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
      ).run("sync_base", LICENSE_SERVER);
    }
  } catch (err) {
    console.warn("[license] Could not persist key to SQLite:", err.message);
  }
};

const removeFromSettings = (db) => {
  if (!db) return;
  try {
    db.prepare(`DELETE FROM settings WHERE key='license_key'`).run();
  } catch {}
};

// ── Activate ──────────────────────────────────────────────────────────────────
export const activateLicense = async (key, db) => {
  const machine_id = getMachineId();
  try {
    const res = await fetch(`${LICENSE_SERVER}/license/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, machine_id, platform: "desktop" }),
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json();
    if (json.ok) {
      saveLicense(key);
      persistToSettings(db, key);
      return { ok: true };
    }
    return { ok: false, error: json.error ?? "Activation failed" };
  } catch {
    return { ok: false, error: "Cannot reach license server" };
  }
};

// ── Verify ────────────────────────────────────────────────────────────────────
export const verifyLicense = async () => {
  const key = store.get("license_key");
  if (!key) return { ok: false, reason: "no_license" };

  const machine_id = getMachineId();
  try {
    const res = await fetch(`${LICENSE_SERVER}/license/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, machine_id, platform: "desktop" }),
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json();
    if (json.ok) {
      store.set("last_verified_at", new Date().toISOString());
      return { ok: true };
    }
    return { ok: false, reason: "invalid", error: json.error };
  } catch {
    if (isWithinGrace()) return { ok: true, offline: true };
    return { ok: false, reason: "offline_grace_expired" };
  }
};

// ── Deactivate ────────────────────────────────────────────────────────────────
export const deactivateLicense = async (db) => {
  const key = store.get("license_key");
  if (!key) return { ok: false, error: "No license found" };

  const machine_id = getMachineId();
  try {
    const res = await fetch(`${LICENSE_SERVER}/license/deactivate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, machine_id, platform: "desktop" }),
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json();
    if (json.ok) {
      store.delete("license_key");
      store.delete("last_verified_at");
      removeFromSettings(db);
      return { ok: true };
    }
    return { ok: false, error: json.error };
  } catch {
    return { ok: false, error: "Cannot reach license server" };
  }
};

export const getSavedKey = () => store.get("license_key") ?? null;
