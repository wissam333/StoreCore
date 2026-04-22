<template>
  <div>
    <template v-if="showLicense">
      <LicensePage />
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
const { locale } = useI18n();
const showLicense = ref(false);

onMounted(async () => {
  // ── Electron path ──────────────────────────────────────────────────
  if (window.__SHOW_LICENSE__) {
    showLicense.value = true;
    return;
  }

  window.addEventListener("force-license-screen", () => {
    showLicense.value = true;
  });

  // ── Mobile (Capacitor) path ────────────────────────────────────────
  if (import.meta.client && !window.store) {
    await initMobileSchema();

    const { verify } = useMobileLicense();
    const result = await verify();

    if (!result.ok) {
      showLicense.value = true;
      return;
    }
  }
});
</script>
