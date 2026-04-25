<!-- store-app/app.vue -->
<template>
  <div>
    <!-- Loading -->
    <template v-if="phase === 'loading'">
      <div class="app-loading">
        <Icon name="mdi:loading" size="32" class="spin" />
        <p class="loading-text">{{ $t("loading") }}</p>
      </div>
    </template>

    <!-- Error state -->
    <template v-else-if="phase === 'error'">
      <div class="app-loading">
        <Icon name="mdi:alert-circle-outline" size="32" class="error-icon" />
        <p class="error-text">{{ error }}</p>
        <button class="retry-btn" @click="init">{{ $t("retry") }}</button>
      </div>
    </template>

    <!-- License screen — rendered directly, no router needed -->
    <template v-else-if="phase === 'license'">
      <MobileLicensePage @activated="onLicenseActivated" />
    </template>

    <!-- Full app -->
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

const phase = ref("loading"); // 'loading' | 'error' | 'license' | 'app'
const error = ref("");

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANT: Never evaluate isElectron / isCapacitor at module scope.
//
// On Android the Capacitor WebView bridge (window.Capacitor) is injected
// AFTER the JS bundle is parsed. Checking it during <script setup> evaluation
// always returns undefined → isCapacitor = false → license gate is skipped.
//
// Always call getEnv() inside functions that run after onMounted.
// ─────────────────────────────────────────────────────────────────────────────
const getEnv = () => {
  const isElectron =
    typeof window !== "undefined" && !!window.license && !!window.store;

  const isCapacitor =
    !isElectron &&
    typeof window !== "undefined" &&
    typeof Capacitor !== "undefined" &&
    Capacitor.isNativePlatform?.() === true;

  return { isElectron, isCapacitor };
};

// ── DB init ───────────────────────────────────────────────────────────────────
// Only safe to call on Capacitor. Electron uses window.store (IPC bridge to
// better-sqlite3 in main process) — getMobileDb() throws on Electron because
// Capacitor.isNativePlatform() is false there.
const initDb = async () => {
  const { initMobileSchema } = await import("~/composables/useMobileSchema");
  await initMobileSchema();
};

// ── Called by MobileLicensePage after successful activation ───────────────────
// Must re-check environment here — onLicenseActivated is also reachable on
// Electron (the license phase renders MobileLicensePage on both platforms).
// Electron does NOT need initDb: the main process owns better-sqlite3.
const onLicenseActivated = async () => {
  phase.value = "loading";
  const { isCapacitor } = getEnv();
  try {
    if (isCapacitor) {
      await initDb();
    }
    phase.value = "app";
  } catch (err) {
    error.value = err.message || "Failed to initialize database";
    phase.value = "error";
  }
};

// ── Main init ─────────────────────────────────────────────────────────────────
const init = async () => {
  phase.value = "loading";
  error.value = "";

  try {
    // Always detect inside init() — Capacitor bridge is ready by onMounted
    const { isElectron, isCapacitor } = getEnv();

    // ── Electron ────────────────────────────────────────────────────────────
    // Main process verified the license before opening this window.
    // Just check if a saved key exists. Never call initDb().
    if (isElectron) {
      const key = await window.license.getKey();
      phase.value = key ? "app" : "license";
      return;
    }

    // ── Capacitor (mobile) ──────────────────────────────────────────────────
    if (isCapacitor) {
      // Step 1: verify via Capacitor Preferences only — no SQLite yet
      let result;
      try {
        const { verify } = useMobileLicense();
        result = await verify();
      } catch (licErr) {
        console.error("[app.vue] License verify threw:", licErr);
        result = { ok: false, reason: "verify_error" }; // fail closed
      }

      if (!result.ok) {
        phase.value = "license";
        return;
      }

      // Step 2: license confirmed — safe to init SQLite
      await initDb();
      phase.value = "app";
      return;
    }

    // ── Web / SSR fallback ──────────────────────────────────────────────────
    phase.value = "app";
  } catch (err) {
    console.error("[app.vue] Init failed:", err);
    error.value = err.message || "Failed to initialize";
    phase.value = "error";
  }
};

onMounted(() => {
  init();
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
  max-width: 300px;
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
