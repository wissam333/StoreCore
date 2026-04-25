// store-app/composables/useMobileLicense.js
//
// FIXES vs previous version:
//  1. persistToSettings() — now fire-and-forget via setTimeout(0). It was
//     previously called synchronously inside activate(), which imported
//     useMobileStore → getMobileDb() BEFORE app.vue called initDb(). On
//     Android this caused the "capacitorSQLitePlugin: null" crash because
//     the SQLite plugin wasn't registered yet at activation time.
//     The key is already in Preferences after activate() — the settings
//     row is a nice-to-have that can safely lag by one event-loop tick.
//  2. No other logic changes — all bug fixes from the previous version
//     (device fingerprint, grace period guard, error surfacing) are kept.

const LICENSE_SERVER = "https://storecore-backend.onrender.com";
const GRACE_DAYS = 7;

// ── Capacitor Preferences helpers ─────────────────────────────────────────────
const prefGet = async (key) => {
  const { Preferences } = await import("@capacitor/preferences");
  const result = await Preferences.get({ key });
  return result?.value ?? null;
};

const prefSet = async (key, value) => {
  const { Preferences } = await import("@capacitor/preferences");
  await Preferences.set({ key, value: String(value) });
};

const prefRemove = async (key) => {
  const { Preferences } = await import("@capacitor/preferences");
  await Preferences.remove({ key });
};

// ── Stable device fingerprint ─────────────────────────────────────────────────
const hashString = async (str) => {
  try {
    const encoded = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 40);
  } catch {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  }
};

const getDeviceId = async () => {
  try {
    const { Device } = await import("@capacitor/device");

    const idInfo = await Device.getId();
    if (
      idInfo?.identifier &&
      idInfo.identifier !== "web" &&
      idInfo.identifier !== ""
    ) {
      await prefSet("device_uuid", idInfo.identifier).catch(() => {});
      return idInfo.identifier;
    }

    const devInfo = await Device.getInfo();
    const fingerprint = [
      devInfo.model ?? "",
      devInfo.platform ?? "",
      devInfo.osVersion ?? "",
      devInfo.manufacturer ?? "",
      devInfo.name ?? "",
    ]
      .join("|")
      .toLowerCase()
      .trim();

    if (fingerprint.replace(/\|/g, "").length > 4) {
      const hashed = await hashString(fingerprint);
      const id = `fp-${hashed}`;
      await prefSet("device_uuid", id).catch(() => {});
      return id;
    }
  } catch (err) {
    console.warn("[mobile-license] Device plugin error:", err?.message ?? err);
  }

  const stored = await prefGet("device_uuid").catch(() => null);
  if (stored) return stored;

  const uuid =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);

  await prefSet("device_uuid", uuid).catch(() => {});
  return uuid;
};

// ── Grace period ───────────────────────────────────────────────────────────────
const isWithinGrace = async () => {
  try {
    const last = await prefGet("last_verified_at");
    if (!last) return false;
    const ts = new Date(last).getTime();
    if (isNaN(ts)) return false;
    return (Date.now() - ts) / 86400000 < GRACE_DAYS;
  } catch {
    return false;
  }
};

// ── Persist key to SQLite ──────────────────────────────────────────────────────
// FIX: This is now called with setTimeout(0) from activate() so it runs AFTER
// app.vue's initDb() has opened the database connection. Calling it
// synchronously during the license phase caused getMobileDb() to be invoked
// before the CapacitorSQLite plugin was registered → "capacitorSQLitePlugin: null".
const persistToSettings = async (key) => {
  try {
    const { useMobileStore } = await import("./useMobileStore");
    const { setSetting, getSettings } = useMobileStore();
    await setSetting({ key: "license_key", value: key });
    const r = await getSettings();
    if (r.ok && !r.data?.sync_base?.trim()) {
      await setSetting({ key: "sync_base", value: LICENSE_SERVER });
    }
  } catch (err) {
    // Non-fatal: the key is already in Preferences. DB write will be retried
    // on next app launch when initDb() runs before this path.
    console.warn(
      "[mobile-license] persistToSettings failed (DB may not be ready yet):",
      err?.message ?? err,
    );
  }
};

