import { Preferences } from "@capacitor/preferences";

const LICENSE_SERVER = "https://storecore-backend.onrender.com";
const GRACE_DAYS = 7;

export const useMobileLicense = () => {
  const getDeviceId = async () => {
    const { value } = await Preferences.get({ key: "device_uuid" });
    if (value) return value;
    const uuid = crypto.randomUUID();
    await Preferences.set({ key: "device_uuid", value: uuid });
    return uuid;
  };

  const isWithinGrace = async () => {
    const { value: last } = await Preferences.get({ key: "last_verified_at" });
    if (!last) return false;
    const days =
      (Date.now() - new Date(last).getTime()) / (1000 * 60 * 60 * 24);
    return days < GRACE_DAYS;
  };

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
        // 1. Save to Capacitor Preferences (grace period / offline use)
        await Preferences.set({ key: "license_key", value: key });
        await Preferences.set({
          key: "last_verified_at",
          value: new Date().toISOString(),
        });

        // 2. Also persist into SQLite settings so useStoreSync can read it
        //    without any manual token entry in Settings page
        try {
          const { setSetting, getSettings } = useMobileStore();
          await setSetting({ key: "license_key", value: key });

          // Auto-set sync_base if not already configured
          const r = await getSettings();
          if (!r.data?.sync_base?.trim()) {
            await setSetting({ key: "sync_base", value: LICENSE_SERVER });
          }
        } catch (dbErr) {
          console.warn("[license] Could not persist key to SQLite:", dbErr);
        }

        return { ok: true };
      }
      return { ok: false, error: json.error };
    } catch {
      return { ok: false, error: "Cannot reach license server" };
    }
  };

  const verify = async () => {
    const { value: key } = await Preferences.get({ key: "license_key" });
    if (!key) return { ok: false, reason: "no_license" };
    const machine_id = await getDeviceId();
    try {
      const res = await fetch(`${LICENSE_SERVER}/license/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, machine_id, platform: "mobile" }),
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
      return grace
        ? { ok: true, offline: true }
        : { ok: false, reason: "offline_grace_expired" };
    }
  };

  const getKey = async () => {
    const { value } = await Preferences.get({ key: "license_key" });
    return value ?? null;
  };

  const getMachineId = () => getDeviceId();

  return { verify, activate, getKey, getMachineId };
};
