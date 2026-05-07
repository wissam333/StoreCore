<template>
  <div
    class="login-root"
    :dir="locale === 'ar' ? 'rtl' : 'ltr'"
    :class="locale === 'ar' ? 'bodyAR' : 'bodyEN'"
  >
    <!-- Animated background grid -->
    <div class="bg-grid" aria-hidden="true">
      <div class="bg-grid__inner" />
    </div>

    <!-- Floating accent blobs -->
    <div class="blob blob--1" aria-hidden="true" />
    <div class="blob blob--2" aria-hidden="true" />

    <div class="login-card glass-card">
      <!-- Logo / brand -->
      <div class="brand">
        <div class="brand__icon">
          <svg
            viewBox="0 0 40 40"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect width="40" height="40" rx="12" fill="var(--primary)" />
            <path d="M10 28 L20 12 L30 28 Z" fill="white" opacity=".9" />
            <circle cx="20" cy="22" r="4" fill="white" />
          </svg>
        </div>
        <div class="brand__text">
          <span class="brand__name">{{ storeName }}</span>
          <span class="brand__sub">{{ $t("auth.subtitle") }}</span>
        </div>
      </div>

      <!-- Error banner -->
      <Transition name="shake">
        <SharedUiFeedbackAlert
          v-if="error"
          type="error"
          :message="error"
          dismissible
          @dismiss="error = ''"
        />
      </Transition>

      <!-- Login form -->
      <div class="form">
        <!-- Username -->
        <SharedUiFormBaseInput
          v-model="form.username"
          :label="$t('auth.username')"
          :placeholder="$t('auth.usernamePlaceholder')"
          icon-left="mdi:account"
          autocomplete="username"
          autocapitalize="none"
          :disabled="loading"
          size="lg"
          @keydown.enter="focusPassword"
        />

        <!-- Password -->
        <SharedUiFormBaseInput
          ref="passwordInputRef"
          v-model="form.password"
          :label="$t('auth.password')"
          :placeholder="$t('auth.passwordPlaceholder')"
          icon-left="mdi:lock"
          type="password"
          autocomplete="current-password"
          :disabled="loading"
          size="lg"
          @keydown.enter="submit"
        />

        <!-- Submit -->
        <SharedUiButtonBase
          class="btn-login"
          variant="primary"
          size="lg"
          icon-left="mdi:login"
          :loading="loading"
          :disabled="loading || !form.username || !form.password"
          @click="submit"
        >
          {{ $t("auth.loginButton") }}
        </SharedUiButtonBase>

        <!-- Fingerprint button — mobile only -->
        <SharedUiButtonBase
          v-if="showFingerprintBtn"
          variant="outline"
          size="lg"
          icon-left="mdi:fingerprint"
          :disabled="loading"
          class="btn-fingerprint"
          @click="loginFingerprint"
        >
          {{ $t("auth.fingerprintLogin") }}
        </SharedUiButtonBase>
      </div>

      <!-- Footer -->
      <p class="login-footer">{{ $t("auth.footer") }}</p>
    </div>
  </div>
</template>

<script setup>
definePageMeta({
  layout: false,
  middleware: false,
});

const { locale, t } = useI18n();
const { login, loginWithFingerprint, restoreSession, isLoggedIn } = useAuth();
const router = useRouter();
const route = useRoute();

// ── Reactive state ─────────────────────────────────────────────────────────
const form = reactive({ username: "", password: "" });
const loading = ref(false);
const error = ref("");
const passwordInputRef = ref(null);

// Determine if running on mobile (not Electron)
const isMobile = typeof window !== "undefined" && !window.__ELECTRON__;
const showFingerprintBtn = ref(false);
const storeName = ref("My Store");

// ── Where to go after login ────────────────────────────────────────────────
// Respects ?redirect=/dashboard/orders so deep links work after session expiry
const redirectTo = computed(() =>
  typeof route.query.redirect === "string" &&
  route.query.redirect.startsWith("/dashboard")
    ? route.query.redirect
    : "/dashboard",
);

// ── Helper to focus password field ─────────────────────────────────────────
const focusPassword = () => {
  passwordInputRef.value?.$el?.querySelector("input")?.focus();
};

// ── On mount ───────────────────────────────────────────────────────────────
onMounted(async () => {
  // Already logged in (e.g. hot reload) — skip login page
  if (isLoggedIn.value) {
    router.replace(redirectTo.value);
    return;
  }

  // Load store name (best effort — don't block login on failure)
  try {
    const res = isMobile
      ? await useMobileStore().getSettings()
      : await window.store.getSettings();
    if (res?.ok) storeName.value = res.data?.store_name ?? "My Store";
  } catch {}

  // On mobile: check if fingerprint is available and a saved username exists
  if (isMobile) {
    try {
      const restore = await restoreSession();
      if (restore?.canUseBiometric && restore?.username) {
        showFingerprintBtn.value = true;
        form.username = restore.username;
      }
    } catch {}
  }
});

