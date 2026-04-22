<!-- pages/license.vue -->
<template>
  <div class="license-page" :dir="locale === 'ar' ? 'rtl' : 'ltr'">
    <div class="license-card">
      <div class="license-logo">
        <Icon name="mdi:store-outline" size="40" />
      </div>

      <h1 class="license-title">{{ $t("license.title") }}</h1>
      <p class="license-sub">{{ $t("license.subtitle") }}</p>

      <div class="key-input-wrap">
        <input
          v-model="licenseKey"
          class="key-input"
          :placeholder="$t('license.keyPlaceholder')"
          :disabled="isActivating"
          @keyup.enter="activate"
        />
      </div>

      <div v-if="error" class="license-error">
        <Icon name="mdi:alert-circle-outline" size="15" />
        {{ error }}
      </div>

      <button
        class="activate-btn"
        :disabled="!licenseKey.trim() || isActivating"
        @click="activate"
      >
        <Icon
          v-if="isActivating"
          name="mdi:loading"
          size="16"
          class="spinning"
        />
        <Icon v-else name="mdi:key-outline" size="16" />
        {{ isActivating ? $t("license.activating") : $t("license.activate") }}
      </button>

      <p class="license-footer">{{ $t("license.contactSupport") }}</p>
    </div>
  </div>
</template>

<script setup>
const { locale } = useI18n();
const { $toast } = useNuxtApp();

const isMobile = import.meta.client && !window.license;
const mobileLicense = isMobile ? useMobileLicense() : null;

const licenseKey = ref("");
const isActivating = ref(false);
const error = ref("");

const activate = async () => {
  if (!licenseKey.value.trim()) return;
  isActivating.value = true;
  error.value = "";

  try {
    let result;

    if (window.license) {
      // Electron desktop — platform: 'desktop' sent inside activateLicense()
      result = await window.license.activate(licenseKey.value.trim());
      if (result.ok) window.license.onActivated();
    } else {
      // Mobile — platform: 'mobile' sent inside useMobileLicense.activate()
      result = await mobileLicense.activate(licenseKey.value.trim());
      if (result.ok) {
        $toast.success($t("license.activated"));
        window.location.reload();
      }
    }

    if (!result.ok) {
      error.value = result.error || $t("license.failed");
    }
  } catch {
    error.value = $t("license.error");
  } finally {
    isActivating.value = false;
  }
};
</script>

<style lang="scss" scoped>
.license-page {
  min-height: 100vh;
  background: var(--bg-page);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
}
.license-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 20px;
  padding: 2.5rem 2rem;
  width: 100%;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.1);
}
.license-logo {
  width: 72px;
  height: 72px;
  border-radius: 20px;
  background: var(--primary-soft);
  color: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
}
.license-title {
  font-size: 1.3rem;
  font-weight: 800;
  color: var(--text-primary);
  margin: 0;
  text-align: center;
}
.license-sub {
  font-size: 0.83rem;
  color: var(--text-muted);
  margin: 0;
  text-align: center;
  line-height: 1.5;
}
.key-input-wrap {
  width: 100%;
}
.key-input {
  width: 100%;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 0.9rem;
  outline: none;
  transition: border-color 0.15s;
  text-align: center;
  letter-spacing: 0.05em;
  font-family: monospace;
  &:focus {
    border-color: var(--primary);
  }
  &::placeholder {
    color: var(--text-muted);
    letter-spacing: 0;
    font-family: inherit;
  }
  &:disabled {
    opacity: 0.6;
  }
}
.license-error {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: #ef4444;
  font-size: 0.82rem;
  font-weight: 500;
  text-align: center;
}
.activate-btn {
  width: 100%;
  padding: 0.8rem;
  border-radius: 12px;
  border: none;
  background: var(--primary);
  color: #fff;
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  transition: opacity 0.15s;
  &:hover:not(:disabled) {
    opacity: 0.88;
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}
.license-footer {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin: 0;
  text-align: center;
}
.spinning {
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
