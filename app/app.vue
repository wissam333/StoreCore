<!-- store-app/app.vue -->
<!--
  FIX: Previous version could hang on infinite "loading" if any await in the
  init chain threw but was caught at a higher level without transitioning phase.
  Now every await has explicit try/catch that transitions to 'error' with a
  visible message. The loading screen can no longer get stuck silently.

  Also removed nextTick() deferral from initDb() — it wasn't solving anything
  and added confusion. The real fix (per useMobileDb.js) is the 300ms Android
  delay inside getMobileDb() itself, which is closer to the actual problem.

  Sequence on mobile:
    1. onMounted → init()
    2. verify() — Preferences only, no DB, fast
    3. If licensed → getMobileDb() → opens DB → initMobileSchema() → phase='app'
    4. If not licensed → phase='license' (DB never touched until activation)
    5. After activation → onLicenseActivated() → initDb() → phase='app'
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

// ── DB init ────────────────────────────────────────────────────────────────────
const initDb = async () => {
  const { initMobileSchema } = await import("~/composables/useMobileSchema");
  await initMobileSchema();
};

// ── After license activation ───────────────────────────────────────────────────
const onLicenseActivated = async () => {
  phase.value = "loading";
  loadingMsg.value = "Opening database…";
  error.value = "";
  try {
    await initDb();
    phase.value = "app";
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

  // Reset DB singleton on retry so getMobileDb() starts fresh
  try {
    const { resetMobileDb } = await import("~/composables/useMobileDb");
    resetMobileDb();
  } catch {
    // Not available on Electron/web — ignore
  }

  try {
    // ── Electron ────────────────────────────────────────────────────────────
    if (isElectronEnv()) {
      phase.value = "app";
      return;
    }

    // ── Capacitor (Android / iOS) ────────────────────────────────────────────
    if (await isNativeMobile()) {
      // Step 1: License check (Preferences only — DB not needed)
      loadingMsg.value = "Checking license…";
      let licenseResult;
      try {
        const { verify } = useMobileLicense();
        licenseResult = await verify();
      } catch (licErr) {
        console.error("[app.vue] verify threw:", licErr);
        licenseResult = { ok: false, reason: "verify_error" };
      }

      if (!licenseResult.ok) {
        // No valid license — show activation screen, do NOT open DB yet
        phase.value = "license";
        loadingMsg.value = "";
        return;
      }

      // Step 2: Open DB (now safe — license confirmed)
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
      return;
    }

    // ── Web / SSR fallback ───────────────────────────────────────────────────
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