// ── Submit ─────────────────────────────────────────────────────────────────
const submit = async () => {
  error.value = "";
  if (!form.username.trim() || !form.password.trim()) return;

  loading.value = true;
  try {
    const result = await login({
      username: form.username.trim(),
      password: form.password,
    });

    if (result.ok) {
      router.replace(redirectTo.value);
    } else {
      error.value = result.error ?? t("auth.invalidCredentials");
      form.password = "";
      await nextTick();
      passwordInputRef.value?.$el?.querySelector("input")?.focus();
    }
  } catch (e) {
    error.value = t("auth.invalidCredentials");
    form.password = "";
  } finally {
    loading.value = false;
  }
};

// ── Fingerprint ────────────────────────────────────────────────────────────
const loginFingerprint = async () => {
  error.value = "";
  loading.value = true;
  try {
    const result = await loginWithFingerprint();
    if (result.ok) {
      router.replace(redirectTo.value);
    } else {
      // Cancelled by user — stay on page silently
      if (!result.error?.toLowerCase().includes("cancel")) {
        error.value = result.error ?? t("auth.fingerprintFailed");
      }
    }
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped lang="scss">
// ── Root ─────────────────────────────────────────────────────────────────
.login-root {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-page);
  position: relative;
  overflow: hidden;
  padding: 1.5rem;
}

// ── Animated background grid ──────────────────────────────────────────────
.bg-grid {
  position: absolute;
  inset: 0;
  opacity: 0.035;
  pointer-events: none;

  &__inner {
    width: 100%;
    height: 100%;
    background-image: linear-gradient(var(--primary) 1px, transparent 1px),
      linear-gradient(90deg, var(--primary) 1px, transparent 1px);
    background-size: 48px 48px;
    animation: grid-drift 30s linear infinite;
  }
}

@keyframes grid-drift {
  from {
    background-position: 0 0;
  }
  to {
    background-position: 48px 48px;
  }
}

// ── Blobs ─────────────────────────────────────────────────────────────────
.blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  pointer-events: none;
  opacity: 0.18;
  animation: blob-float 14s ease-in-out infinite alternate;

  &--1 {
    width: 420px;
    height: 420px;
    background: var(--primary);
    top: -120px;
    inset-inline-end: -100px;
    animation-duration: 14s;
  }

  &--2 {
    width: 320px;
    height: 320px;
    background: #0c1739;
    bottom: -80px;
    inset-inline-start: -80px;
    animation-duration: 18s;
    animation-delay: -6s;
  }
}

@keyframes blob-float {
  from {
    transform: translateY(0) scale(1);
  }
  to {
    transform: translateY(30px) scale(1.08);
  }
}

// ── Card ──────────────────────────────────────────────────────────────────
.login-card {
  width: 100%;
  max-width: 400px;
  position: relative;
  z-index: 1;
  padding: 2.25rem 2rem;
  animation: card-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;

  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 20px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.07),
    0 20px 60px -10px rgba(0, 0, 0, 0.12);
}

@keyframes card-in {
  from {
    opacity: 0;
    transform: translateY(24px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

// ── Brand ─────────────────────────────────────────────────────────────────
.brand {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  margin-bottom: 1.75rem;

  &__icon svg {
    width: 44px;
    height: 44px;
    display: block;
    flex-shrink: 0;
  }

  &__text {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  &__name {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.2;
  }

  &__sub {
    font-size: 0.75rem;
    color: var(--text-muted);
    letter-spacing: 0.02em;
  }
}

// ── Form ──────────────────────────────────────────────────────────────────
.form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

// ── Login button override (adds shadow and full width) ────────────────────
.btn-login {
  margin-top: 0.25rem;
  width: 100%;
  box-shadow: 0 4px 14px rgba(234, 28, 36, 0.35);

  &:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 6px 18px rgba(234, 28, 36, 0.45);
  }

  &:active:not(:disabled) {
    transform: translateY(0);
  }
}

// ── Fingerprint button ────────────────────────────────────────────────────
.btn-fingerprint {
  width: 100%;
  border-style: dashed;
}

// ── Footer ────────────────────────────────────────────────────────────────
.login-footer {
  margin-top: 1.5rem;
  text-align: center;
  font-size: 0.75rem;
  color: var(--text-muted);
  line-height: 1.5;
}

// ── Shake animation for error banner ──────────────────────────────────────
.shake-enter-active {
  animation: shake 0.4s cubic-bezier(0.36, 0.07, 0.19, 0.97);
}

@keyframes shake {
  0%,
  100% {
    transform: translateX(0);
  }
  20% {
    transform: translateX(-6px);
  }
  40% {
    transform: translateX(6px);
  }
  60% {
    transform: translateX(-4px);
  }
  80% {
    transform: translateX(4px);
  }
}

// ── Dark mode ─────────────────────────────────────────────────────────────
:root.dark .login-card {
  background: var(--bg-surface);
  border-color: var(--border-color);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3),
    0 20px 60px -10px rgba(0, 0, 0, 0.5);
}
</style>
