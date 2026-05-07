<template>
  <div class="splash">
    <img src="/logo/logo.png" alt="logo" class="splash-logo" />
  </div>
</template>

<script setup>
definePageMeta({ middleware: false });
</script>

<style lang="scss" scoped>
.splash {
  min-height: calc(100vh - 112px);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-page);
}

.splash-logo {
  width: clamp(120px, 40vw, 320px);
  object-fit: contain;
}
</style>
