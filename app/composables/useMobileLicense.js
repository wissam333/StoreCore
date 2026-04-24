// store-app/composables/useMobileLicense.js
import { Preferences } from "@capacitor/preferences";
import { Device } from "@capacitor/device";

const LICENSE_SERVER = "https://storecore-backend.onrender.com";
const GRACE_DAYS = 7;

export const useMobileLicense = () => {
  // ── Stable device ID ───────────────────────────────────────────────────────
  const getDeviceId = async () => {
    try {
      const info = await Device.getId();
      if (info?.identifier && info.identifier !== "web") {
        return info.identifier;
      }
    } catch {}

    // Fallback for simulators / web preview
    const { value } = await Preferences.get({ key: "device_uuid" });
    if (value) return value;

    const uuid =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
    await Preferences.set({ key: "device_uuid", value: uuid });
    return uuid;
  };

  // ── Grace period ──────────────────────────────────────────────────────────
  const isWithinGrace = async () => {
    try {
      const { value: last } = await Preferences.get({
        key: "last_verified_at",
      });
      if (!last) return false;
      const days =
        (Date.now() - new Date(last).getTime()) / (1000 * 60 * 60 * 24);
      return days < GRACE_DAYS;
    } catch {
      return false;
    }
  };

  // ── Persist to SQLite settings (lazy import to avoid composable issues) ────
const persistToSettings = async (key) => {
  try {
    // Lazy import to avoid composable context issues
    const { useMobileStore } = await import('./useMobileStore');
    const { setSetting, getSettings } = useMobileStore();
    await setSetting({ key: "license_key", value: key });

    const r = await getSettings();
    if (r.ok && !r.data?.sync_base?.trim()) {
      await setSetting({ key: "sync_base", value: LICENSE_SERVER });
    }
  } catch (err) {
    console.warn("[mobile-license] Could not persist to SQLite:", err);
  }
};

  const removeFromSettings = async () => {
    try {
      const { setSetting } = useMobileStore();
      await setSetting({ key: "license_key", value: "" });
    } catch {}
  };

  // ── Activate ─────────────────────────────────────────────────────────────
  const activate = async (key) => {
    const machine_id = await getDeviceId();
    try {
      const res = await fetch(`${LICENSE_SERVER}/license/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, machine_id, platform: "mobile" }),
        signal: AbortSignal.timeout(8000),
      });
      const json = await res.json();
      if (json.ok) {
        await Preferences.set({ key: "license_key", value: key });
        await Preferences.set({
          key: "last_verified_at",
          value: new Date().toISOString(),
        });
        await persistToSettings(key);
        return { ok: true };
      }
      return { ok: false, error: json.error ?? "Activation failed" };
    } catch {
      return { ok: false, error: "Cannot reach license server" };
    }
  };

  // ── Verify ────────────────────────────────────────────────────────────────
  const verify = async () => {
    let key = null;
    try {
      const pref = await Preferences.get({ key: "license_key" });
      key = pref?.value ?? null;
    } catch {
      return { ok: false, reason: "no_license" };
    }

    if (!key) return { ok: false, reason: "no_license" };

    const machine_id = await getDeviceId();

    try {
      const res = await fetch(`${LICENSE_SERVER}/license/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, machine_id, platform: "mobile" }),
        signal: AbortSignal.timeout(8000),
      });
      const json = await res.json();
      if (json.ok) {
        await Preferences.set({
          key: "last_verified_at",
          value: new Date().toISOString(),
        });
        return { ok: true };
      }
      return { ok: false, reason: "invalid", error: json.error };
    } catch {
      const grace = await isWithinGrace();
      if (grace) return { ok: true, offline: true };
      return { ok: false, reason: "offline_grace_expired" };
    }
  };

  // ── Deactivate ────────────────────────────────────────────────────────────
  const deactivate = async () => {
    let key = null;
    try {
      const pref = await Preferences.get({ key: "license_key" });
      key = pref?.value ?? null;
    } catch {}

    if (!key) return { ok: false, error: "No license found" };

    const machine_id = await getDeviceId();
    try {
      const res = await fetch(`${LICENSE_SERVER}/license/deactivate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, machine_id, platform: "mobile" }),
        signal: AbortSignal.timeout(8000),
      });
      const json = await res.json();
      if (json.ok) {
        await Preferences.remove({ key: "license_key" });
        await Preferences.remove({ key: "last_verified_at" });
        await removeFromSettings();
        return { ok: true };
      }
      return { ok: false, error: json.error };
    } catch {
      return { ok: false, error: "Cannot reach license server" };
    }
  };

  const getKey = async () => {
    const { value } = await Preferences.get({ key: "license_key" });
    return value ?? null;
  };

  return { verify, activate, deactivate, getKey, getMachineId: getDeviceId };
};
