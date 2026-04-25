// store-app/composables/useMobileLicense.js

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
    for (let i = 0; i < str.length; i++)
      h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
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

// ── Grace period ──────────────────────────────────────────────────────────────
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

// ── Clear stale license data from storage ─────────────────────────────────────
// Called when the server tells us this key is no longer valid for this device.
// Clears the key so the license screen appears on next launch too.
const clearStoredLicense = async () => {
  try {
    await prefRemove("license_key");
    await prefRemove("last_verified_at");
  } catch {}
};

// ── Persist activated key to SQLite settings ──────────────────────────────────
const persistToSettings = async (key) => {
  try {
    const { useMobileStore } = await import("./useMobileStore");
    const { setSetting, getSettings } = useMobileStore();
    await setSetting({ key: "license_key", value: key });
    const r = await getSettings();
    if (r.ok && !r.data?.sync_base?.trim())
      await setSetting({ key: "sync_base", value: LICENSE_SERVER });
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

// ── Verify ────────────────────────────────────────────────────────────────────
//
// FIX: previously trusted ok:true from the server even when bound:false,
// meaning an unactivated license key sitting in Preferences would silently
// pass and open the app.
//
// NEW BEHAVIOUR:
//  - No key in storage              → show license screen (no_license)
//  - Server returns 4xx             → clear stale key, show license screen
//  - Server returns ok:true         → verified, open app
//  - Server unreachable + grace     → allow offline (grace period)
//  - Server unreachable, no grace   → show license screen
const verify = async () => {
  let key = null;
  try {
    key = await prefGet("license_key");
  } catch (err) {
    console.warn("[mobile-license] verify: prefGet threw:", err?.message);
    return { ok: false, reason: "no_license" };
  }

  // No key stored at all → must activate
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

    if (res.ok) {
      const json = await res.json();
      if (json.ok) {
        // Confirmed valid and bound to this device
        await prefSet("last_verified_at", new Date().toISOString());
        return { ok: true };
      }
      // Server said ok:false despite 200 — treat as invalid
      await clearStoredLicense();
      return { ok: false, reason: "invalid", error: json.error };
    }

    // 4xx — key is invalid, wrong device, not activated, or expired
    // Clear the stale key so the license screen appears on next launch too
    const errJson = await res.json().catch(() => ({}));
    const reason = errJson?.reason ?? "invalid";
    const errorMsg = errJson?.error ?? `HTTP ${res.status}`;
    console.warn("[mobile-license] verify rejected:", res.status, errorMsg);

    await clearStoredLicense();
    return { ok: false, reason, error: errorMsg };
  } catch (err) {
    // Network error — apply grace period
    console.warn("[mobile-license] verify: network error:", err?.message);
    const grace = await isWithinGrace();
    if (grace) return { ok: true, offline: true };
    return { ok: false, reason: "offline_grace_expired" };
  }
};

// ── Activate ──────────────────────────────────────────────────────────────────
const activate = async (key) => {
  if (!key || !key.trim())
    return { ok: false, error: "License key cannot be empty" };

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

      // Deferred so it runs after app.vue calls initDb()
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

// ── Deactivate ────────────────────────────────────────────────────────────────
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
