<!-- store-app/app.vue -->
<template>
  <div>
    <ElementsLoader />
    <NuxtLayout>
      <main id="main-content">
        <NuxtPage />
      </main>
    </NuxtLayout>
    <SharedUiFeedbackToast position="center" :duration="6000" />
  </div>
</template>

<script setup>
const { locale } = useI18n();

// Only keep locale direction + mobile schema init
onMounted(async () => {
  if (import.meta.client && !window.license) {
    try {
      const { initMobileSchema } = await import(
        "~/composables/useMobileSchema"
      );
      await initMobileSchema();
    } catch (err) {
      console.error("[app.vue] Schema init failed:", err);
    }
  }
});
</script>
