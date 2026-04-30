<!-- store-app/app.vue -->
<template>
  <div>
    <template v-if="phase === 'loading'">
      <div class="app-loading">
        <Icon name="mdi:loading" size="32" class="spin" />
        <p class="loading-text">{{ loadingMsg || $t("loading") }}</p>
      </div>
    </template>

    <template v-else-if="phase === 'error'">
      <div class="app-loading">
        <Icon name="mdi:alert-circle-outline" size="32" class="error-icon" />
        <p class="error-text">{{ error }}</p>
        <button class="retry-btn" @click="init">{{ $t("retry") }}</button>
      </div>
    </template>

    <template v-else-if="phase === 'license'">
      <MobileLicensePage @activated="onLicenseActivated" />
    </template>

    <template v-else>
      <ElementsLoader />
      <NuxtLayout>
        <main id="main-content">
          <NuxtPage />
        </main>
      </NuxtLayout>
      <SharedUiFeedbackToast position="center" :duration="6000" />
    </template>
  </div>
</template>

<script setup>
const { t: $t } = useI18n();

const phase = ref("loading");
const error = ref("");
const loadingMsg = ref("");

// ── Environment detection ─────────────────────────────────────────────────────
//
// Capacitor's window.Capacitor is injected by the NATIVE LAYER — it cannot be
// faked by any JS bundle. We check it FIRST as the ground truth. Only after
// Capacitor confirms we are NOT on a native platform do we trust __ELECTRON__.
//
// Returns: 'electron' | 'native' | 'web'
const detectEnvironment = async () => {
  // Fast path — Capacitor bridge already registered synchronously
  if (window?.Capacitor?.isNativePlatform?.()) {
    return "native";
  }

  // Slow path — on some Android versions the bridge registers slightly
  // after the first JS tick. Poll for up to 1500ms before giving up.
  const nativeConfirmed = await new Promise((resolve) => {
    const MAX_WAIT = 1500;
    const INTERVAL = 60;
    let elapsed = 0;

    const timer = setInterval(async () => {
      elapsed += INTERVAL;
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (Capacitor.isNativePlatform()) {
          clearInterval(timer);
          resolve(true);
          return;
        }
      } catch {}
      if (elapsed >= MAX_WAIT) {
        clearInterval(timer);
        resolve(false);
      }
    }, INTERVAL);
  });

  if (nativeConfirmed) return "native";

  // Only check __ELECTRON__ AFTER Capacitor has confirmed we are not native.
  if (typeof window !== "undefined" && !!window.__ELECTRON__) {
    return "electron";
  }

  return "web";
};

// ── Read the stored license key directly from Preferences ────────────────────
// This is a fast local read — no network. Used to decide whether to show
// the license screen before the background verify() completes.
const getStoredKey = async () => {
  try {
    const { Preferences } = await import("@capacitor/preferences");
    const r = await Preferences.get({ key: "license_key" });
    return r?.value?.trim() ?? null;
  } catch {
    return null;
  }
};

// ── DB init ───────────────────────────────────────────────────────────────────
const initDb = async () => {
  const { initMobileSchema } = await import("~/composables/useMobileSchema");
  await initMobileSchema();
};

