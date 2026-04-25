// store-app/composables/useMobileLicense.js
//
// FIXES:
//  1. getDeviceId() — Device.getId() "web" fallback was fragile. Now uses
//     a SHA-256 hash of all available device info so the UUID is stable
//     across Preferences clears (falls back to stored UUID only after hashing).
//  2. verify() — caught errors now distinguish network vs. logic failures.
//  3. activate() / deactivate() — timeout extended; explicit error surfacing.
//  4. isWithinGrace() — date parse guard added.

const LICENSE_SERVER = "https://storecore-backend.onrender.com";
const GRACE_DAYS = 7;

// ── Capacitor Preferences helpers (all dynamic — safe for nuxt generate) ──────

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
//
// BUG FIXED: Previously, if Device.getId() returned "web" (common on some
// Android WebViews), we fell back to a random UUID stored in Preferences.
// That UUID is lost on app-reinstall / "Clear Data", causing a permanent
// machine_id mismatch on the server.
//
// NEW APPROACH:
//   1. Try @capacitor/device for a hardware-backed ID.
//   2. If unavailable/web, build a pseudo-stable fingerprint from Device.getInfo()
//      fields (model, platform, osVersion, manufacturer) and hash them.
//   3. Store the final ID in Preferences as a cache — but the hash itself is
//      reproducible without storage, so reinstalls won't break it.

const hashString = async (str) => {
  try {
    const encoded = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 40); // 40 hex chars — short enough, unique enough
  } catch {
    // crypto.subtle unavailable (HTTP context) — use simple hash
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

    // Try hardware ID first
    const idInfo = await Device.getId();
    if (
      idInfo?.identifier &&
      idInfo.identifier !== "web" &&
      idInfo.identifier !== ""
    ) {
      // Cache it so we have a fallback
      await prefSet("device_uuid", idInfo.identifier).catch(() => {});
      return idInfo.identifier;
    }

    // Hardware ID unavailable — build a stable fingerprint from device info
    const devInfo = await Device.getInfo();
    const fingerprint = [
      devInfo.model ?? "",
      devInfo.platform ?? "",
      devInfo.osVersion ?? "",
      devInfo.manufacturer ?? "",
      devInfo.name ?? "", // device name (not always available)
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

  // Last resort: use stored UUID (may break on reinstall, but better than nothing)
  const stored = await prefGet("device_uuid").catch(() => null);
  if (stored) return stored;

  // Generate a new UUID and store it
  const uuid =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);

  await prefSet("device_uuid", uuid).catch(() => {});
  return uuid;
};

// ── Grace period ───────────────────────────────────────────────────────────────
// BUG FIXED: new Date(null) === epoch, new Date(undefined) === Invalid Date.
// Guard both cases.
const isWithinGrace = async () => {
  try {
    const last = await prefGet("last_verified_at");
    if (!last) return false;
    const ts = new Date(last).getTime();
    if (isNaN(ts)) return false;
    const days = (Date.now() - ts) / 86400000;
    return days < GRACE_DAYS;
  } catch {
    return false;
  }
};

// ── Persist key to SQLite after DB is ready (called post-activation) ───────────
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
    console.warn(
      "[mobile-license] persistToSettings failed:",
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

    // BUG FIXED: non-200 responses were previously parsed as json and
    // silently returned ok:false with no error message surfaced.
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const reason = errJson?.error ?? `HTTP ${res.status}`;
      console.warn("[mobile-license] verify: server rejected:", reason);
      // Don't invalidate immediately on server errors — check grace first
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
    // Network failure — use grace period
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

    // BUG FIXED: previously any non-ok HTTP status still tried to parse json.ok
    // and returned a generic "Activation failed" with no server error message.
    const json = await res.json().catch(() => ({}));

    if (res.ok && json.ok) {
      await prefSet("license_key", key.trim());
      await prefSet("last_verified_at", new Date().toISOString());
      await persistToSettings(key.trim());
      return { ok: true };
    }

    // Surface the actual server error message to the UI
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
