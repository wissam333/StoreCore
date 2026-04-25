// store-app/composables/useLicenseGuard.js
//
// Single source of truth for "does this device have a valid license?"
// Used by app.vue on mobile. Separated from useMobileLicense so it can
// be tested independently and has its own fallback chain.
//
// Strategy:
//   1. Check Capacitor Preferences for a saved key (fast, offline-safe)
//   2. If key exists → show app (verify happens in background later)
//   3. If no key → show license input
//
// We do NOT block on server verification at startup — that's done
// separately after the app is open. This prevents network delays from
// showing the license screen on every launch.

const prefGet = async (key) => {
  try {
    const { Preferences } = await import("@capacitor/preferences");
    const result = await Preferences.get({ key });
    return result?.value ?? null;
  } catch {
    return null;
  }
};

export const useLicenseGuard = () => {
  /**
   * Returns true if a license key is stored locally.
   * Does NOT verify with the server — just checks local storage.
   * Fast and works offline.
   */
  const hasLocalKey = async () => {
    try {
      const key = await prefGet("license_key");
      return !!(key && key.trim().length > 0);
    } catch {
      return false;
    }
  };

  /**
   * Full check: local key + optional background server verify.
   * Returns { licensed: boolean, key: string|null }
   */
  const check = async () => {
    try {
      const key = await prefGet("license_key");
      if (!key || !key.trim()) {
        return { licensed: false, key: null };
      }
      return { licensed: true, key: key.trim() };
    } catch {
      return { licensed: false, key: null };
    }
  };

  return { hasLocalKey, check };
};
