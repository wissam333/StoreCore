<!-- store-app/app.vue -->
<!--
  KEY CHANGE: Mobile license check now uses useLicenseGuard().check()
  (Preferences-only, no network, instant) instead of useMobileLicense().verify()
  (hits the server, can hang/timeout on slow connections).

  Boot sequence on mobile:
    1. useLicenseGuard().check() — reads Preferences, returns in <50ms
    2a. No local key → phase='license' (DB never touched)
    2b. Local key found → getMobileDb() → initMobileSchema() → phase='app'
    3. Background: server verify runs silently after app is open (not blocking)

  This means:
    - First install (no key): shows license screen instantly
    - Licensed device: opens app without any network call
    - Expired server / offline: still opens app within grace period
    - DB error: shows error screen with retry button
-->
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

const initDb = async () => {
  const { initMobileSchema } = await import("~/composables/useMobileSchema");
  await initMobileSchema();
};

// ── Background server verify (non-blocking, called after app is open) ─────────
const backgroundVerify = () => {
  setTimeout(async () => {
    try {
      const { verify } = useMobileLicense();
      const result = await verify();
      if (!result.ok && result.reason !== "offline_grace_expired") {
        // License genuinely invalid (not just offline) — force re-license screen
        // Only do this if the reason is hard-invalid, not a network issue
        if (result.reason === "invalid" || result.reason === "no_license") {
          phase.value = "license";
        }
      }
    } catch {
      // Background verify failure is never fatal
    }
  }, 3000); // 3s after app opens — well after UI is rendered
};

// ── After license activation ───────────────────────────────────────────────────
const onLicenseActivated = async () => {
  phase.value = "loading";
  loadingMsg.value = "Opening database…";
  error.value = "";
  try {
    await initDb();
    phase.value = "app";
    backgroundVerify();
  } catch (err) {
    console.error("[app.vue] initDb after activation failed:", err);
    error.value = `Database error: ${err?.message ?? err}`;
    phase.value = "error";
  } finally {
    loadingMsg.value = "";
  }
};

// ── Bootstrap ──────────────────────────────────────────────────────────────────
const init = async () => {
  phase.value = "loading";
  error.value = "";
  loadingMsg.value = "";

  // Reset DB singleton on every retry
  try {
    const { resetMobileDb } = await import("~/composables/useMobileDb");
    resetMobileDb();
  } catch {
    // Not available on Electron/web
  }

  try {
    // ── Electron ─────────────────────────────────────────────────────────────
    if (isElectronEnv()) {
      phase.value = "app";
      return;
    }

    // ── Capacitor (Android / iOS) ─────────────────────────────────────────────
    if (await isNativeMobile()) {
      // Step 1: License check — LOCAL ONLY, no network, instant
      // useLicenseGuard just reads Capacitor Preferences — cannot hang
      loadingMsg.value = "Checking license…";
      const { useLicenseGuard } = await import("~/composables/useLicenseGuard");
      const { licensed } = await useLicenseGuard().check();

      if (!licensed) {
        phase.value = "license";
        loadingMsg.value = "";
        return;
      }

      // Step 2: Open DB
      loadingMsg.value = "Opening database…";
      try {
        await initDb();
      } catch (dbErr) {
        console.error("[app.vue] initDb failed:", dbErr);
        error.value = `Database error: ${dbErr?.message ?? dbErr}`;
        phase.value = "error";
        loadingMsg.value = "";
        return;
      }

      phase.value = "app";
      loadingMsg.value = "";

      // Step 3: Verify with server in background (non-blocking)
      backgroundVerify();
      return;
    }

    // ── Web / SSR fallback ────────────────────────────────────────────────────
    phase.value = "app";
  } catch (err) {
    console.error("[app.vue] init failed:", err);
    error.value = err?.message || "Failed to initialize. Tap to retry.";
    phase.value = "error";
    loadingMsg.value = "";
  }
};

onMounted(() => init());
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
