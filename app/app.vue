<!-- store-app/app.vue -->
<template>
  <div>
    <!-- Loading: waiting for Capacitor + DB + License -->
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

    <!-- License screen -->
    <template v-else-if="phase === 'license'">
      <NuxtPage />
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
const { locale, t: $t } = useI18n();
const phase = ref("loading"); // 'loading' | 'error' | 'license' | 'app'
const error = ref("");

// Platform detection
const isElectron = typeof window !== "undefined" && !!window.license;
const isCapacitor =
  typeof window !== "undefined" &&
  typeof Capacitor !== "undefined" &&
  Capacitor.isNativePlatform?.();

const init = async () => {
  phase.value = "loading";
  error.value = "";

  try {
    // ── Electron path ──────────────────────────────────────────────────────
    if (isElectron) {
      const key = await window.license.getKey();
      phase.value = key ? "app" : "license";
      return;
    }

    // ── Mobile (Capacitor) path ────────────────────────────────────────────
    if (isCapacitor) {
      // 1. Initialize DB first (this waits for deviceready internally)
      const { initMobileSchema } = await import(
        "~/composables/useMobileSchema"
      );
      await initMobileSchema();

      // 2. Check license
      const { verify } = useMobileLicense();
      const result = await verify();

      if (result.ok) {
        phase.value = "app";
      } else {
        // Redirect to license page
        await navigateTo("/license", { replace: true });
        phase.value = "license";
      }
      return;
    }

    // ── Web/SSR fallback ───────────────────────────────────────────────────
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
