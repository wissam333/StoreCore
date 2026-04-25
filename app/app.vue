<!-- store-app/app.vue -->
<!--
  FIX: Electron branch is now simple again. main.js only calls createWindow()
  after the key is confirmed on disk, so getKey() is always non-null here.
  The complex retry loop is removed — it was masking the real storage bug.
-->
<template>
  <div>
    <template v-if="phase === 'loading'">
      <div class="app-loading">
        <Icon name="mdi:loading" size="32" class="spin" />
        <p class="loading-text">{{ $t("loading") }}</p>
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

const onLicenseActivated = async () => {
  phase.value = "loading";
  try {
    await initDb();
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
    // ── Electron ──────────────────────────────────────────────────────────────
    // main.js only opens this window after verifyLicense() succeeds OR after
    // license:activated fires with a confirmed-saved key. So we can go straight
    // to 'app' without checking the key here — the guard is in main.js.
    if (isElectronEnv()) {
      phase.value = "app";
      return;
    }

    // ── Capacitor (mobile) ────────────────────────────────────────────────────
    if (await isNativeMobile()) {
      let result;
      try {
        const { verify } = useMobileLicense();
        result = await verify();
      } catch (licErr) {
        console.error("[app.vue] verify threw:", licErr);
        result = { ok: false, reason: "verify_error" };
      }

      if (!result.ok) {
        phase.value = "license";
        return;
      }

      await initDb();
      phase.value = "app";
      return;
    }

    // ── Web / SSR fallback ────────────────────────────────────────────────────
    phase.value = "app";
  } catch (err) {
    console.error("[app.vue] init failed:", err);
    error.value = err.message || "Failed to initialize";
    phase.value = "error";
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
