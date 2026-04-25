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

// Both checks must match the isElectron() helper in useMobileLicense so the
// two files agree on which environment they're in.
const isElectron =
  typeof window !== "undefined" && !!window.license && !!window.store;

const isCapacitor =
  typeof window !== "undefined" &&
  typeof Capacitor !== "undefined" &&
  Capacitor.isNativePlatform?.();

// ── DB init ───────────────────────────────────────────────────────────────
// Only ever called on Capacitor. Electron uses window.store (IPC to
// better-sqlite3 in main process) — calling initMobileSchema() there throws
// "SQLite only available on native platforms".
const initDb = async () => {
  if (!isCapacitor) {
    console.warn("[app.vue] initDb called outside Capacitor — skipped.");
    return;
  }
  const { initMobileSchema } = await import("~/composables/useMobileSchema");
  await initMobileSchema();
};

// Called by MobileLicensePage after a successful mobile activation.
// At this point the DB doesn't exist yet (license gate runs before DB init),
// so we init it now that the license is confirmed valid.
// This is only ever reached on Capacitor — Electron uses window.license.onActivated()
// which sends IPC to main, which closes the license window and opens the main window.
const onLicenseActivated = async () => {
  phase.value = "loading";
  try {
    await initDb(); // safe: guarded inside initDb for non-Capacitor
    phase.value = "app";
  } catch (err) {
    error.value = err.message || "Failed to initialize database";
    phase.value = "error";
  }
};

const init = async () => {
  phase.value = "loading";
  error.value = "";

  try {
    // ── Electron ───────────────────────────────────────────────────────────
    // window.store = IPC bridge to better-sqlite3 in main process.
    // window.license = IPC bridge to licenseManager.js in main process.
    // The main process already verified the license before creating this
    // window (or created the license window instead). So here we just check
    // whether a key is saved — if yes, go straight to app. Never call initDb.
    if (isElectron) {
      const key = await window.license.getKey();
      phase.value = key ? "app" : "license";
      return;
    }

    // ── Capacitor (mobile) ─────────────────────────────────────────────────
    if (isCapacitor) {
      // Step 1: License check using Capacitor Preferences only — no SQLite.
      // Wrapped in its own try/catch so any composable-level crash (e.g.
      // Preferences plugin not ready) shows the license screen rather than
      // falling through to phase='app' and bypassing the gate entirely.
      let result;
      try {
        const { verify } = useMobileLicense();
        result = await verify();
      } catch (licErr) {
        console.error("[app.vue] License verify threw:", licErr);
        // Treat verify errors as "no license" — safer than granting access
        result = { ok: false, reason: "verify_error" };
      }

      if (!result.ok) {
        phase.value = "license";
        return;
      }

      // Step 2: License confirmed — now safe to init SQLite.
      await initDb();
      phase.value = "app";
      return;
    }

    // ── Web / SSR fallback ─────────────────────────────────────────────────
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
