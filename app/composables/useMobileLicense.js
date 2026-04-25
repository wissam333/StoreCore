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

// ── Clear stale license from storage ─────────────────────────────────────────
const clearStoredLicense = async () => {
  try {
    await prefRemove("license_key");
    await prefRemove("last_verified_at");
  } catch {}
};

// ── Persist key to SQLite settings (deferred, non-fatal) ─────────────────────
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
// TIMEOUT NOTE:
// The backend runs on Render's free tier which cold-starts in 50-90 seconds
// after inactivity. We use a 100-second timeout so a cold start doesn't look
// like a network failure and incorrectly expire the grace period.
// The loading message in app.vue ("Verifying license…") stays visible during
// this wait — the user sees progress, not a frozen screen.
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
      // 100s timeout — long enough to survive a Render cold start (50-90s)
      signal: AbortSignal.timeout(100_000),
    });

    if (res.ok) {
      const json = await res.json();
      if (json.ok) {
        await prefSet("last_verified_at", new Date().toISOString());
        return { ok: true };
      }
      await clearStoredLicense();
      return { ok: false, reason: "invalid", error: json.error };
    }

    // 4xx — invalid key, wrong device, not activated, expired
    const errJson = await res.json().catch(() => ({}));
    const reason = errJson?.reason ?? "invalid";
    const errorMsg = errJson?.error ?? `HTTP ${res.status}`;
    console.warn("[mobile-license] verify rejected:", res.status, errorMsg);
    await clearStoredLicense();
    return { ok: false, reason, error: errorMsg };
  } catch (err) {
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
      signal: AbortSignal.timeout(100_000),
    });

    const json = await res.json().catch(() => ({}));

    if (res.ok && json.ok) {
      await prefSet("license_key", key.trim());
      await prefSet("last_verified_at", new Date().toISOString());
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
      signal: AbortSignal.timeout(100_000),
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