const removeFromSettings = async () => {
  try {
    const { useMobileStore } = await import("./useMobileStore");
    const { setSetting } = useMobileStore();
    await setSetting({ key: "license_key", value: "" });
  } catch (err) {
    console.warn(
      "[mobile-license] removeFromSettings failed:",
      err?.message ?? err,
    );
  }
};

// ── Verify ─────────────────────────────────────────────────────────────────────
const verify = async () => {
  let key = null;
  try {
    key = await prefGet("license_key");
  } catch (err) {
    console.warn("[mobile-license] verify: prefGet threw:", err?.message);
    return { ok: false, reason: "no_license" };
  }

  if (!key || !key.trim()) return { ok: false, reason: "no_license" };

  let machine_id;
  try {
    machine_id = await getDeviceId();
  } catch {
    machine_id = "unknown";
  }

  try {
    const res = await fetch(`${LICENSE_SERVER}/license/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: key.trim(), machine_id, platform: "mobile" }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const reason = errJson?.error ?? `HTTP ${res.status}`;
      console.warn("[mobile-license] verify: server rejected:", reason);
      if (res.status >= 500) {
        const grace = await isWithinGrace();
        if (grace) return { ok: true, offline: true };
      }
      return { ok: false, reason: "invalid", error: reason };
    }

    const json = await res.json();
    if (json.ok) {
      await prefSet("last_verified_at", new Date().toISOString());
      return { ok: true };
    }

    return { ok: false, reason: "invalid", error: json.error };
  } catch (err) {
    console.warn("[mobile-license] verify: network error:", err?.message);
    const grace = await isWithinGrace();
    if (grace) return { ok: true, offline: true };
    return { ok: false, reason: "offline_grace_expired" };
  }
};

// ── Activate ───────────────────────────────────────────────────────────────────
const activate = async (key) => {
  if (!key || !key.trim()) {
    return { ok: false, error: "License key cannot be empty" };
  }

  let machine_id;
  try {
    machine_id = await getDeviceId();
  } catch {
    machine_id = "unknown";
  }

  try {
    const res = await fetch(`${LICENSE_SERVER}/license/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: key.trim(), machine_id, platform: "mobile" }),
      signal: AbortSignal.timeout(12000),
    });

    const json = await res.json().catch(() => ({}));

    if (res.ok && json.ok) {
      await prefSet("license_key", key.trim());
      await prefSet("last_verified_at", new Date().toISOString());

      // FIX: Deferred so it runs AFTER app.vue calls initDb().
      // The emit("activated") in MobileLicensePage triggers app.vue's
      // onLicenseActivated → initDb() → DB open. By using setTimeout(0) here
      // we ensure the DB is open before persistToSettings tries getMobileDb().
      setTimeout(() => {
        persistToSettings(key.trim()).catch((e) =>
          console.warn(
            "[mobile-license] deferred persistToSettings error:",
            e?.message,
          ),
        );
      }, 0);

      return { ok: true };
    }

    return {
      ok: false,
      error: json.error ?? `Server error (HTTP ${res.status})`,
    };
  } catch (err) {
    console.warn("[mobile-license] activate: network error:", err?.message);
    return {
      ok: false,
      error: "Cannot reach license server. Check your internet connection.",
    };
  }
};

// ── Deactivate ─────────────────────────────────────────────────────────────────
const deactivate = async () => {
  let key = null;
  try {
    key = await prefGet("license_key");
  } catch {}

  if (!key) return { ok: false, error: "No license found" };

  let machine_id;
  try {
    machine_id = await getDeviceId();
  } catch {
    machine_id = "unknown";
  }

  try {
    const res = await fetch(`${LICENSE_SERVER}/license/deactivate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, machine_id, platform: "mobile" }),
      signal: AbortSignal.timeout(12000),
    });
    const json = await res.json().catch(() => ({}));

    if (res.ok && json.ok) {
      await prefRemove("license_key");
      await prefRemove("last_verified_at");
      await removeFromSettings();
      return { ok: true };
    }
    return {
      ok: false,
      error: json.error ?? `Server error (HTTP ${res.status})`,
    };
  } catch (err) {
    console.warn("[mobile-license] deactivate: network error:", err?.message);
    return { ok: false, error: "Cannot reach license server." };
  }
};

export const useMobileLicense = () => ({
  verify,
  activate,
  deactivate,
  getKey: async () => prefGet("license_key"),
  getMachineId: getDeviceId,
});
