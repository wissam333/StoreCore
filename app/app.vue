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

// ── Electron detection ────────────────────────────────────────────────────────
// Only trust the explicit flag injected by the preload script.
const isElectronEnv = () =>
  typeof window !== "undefined" && !!window.__ELECTRON__;

// ── Bulletproof Capacitor / native-mobile detection ──────────────────────────
//
// WHY THIS EXISTS:
// Capacitor.isNativePlatform() can return false at onMounted time on
// Android/iOS because the native bridge registers asynchronously.
// A one-shot call is not reliable. We must poll until the bridge is ready
// or give up after a short timeout and assume web.
//
// Strategy:
//  1. Check immediately — if true, we're done.
//  2. If false, poll every 80ms for up to 2 seconds.
//  3. If still false after 2s, we are genuinely on the web → skip license.
//
const waitForNativePlatform = () =>
  new Promise((resolve) => {
    // Avoid importing Capacitor in non-Capacitor builds
    let Capacitor;
    try {
      // Dynamic import is async, but the module is already bundled by
      // Capacitor's build — require() is safe here as a sync check.
      // We fall back to the async path if it isn't available.
      Capacitor = window?.Capacitor;
    } catch {}

    // Fast path: Capacitor global available synchronously
    if (Capacitor?.isNativePlatform?.()) {
      return resolve(true);
    }

    // Slow path: poll for up to 2 000ms in 80ms increments
    const MAX_WAIT = 2000;
    const INTERVAL = 80;
    let elapsed = 0;

    const timer = setInterval(async () => {
      elapsed += INTERVAL;

      try {
        // Try the proper async import on every tick in case the module
        // just became available
        const { Capacitor: Cap } = await import("@capacitor/core");
        if (Cap.isNativePlatform()) {
          clearInterval(timer);
          return resolve(true);
        }
      } catch {
        // Module not available — keep waiting
      }

      if (elapsed >= MAX_WAIT) {
        clearInterval(timer);
        resolve(false); // Give up — treat as web
      }
    }, INTERVAL);
  });

// ── License check ─────────────────────────────────────────────────────────────
const checkLicense = async () => {
  try {
    const { verify } = useMobileLicense();
    const result = await verify();
    return result.ok;
  } catch (err) {
    // verify() threw — treat as unlicensed so the license screen appears.
    // This is safer than granting access on an unknown error.
    console.warn("[app] checkLicense threw:", err?.message ?? err);
    return false;
  }
};

// ── DB init ───────────────────────────────────────────────────────────────────
const initDb = async () => {
  const { initMobileSchema } = await import("~/composables/useMobileSchema");
  await initMobileSchema();
};

// ── After activation ──────────────────────────────────────────────────────────
const onLicenseActivated = async () => {
  phase.value = "loading";
  loadingMsg.value = $t("loading"); // "Opening database…" etc.
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
    // ── Electron: skip all mobile logic ──────────────────────────────────────
    if (isElectronEnv()) {
      phase.value = "app";
      return;
    }

    // ── Native mobile detection (waits for bridge to register) ───────────────
    loadingMsg.value = $t("loading");
    const isNative = await waitForNativePlatform();

    if (!isNative) {
      // Running in a browser — no license required
      phase.value = "app";
      return;
    }

    // ── We are on a real native device — reset any stale DB state ────────────
    // (safe to do here because we haven't opened the DB yet)
    try {
      const { resetMobileDb } = await import("~/composables/useMobileDb");
      resetMobileDb();
    } catch {}

    // ── Step 1: verify license ────────────────────────────────────────────────
    loadingMsg.value = "Verifying license…";
    const licensed = await checkLicense();

    if (!licensed) {
      // No key, invalid key, or grace period expired → show license screen
      phase.value = "license";
      loadingMsg.value = "";
      return;
    }

    // ── Step 2: open / migrate DB ─────────────────────────────────────────────
    loadingMsg.value = "Opening database…";
    await initDb();

    phase.value = "app";
    loadingMsg.value = "";
  } catch (err) {
    error.value = err?.message || "Failed to initialize. Tap to retry.";
    phase.value = "error";
    loadingMsg.value = "";
  }
};

onMounted(() => {
  init();

  // Flush DB to Preferences when app goes to background
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
