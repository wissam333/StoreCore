<!-- store-app/app.vue -->
<template>
  <div>
    <template v-if="showLicense">
      <LicensePage />
    </template>
    <template v-else-if="appReady">
      <ElementsLoader />
      <NuxtLayout>
        <main id="main-content">
          <NuxtPage />
        </main>
      </NuxtLayout>
      <SharedUiFeedbackToast position="center" :duration="6000" />
    </template>
    <!-- Brief blank frame while we check the license — prevents flash -->
    <template v-else>
      <div class="app-loading">
        <Icon name="mdi:loading" size="32" class="spin" />
      </div>
    </template>
  </div>
</template>

<script setup>
import { initMobileSchema } from "~/composables/useMobileSchema";

const { locale } = useI18n();
const showLicense = ref(false);
const appReady = ref(false); // gates the full app until license is checked

onMounted(async () => {
  // ── Electron path ──────────────────────────────────────────────────────────
  // main.js sets window.__SHOW_LICENSE__ = true before the page loads when
  // verifyLicense() fails. We check synchronously here.
  if (typeof window !== "undefined" && window.__SHOW_LICENSE__) {
    showLicense.value = true;
    appReady.value = true;
    return;
  }

  // Allow main.js to trigger the license screen later (e.g. after grace expiry)
  window.addEventListener("force-license-screen", () => {
    showLicense.value = true;
    appReady.value = true;
  });

  // ── Electron without license flag → just open the app ─────────────────────
  if (typeof window !== "undefined" && window.store) {
    appReady.value = true;
    return;
  }

  // ── Mobile (Capacitor) path ────────────────────────────────────────────────
  if (import.meta.client) {
    try {
      // 1. Initialise the SQLite schema first
      await initMobileSchema();
    } catch (schemaErr) {
      // Schema init failed — we can still check the license via Preferences,
      // but log the error so it shows in device logs
      console.error("[app.vue] initMobileSchema failed:", schemaErr);
      // Don't block — continue to license check below
    }

    try {
      // 2. Check license
      const { verify } = useMobileLicense();
      const result = await verify();

      if (!result.ok) {
        showLicense.value = true;
      }
    } catch (licErr) {
      // If the license check itself throws (very unlikely), be safe and ask
      console.error("[app.vue] License verify failed:", licErr);
      showLicense.value = true;
    }

    // 3. Reveal the app (or the license page)
    appReady.value = true;
  }
});
</script>

<style scoped>
.app-loading {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-page, #f1f5f9);
}
.spin {
  animation: spin 0.9s linear infinite;
  color: var(--primary, #2563eb);
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
