// store-app/license/licenseManager.js
import pkg from "node-machine-id";
const { machineIdSync } = pkg;
import { app } from "electron";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  openSync,
  fsyncSync,
  closeSync,
} from "fs";
import path from "path";

const LICENSE_SERVER = "https://storecore-backend.onrender.com";
const GRACE_DAYS = 7;

// ── File store ────────────────────────────────────────────────────────────────
const getStorePath = () => path.join(app.getPath("userData"), "license.json");

const store = {
  get: (key) => {
    try {
      const p = getStorePath();
      if (!existsSync(p)) return null;
      const data = JSON.parse(readFileSync(p, "utf8"));
      return data[key] ?? null;
    } catch {
      return null;
    }
  },

  // FIX: Added mkdirSync guard + fsync to force OS flush before returning.
  // Without fsync, writeFileSync can return before the data hits disk on
  // Windows (write-back caching), causing getSavedKey() to return null
  // immediately after a successful write.
  set: (key, value) => {
    const p = getStorePath();
    const dir = path.dirname(p);

    // Ensure the directory exists
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Read existing data
    let data = {};
    if (existsSync(p)) {
      try {
        data = JSON.parse(readFileSync(p, "utf8"));
      } catch {
        data = {}; // corrupt — start fresh
      }
    }

    data[key] = value;
    const json = JSON.stringify(data, null, 2);

    // Write and force-flush to disk before returning
    const fd = openSync(p, "w");
    try {
      writeFileSync(p, json, "utf8"); // write content
      fsyncSync(fd); // flush OS write-back cache
    } finally {
      closeSync(fd);
    }
  },

  delete: (key) => {
    try {
      const p = getStorePath();
      if (!existsSync(p)) return;
      const data = JSON.parse(readFileSync(p, "utf8"));
      delete data[key];
      writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
    } catch {}
  },
};

// ── Machine ID ─────────────────────────────────────────────────────────────────
export const getMachineId = () => {
  try {
    return machineIdSync({ original: true });
  } catch (err) {
    console.error("[license] getMachineId failed:", err.message);
    return "unknown";
  }
};

const saveLicense = (key) => {
  store.set("license_key", key);
  store.set("last_verified_at", new Date().toISOString());
};

const isWithinGrace = () => {
  const last = store.get("last_verified_at");
  if (!last) return false;
  const ts = new Date(last).getTime();
  if (isNaN(ts)) return false;
  return (Date.now() - ts) / 86400000 < GRACE_DAYS;
};

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
    console.warn("[license] persistToSettings failed:", err.message);
  }
};

const removeFromSettings = (db) => {
  if (!db) return;
  try {
    db.prepare(`UPDATE settings SET value='' WHERE key='license_key'`).run();
  } catch {}
};

// ── Activate ───────────────────────────────────────────────────────────────────
export const activateLicense = async (key, db) => {
  if (!key?.trim()) return { ok: false, error: "License key cannot be empty" };

  const machine_id = getMachineId();
  try {
    const res = await fetch(`${LICENSE_SERVER}/license/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: key.trim(),
        machine_id,
        platform: "desktop",
      }),
      signal: AbortSignal.timeout(12000),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.ok) {
      saveLicense(key.trim());
      persistToSettings(db, key.trim());
      return { ok: true };
    }
    return {
      ok: false,
      error: json.error ?? `Server error (HTTP ${res.status})`,
    };
  } catch (err) {
    return {
      ok: false,
      error: "Cannot reach license server. Check your internet connection.",
    };
  }
};

// ── Verify ─────────────────────────────────────────────────────────────────────
export const verifyLicense = async () => {
  const key = store.get("license_key");
  if (!key?.trim()) return { ok: false, reason: "no_license" };

  const machine_id = getMachineId();
  try {
    const res = await fetch(`${LICENSE_SERVER}/license/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, machine_id, platform: "desktop" }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.status >= 500) {
      if (isWithinGrace()) return { ok: true, offline: true };
      return { ok: false, reason: "server_error" };
    }
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.ok) {
      store.set("last_verified_at", new Date().toISOString());
      return { ok: true };
    }
    return { ok: false, reason: "invalid", error: json.error };
  } catch {
    if (isWithinGrace()) return { ok: true, offline: true };
    return { ok: false, reason: "offline_grace_expired" };
  }
};

// ── Deactivate ─────────────────────────────────────────────────────────────────
export const deactivateLicense = async (db) => {
  const key = store.get("license_key");
  if (!key) return { ok: false, error: "No license found" };

  const machine_id = getMachineId();
  try {
    const res = await fetch(`${LICENSE_SERVER}/license/deactivate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, machine_id, platform: "desktop" }),
      signal: AbortSignal.timeout(12000),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.ok) {
      store.delete("license_key");
      store.delete("last_verified_at");
      removeFromSettings(db);
      return { ok: true };
    }
    return {
      ok: false,
      error: json.error ?? `Server error (HTTP ${res.status})`,
    };
  } catch {
    return { ok: false, error: "Cannot reach license server." };
  }
};

export const getSavedKey = () => store.get("license_key") ?? null;
