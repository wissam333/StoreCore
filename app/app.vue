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

const VERIFY_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 hours
let lastVerifiedAt = 0;

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

const navigateAfterInit = async () => {
  const { isLoggedIn, restoreSession } = useAuth();

  let targetPath = "/auth/login";

  if (isLoggedIn.value) {
    targetPath = "/dashboard";
  } else {
    let restored = false;
    try {
      const result = await restoreSession();
      restored = result?.ok === true;
    } catch {
      restored = false;
    }
    if (restored) targetPath = "/dashboard";
  }

  await router.replace(targetPath);
};

// ── Kick out — clear session and go to license page ───────────────────────────
const kickOut = async (env) => {
  // Clear auth session so they can't reopen and get back in
  try {
    const { logout } = useAuth();
    await logout();
  } catch {}

  if (env === "electron") {
    // Tell main process to close main window and open license window
    try {
      window.license.revoked();
    } catch {}
  } else {
    // Mobile — clear stored license and show license page
    try {
      const { Preferences } = await import("@capacitor/preferences");
      await Preferences.remove({ key: "license_key" });
      await Preferences.remove({ key: "last_verified_at" });
    } catch {}
    try {
      const { resetMobileDb } = await import("~/composables/useMobileDb");
      resetMobileDb();
    } catch {}
    phase.value = "license";
  }
};

// ── Background verify — called on focus/resume ────────────────────────────────
const backgroundVerify = async () => {
  // Skip if not enough time has passed
  if (Date.now() - lastVerifiedAt < VERIFY_INTERVAL_MS) return;

  // Skip if we're already on license or loading phase
  if (phase.value !== "app") return;

  const env = await detectEnvironment();

  try {
    if (env === "electron") {
      const result = await window.license.verify();
      if (!result.ok) {
        await kickOut("electron");
      } else {
        lastVerifiedAt = Date.now();
      }
    } else if (env === "native") {
      const { verify } = useMobileLicense();
      const result = await verify();
      if (!result.ok && result.reason !== "offline_grace_expired") {
        await kickOut("native");
      } else if (result.ok) {
        lastVerifiedAt = Date.now();
      }
    }
  } catch (err) {
    console.warn("[app] backgroundVerify error:", err?.message ?? err);
  }
};

const onLicenseActivated = async () => {
  phase.value = "loading";
  loadingMsg.value = "Opening database…";
  error.value = "";
  try {
    await initDb();
    await navigateAfterInit();
    phase.value = "app";
    lastVerifiedAt = Date.now();
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

    if (env === "electron") {
      const currentRoute = router.currentRoute.value.path;
      if (currentRoute === "/license") {
        phase.value = "app";
        return;
      }

      loadingMsg.value = "Opening database…";
      await initDb();
      loadingMsg.value = "";
      await navigateAfterInit();
      phase.value = "app";
      lastVerifiedAt = Date.now();
      return;
    }

    if (env === "web") {
      loadingMsg.value = "Opening database…";
      await initDb();
      loadingMsg.value = "";
      await navigateAfterInit();
      phase.value = "app";
      return;
    }

    // ── NATIVE MOBILE ─────────────────────────────────────────────────────────
    try {
      const { resetMobileDb } = await import("~/composables/useMobileDb");
      resetMobileDb();
    } catch {}

    const storedKey = await getStoredKey();
    if (!storedKey) {
      phase.value = "license";
      return;
    }

    loadingMsg.value = "Opening database…";
    await initDb();
    loadingMsg.value = "";
    await navigateAfterInit();
    phase.value = "app";
    lastVerifiedAt = Date.now();

    // Initial background verify after boot
    backgroundVerify();
  } catch (err) {
    error.value = err?.message || "Failed to initialize. Tap to retry.";
    phase.value = "error";
    loadingMsg.value = "";
  }
};

onMounted(async () => {
  await router.isReady();

  init();

  // Mobile — verify on resume
  document.addEventListener("resume", () => {
    backgroundVerify();
  });

  document.addEventListener("pause", async () => {
    try {
      const { flushMobileDb, flushMobileDbSync } = await import(
        "~/composables/useMobileDb"
      );
      flushMobileDbSync();
      flushMobileDb();
    } catch {}
  });

  // Electron — listen for focus-triggered verify from main process
  if (typeof window !== "undefined" && window.__ELECTRON__) {
    window.license.onCheck(() => {
      backgroundVerify();
    });
  }
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
