<!-- store-app/app.vue -->
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

// ── Environment detection ─────────────────────────────────────────────────────
//
// ROOT CAUSE OF THE BUG:
// The Electron preload script exposes window.__ELECTRON__ = true,
// window.license, and window.store via contextBridge. On mobile these
// globals were somehow present in the Capacitor WebView, causing the app
// to think it was running in Electron and skip the license check entirely.
//
// THE FIX:
// Capacitor's window.Capacitor object is injected by the NATIVE LAYER —
// it cannot be faked by any JS bundle. We check it FIRST as the ground
// truth. Only after Capacitor confirms we are NOT on a native platform
// do we trust window.__ELECTRON__.
//
// Returns: 'electron' | 'native' | 'web'
const detectEnvironment = async () => {
  // Fast path — Capacitor bridge already registered synchronously
  if (window?.Capacitor?.isNativePlatform?.()) {
    return "native";
  }

  // Slow path — on some Android versions the bridge registers slightly
  // after the first JS tick. Poll for up to 1500ms before giving up.
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

  // Only check __ELECTRON__ AFTER Capacitor has confirmed we are not native.
  // This prevents the Electron preload globals from fooling us on mobile.
  if (typeof window !== "undefined" && !!window.__ELECTRON__) {
    return "electron";
  }

  return "web";
};

// ── License check ─────────────────────────────────────────────────────────────
const checkLicense = async () => {
  try {
    const { verify } = useMobileLicense();
    const result = await verify();
    return result.ok;
  } catch (err) {
    console.warn("[app] checkLicense threw:", err?.message ?? err);
    return false;
  }
};

// ── DB init ───────────────────────────────────────────────────────────────────
const initDb = async () => {
  const { initMobileSchema } = await import("~/composables/useMobileSchema");
  await initMobileSchema();
};

// ── After activation ──────────────────────────────────────────────────────────
const onLicenseActivated = async () => {
  phase.value = "loading";
  loadingMsg.value = "Opening database…";
  error.value = "";
  try {
    await initDb();
    phase.value = "app";
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
      phase.value = "app";
      return;
    }

    // env === 'native' — enforce license
    try {
      const { resetMobileDb } = await import("~/composables/useMobileDb");
      resetMobileDb();
    } catch {}

    loadingMsg.value = "Verifying license…";
    const licensed = await checkLicense();

    if (!licensed) {
      phase.value = "license";
      loadingMsg.value = "";
      return;
    }

    loadingMsg.value = "Opening database…";
    await initDb();
    phase.value = "app";
    loadingMsg.value = "";
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
