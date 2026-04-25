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

const isElectronEnv = () =>
  typeof window !== "undefined" && !!window.license && !!window.store;

const isNativeMobile = async () => {
  if (isElectronEnv()) return false;
  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

// ── License check ─────────────────────────────────────────────────────────────
// Uses useMobileLicense().verify() which checks:
//   1. Is there a key in Preferences? No → show license screen
//   2. Is the key valid on the server? No → show license screen
//   3. Server offline but within grace period? → allow (offline mode)
//   4. Server offline, no grace period? → show license screen
// This cannot be bypassed by a stale key sitting in Preferences.
const checkLicense = async () => {
  const { verify } = useMobileLicense();
  const result = await verify();
  return result.ok;
};

// ── DB init ───────────────────────────────────────────────────────────────────
const initDb = async () => {
  const { initMobileSchema } = await import("~/composables/useMobileSchema");
  await initMobileSchema();
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
    const { resetMobileDb } = await import("~/composables/useMobileDb");
    resetMobileDb();
  } catch {}

  try {
    if (isElectronEnv()) {
      phase.value = "app";
      return;
    }

    if (await isNativeMobile()) {
      // Step 1: verify license (server check + grace period fallback)
      loadingMsg.value = "Verifying license…";
      const licensed = await checkLicense();

      if (!licensed) {
        phase.value = "license";
        loadingMsg.value = "";
        return;
      }

      // Step 2: open DB
      loadingMsg.value = "Opening database…";
      await initDb();

      phase.value = "app";
      loadingMsg.value = "";
      return;
    }

    phase.value = "app";
  } catch (err) {
    error.value = err?.message || "Failed to initialize. Tap to retry.";
    phase.value = "error";
    loadingMsg.value = "";
  }
};

onMounted(() => {
  init();

  // Save DB when app goes to background
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
