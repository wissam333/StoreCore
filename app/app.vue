<!-- store-app/app.vue -->
<template>
  <div>
    <template v-if="phase === 'loading'">
      <div class="app-loading">
        <img src="/logo/logo.png" class="app-logo" alt="logo" />
        <Icon name="mdi:loading" size="32" class="spin" />
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
const router = useRouter();

const phase = ref("loading");
const error = ref("");
const loadingMsg = ref("");

// ── Environment detection ─────────────────────────────────────────────────────
const detectEnvironment = async () => {
  if (window?.Capacitor?.isNativePlatform?.()) return "native";

  const nativeConfirmed = await new Promise((resolve) => {
    const MAX_WAIT = 1500;
    const INTERVAL = 60;
    let elapsed = 0;
    const timer = setInterval(async () => {
      elapsed += INTERVAL;
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (Capacitor.isNativePlatform()) {
          clearInterval(timer);
          resolve(true);
          return;
        }
      } catch {}
      if (elapsed >= MAX_WAIT) {
        clearInterval(timer);
        resolve(false);
      }
    }, INTERVAL);
  });

  if (nativeConfirmed) return "native";
  if (typeof window !== "undefined" && !!window.__ELECTRON__) return "electron";
  return "web";
};

const getStoredKey = async () => {
  try {
    const { Preferences } = await import("@capacitor/preferences");
    const r = await Preferences.get({ key: "license_key" });
    return r?.value?.trim() ?? null;
  } catch {
    return null;
  }
};

const initDb = async () => {
  const { initMobileSchema } = await import("~/composables/useMobileSchema");
  await initMobileSchema();
};

// ── After DB is ready, decide where to send the user ─────────────────────────
// Uses isLoggedIn + restoreSession from top-level useAuth() call above.
// Do NOT call useAuth() here — composables called after await lose Nuxt context.
const navigateAfterInit = async () => {
  // useAuth() is safe to call here — _session is now a plain module-level ref,
  // not useState(), so it never needs a Nuxt context to exist
  const { isLoggedIn, restoreSession } = useAuth();

  if (isLoggedIn.value) {
    router.replace("/dashboard");
    return;
  }

  let restored = false;
  try {
    const result = await restoreSession();
    restored = result?.ok === true;
  } catch {
    restored = false;
  }

  router.replace(restored ? "/dashboard" : "/auth/login");
};

const runBackgroundVerify = async () => {
  try {
    const { verify } = useMobileLicense();
    const result = await verify();
    if (!result.ok && result.reason !== "offline_grace_expired") {
      console.warn("[app] Background verify failed:", result.reason);
      try {
        const { resetMobileDb } = await import("~/composables/useMobileDb");
        resetMobileDb();
      } catch {}
      phase.value = "license";
    }
  } catch (err) {
    console.warn("[app] Background verify threw:", err?.message ?? err);
  }
};

const onLicenseActivated = async () => {
  phase.value = "loading";
  loadingMsg.value = "Opening database…";
  error.value = "";
  try {
    await initDb();
    phase.value = "app";
    await navigateAfterInit();
  } catch (err) {
    error.value = `Database error: ${err?.message ?? err}`;
    phase.value = "error";
  } finally {
    loadingMsg.value = "";
  }
};

// ── Bootstrap ─────────────────────────────────────────────────────────────────
const init = async () => {
  phase.value = "loading";
  error.value = "";
  loadingMsg.value = "";

  try {
    const env = await detectEnvironment();
    console.log("[app] environment:", env);

    if (env === "electron" || env === "web") {
      loadingMsg.value = "Opening database…";
      await initDb();
      loadingMsg.value = "";
      // Navigate BEFORE showing app — prevents flash of content before redirect
      await navigateAfterInit();
      phase.value = "app";
      return;
    }

    // env === 'native' — enforce license
    try {
      const { resetMobileDb } = await import("~/composables/useMobileDb");
      resetMobileDb();
    } catch {}

    loadingMsg.value = "Opening database…";
    const storedKey = await getStoredKey();

    if (!storedKey) {
      phase.value = "license";
      loadingMsg.value = "";
      return;
    }

    await initDb();
    loadingMsg.value = "";
    // Navigate BEFORE showing app — prevents flash
    await navigateAfterInit();
    phase.value = "app";

    // Fire-and-forget background verification
    runBackgroundVerify();
  } catch (err) {
    error.value = err?.message || "Failed to initialize. Tap to retry.";
    phase.value = "error";
    loadingMsg.value = "";
  }
};

onMounted(() => {
  init();

  document.addEventListener("pause", async () => {
    try {
      const { flushMobileDb } = await import("~/composables/useMobileDb");
      await flushMobileDb();
    } catch {}
  });
});
</script>

<style lang="scss" scoped>
.app-loading {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--bg-page, #f1f5f9);
  gap: 1rem;

  .app-logo {
    width: clamp(100px, 30vw, 180px);
    object-fit: contain;
    margin-bottom: 0.5rem;
  }
  .spin {
    animation: spin 0.9s linear infinite;
    color: var(--primary, #2563eb);
  }
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
