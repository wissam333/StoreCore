// store-app/composables/useMobileLicense.js
//
// FIX SUMMARY
// ──────────────────────────────────────────────────────────────────────────────
// Bug 1 — Device ID changes on reinstall:
//   crypto.randomUUID() stored in Capacitor Preferences is wiped on uninstall.
//   Fix: use @capacitor/device DeviceId which is hardware-level (IDFV on iOS,
//   Android ID on Android) and survives reinstalls. Falls back to a stored UUID
//   only if the hardware ID is unavailable (simulator / web preview).
//
// Bug 2 — App opens without license screen:
//   initMobileSchema() could throw before verify() was called, silently skipping
//   the license check. Also verify() falls through to ok=true when offline AND
//   no key is stored. Fixed by making the entire flow fault-tolerant with explicit
//   error handling, and by checking key existence before grace-period fallback.
//
// Bug 3 — "Not activated on this platform" after re-install:
//   The server auth middleware requires machine_id_desktop OR machine_id_mobile.
//   After deactivation both are NULL so sync fails even after re-activation.
//   Fixed in server.js — the auth check now only verifies the key is active +
//   not expired. The machine_id check only happens at /license/verify.

import { Preferences } from "@capacitor/preferences";
import { Device } from "@capacitor/device";

const LICENSE_SERVER = "https://storecore-backend.onrender.com";
const GRACE_DAYS = 7;

export const useMobileLicense = () => {
  // ── Stable device ID ───────────────────────────────────────────────────────
  // @capacitor/device returns the hardware identifier which persists across
  // app reinstalls (iOS IDFV, Android ID).
  // Falls back to a Preferences-stored UUID for simulators / web.
  const getDeviceId = async () => {
    try {
      const info = await Device.getId();
      // info.identifier is available on native platforms
      if (info?.identifier && info.identifier !== "web") {
        return info.identifier;
      }
    } catch {
      // Device plugin unavailable (web preview / older Capacitor version)
    }

    // Fallback: use a stored UUID — better than nothing for development
    const { value } = await Preferences.get({ key: "device_uuid" });
    if (value) return value;

    // First time fallback — generate and persist
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

  // ── Activate ─────────────────────────────────────────────────────────────
  const activate = async (key) => {
    const machine_id = await getDeviceId();
    try {
      const res = await fetch(`${LICENSE_SERVER}/license/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, machine_id, platform: "mobile" }),
      });
      const json = await res.json();
      if (json.ok) {
        // Persist to Preferences for offline/grace use
        await Preferences.set({ key: "license_key", value: key });
        await Preferences.set({
          key: "last_verified_at",
          value: new Date().toISOString(),
        });

        // Also write into SQLite settings so useStoreSync picks it up
        // without any manual token entry in Settings page
        try {
          const { setSetting, getSettings } = useMobileStore();
          await setSetting({ key: "license_key", value: key });

          // Auto-populate sync_base from the license server URL if not set
          const r = await getSettings();
          if (r.ok && !r.data?.sync_base?.trim()) {
            await setSetting({ key: "sync_base", value: LICENSE_SERVER });
          }
        } catch (dbErr) {
          console.warn(
            "[mobile-license] Could not persist key to SQLite:",
            dbErr,
          );
        }

        return { ok: true };
      }
      return { ok: false, error: json.error ?? "Activation failed" };
    } catch (err) {
      return { ok: false, error: "Cannot reach license server" };
    }
  };

  // ── Verify ────────────────────────────────────────────────────────────────
  // Called on every app start. Returns { ok: true } to allow entry.
  const verify = async () => {
    let key = null;
    try {
      const pref = await Preferences.get({ key: "license_key" });
      key = pref?.value ?? null;
    } catch {
      // Preferences unavailable — treat as no license
      return { ok: false, reason: "no_license" };
    }

    // No key stored at all — must activate
    if (!key) return { ok: false, reason: "no_license" };

    const machine_id = await getDeviceId();

    try {
      const res = await fetch(`${LICENSE_SERVER}/license/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, machine_id, platform: "mobile" }),
        // 8-second timeout so a slow server doesn't block app startup
        signal: AbortSignal.timeout(8000),
      });
      const json = await res.json();
      if (json.ok) {
        // Update last-verified timestamp
        await Preferences.set({
          key: "last_verified_at",
          value: new Date().toISOString(),
        });
        return { ok: true };
      }
      // Server rejected the key — don't fall back to grace, the key is invalid
      return { ok: false, reason: "invalid", error: json.error };
    } catch {
      // Network error / timeout — allow offline grace period
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
      });
      const json = await res.json();
      if (json.ok) {
        await Preferences.remove({ key: "license_key" });
        await Preferences.remove({ key: "last_verified_at" });

        // Remove from SQLite too
        try {
          const { setSetting } = useMobileStore();
          await setSetting({ key: "license_key", value: "" });
        } catch {}

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
  const getMachineId = () => getDeviceId();

  return { verify, activate, deactivate, getKey, getMachineId };
};