// ── Background verify — runs AFTER the app is already open ───────────────────
//
// KEY DESIGN:
// We do NOT block app startup on network verification. Render's free tier
// cold-starts in 50-90s, making a blocking verify feel completely broken.
//
// Instead:
//   1. If a license key exists in Preferences → open the app immediately.
//   2. Kick off verify() in the background (up to 100s timeout as before).
//   3. If verify() comes back invalid (4xx) → force back to license screen.
//   4. If verify() fails due to network/timeout → grace period logic in
//      useMobileLicense handles it (7-day grace offline).
//
// The user experience: app opens in ~2s instead of ~90s.
const runBackgroundVerify = async () => {
  try {
    // Background verify gets the long timeout for Render cold starts
    const key = await prefGet("license_key"); // reuse your getStoredKey()
    if (!key) return;

    const machine_id = await (async () => {
      try {
        const { useMobileLicense } = await import(
          "~/composables/useMobileLicense"
        );
        return await useMobileLicense().getMachineId();
      } catch {
        return "unknown";
      }
    })();

    const res = await fetch(`${LICENSE_SERVER}/license/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: key.trim(), machine_id, platform: "mobile" }),
      signal: AbortSignal.timeout(100_000), // 100s only in background
    });

    if (res.ok) {
      const json = await res.json();
      if (json.ok) {
        const { Preferences } = await import("@capacitor/preferences");
        await Preferences.set({
          key: "last_verified_at",
          value: new Date().toISOString(),
        });
        return;
      }
    }

    // Hard rejection from server
    const errJson = await res.json().catch(() => ({}));
    const reason = errJson?.reason ?? "invalid";
    if (reason !== "offline_grace_expired") {
      console.warn("[app] Background verify failed:", reason);
      try {
        const { resetMobileDb } = await import("~/composables/useMobileDb");
        resetMobileDb();
      } catch {}
      phase.value = "license";
    }
  } catch (err) {
    // Network failure in background — silently ignore, grace period covers it
    console.warn("[app] Background verify network error:", err?.message ?? err);
  }
};

// ── After activation ──────────────────────────────────────────────────────────
const onLicenseActivated = async () => {
  phase.value = "loading";
  loadingMsg.value = "Opening database…";
  error.value = "";
  try {
    await initDb();
    phase.value = "app";
  } catch (err) {
    error.value = `Database error: ${err?.message ?? err}`;
    phase.value = "error";
  } finally {
    loadingMsg.value = "";
  }
};

// ── Bootstrap ─────────────────────────────────────────────────────────────────
const init = async () => {
  phase.value = "loading";
  error.value = "";
  loadingMsg.value = "";

  try {
    const env = await detectEnvironment();
    console.log("[app] environment:", env);

    if (env === "electron" || env === "web") {
      loadingMsg.value = "Opening database…";
      await initDb();
      phase.value = "app";
      loadingMsg.value = "";
      return;
    }

    // env === 'native'
    const storedKey = await getStoredKey();

    if (!storedKey) {
      // No key — show license screen, reset DB only now
      try {
        const { resetMobileDb } = await import("~/composables/useMobileDb");
        resetMobileDb();
      } catch {}
      phase.value = "license";
      loadingMsg.value = "";
      return;
    }

    // Key exists → open app immediately, verify in background
    loadingMsg.value = "Opening database…";
    await initDb();
    phase.value = "app";
    loadingMsg.value = "";

    runBackgroundVerify(); // fire-and-forget
  } catch (err) {
    error.value = err?.message || "Failed to initialize. Tap to retry.";
    phase.value = "error";
    loadingMsg.value = "";
  }
};

onMounted(() => {
  init();

  document.addEventListener("pause", async () => {
    try {
      const { flushMobileDb } = await import("~/composables/useMobileDb");
      await flushMobileDb();
    } catch {}
  });
});
</script>

<style scoped>
.app-loading {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--bg-page, #f1f5f9);
  gap: 1rem;
}
.spin {
  animation: spin 0.9s linear infinite;
  color: var(--primary, #2563eb);
}
.error-icon {
  color: #ef4444;
}
.loading-text {
  color: var(--text-muted);
  font-size: 0.875rem;
}
.error-text {
  color: #ef4444;
  font-size: 0.875rem;
  text-align: center;
  padding: 0 2rem;
  max-width: 320px;
  line-height: 1.5;
}
.retry-btn {
  padding: 0.5rem 1.5rem;
  border-radius: 8px;
  border: none;
  background: var(--primary);
  color: white;
  font-weight: 600;
  cursor: pointer;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
