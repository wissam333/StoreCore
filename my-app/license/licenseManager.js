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

// ── Activate ──────────────────────────────────────────────────────────────────
// db is passed in from main.js so we can also persist the key to SQLite settings.
// This means useStoreSync can read it via getSettings() without any user config.
export const activateLicense = async (key, db) => {
  const machine_id = getMachineId();
  try {
    const res = await fetch(`${LICENSE_SERVER}/license/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, machine_id, platform: "desktop" }),
    });
    const json = await res.json();
    if (json.ok) {
      // 1. Save to license.json (used by verifyLicense / grace period)
      saveLicense(key);

      // 2. Also persist into SQLite settings so sync composable can read it
      if (db) {
        try {
          db.prepare(
            `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
          ).run("license_key", key);

          // Auto-set sync_base if not already configured
          const existing = db
            .prepare(`SELECT value FROM settings WHERE key='sync_base'`)
            .get();
          if (!existing?.value?.trim()) {
            db.prepare(
              `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
            ).run("sync_base", LICENSE_SERVER);
          }
        } catch (dbErr) {
          console.warn(
            "[license] Could not persist key to SQLite:",
            dbErr.message,
          );
        }
      }

      return { ok: true };
    }
    return { ok: false, error: json.error };
  } catch {
    return { ok: false, error: "Cannot reach license server" };
  }
};

export const verifyLicense = async () => {
  const key = store.get("license_key");
  if (!key) return { ok: false, reason: "no_license" };
  const machine_id = getMachineId();
  try {
    const res = await fetch(`${LICENSE_SERVER}/license/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, machine_id, platform: "desktop" }),
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
    });
    const json = await res.json();
    if (json.ok) {
      store.delete("license_key");
      store.delete("last_verified_at");

      // Also remove from SQLite settings
      if (db) {
        try {
          db.prepare(`DELETE FROM settings WHERE key='license_key'`).run();
        } catch {}
      }

      return { ok: true };
    }
    return { ok: false, error: json.error };
  } catch {
    return { ok: false, error: "Cannot reach license server" };
  }
};

export const getSavedKey = () => store.get("license_key") ?? null;
