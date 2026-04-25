<!-- store-app/app.vue -->
<!--
  FIXES:
  1. initDb() is now called with a deliberate nextTick defer on first boot
     so the Capacitor native bridge has time to register plugins before
     getMobileDb() is invoked.
  2. onLicenseActivated() also defers initDb() by one tick for the same reason.
  3. The verify() call in the mobile branch is wrapped so that a DB-init error
     during persistToSettings (inside useMobileLicense) can never crash the
     license guard — it is caught and logged separately.
  4. Removed the implicit DB access from the license phase: useMobileLicense's
     persistToSettings is now only called AFTER initDb() succeeds (see the
     companion fix in useMobileLicense.js).
-->
<template>
  <div>
    <template v-if="phase === 'loading'">
      <div class="app-loading">
        <Icon name="mdi:loading" size="32" class="spin" />
        <p class="loading-text">{{ $t("loading") }}</p>
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

const isElectronEnv = () =>
  typeof window !== "undefined" && !!window.license && !!window.store;

const isNativeMobile = async () => {
  if (isElectronEnv()) return false;
  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

// ── DB init ───────────────────────────────────────────────────────────────────
// FIX: wrapped in nextTick so that by the time getMobileDb() is called, Vue
// has finished its mount cycle and the Capacitor native bridge has had at
// least one event-loop tick to settle. The plugin poll in useMobileDb.js
// does the real waiting, but this eliminates the most common race on fast
// devices where the call arrives before the poll even starts.
const initDb = async () => {
  await nextTick();
  const { initMobileSchema } = await import("~/composables/useMobileSchema");
  await initMobileSchema();
};

// ── License activation callback ───────────────────────────────────────────────
// Called by MobileLicensePage after a successful server activation.
// At this point the license key is in Preferences but the DB is NOT yet open.
// We open the DB here (with the same nextTick guard) before switching phase.
const onLicenseActivated = async () => {
  phase.value = "loading";
  try {
    await initDb();
    phase.value = "app";
  } catch (err) {
    console.error("[app.vue] initDb after activation failed:", err);
    error.value = err.message || "Failed to initialize database";
    phase.value = "error";
  }
};

// ── Bootstrap ─────────────────────────────────────────────────────────────────
const init = async () => {
  phase.value = "loading";
  error.value = "";

  try {
    // ── Electron ────────────────────────────────────────────────────────────
    // main.js only opens this window after verifyLicense() succeeds, so the
    // key is always on disk here. Skip all license checks.
    if (isElectronEnv()) {
      phase.value = "app";
      return;
    }

    // ── Capacitor (Android / iOS) ────────────────────────────────────────
    if (await isNativeMobile()) {
      // 1. Check license first (Preferences only — no DB needed)
      let result;
      try {
        const { verify } = useMobileLicense();
        result = await verify();
      } catch (licErr) {
        console.error("[app.vue] verify threw:", licErr);
        result = { ok: false, reason: "verify_error" };
      }

      if (!result.ok) {
        // Show license input screen — DB init is deferred until after activation
        phase.value = "license";
        return;
      }

      // 2. License OK → now it is safe to open the DB
      //    (The plugin poll in getMobileDb will wait if the bridge isn't ready yet)
      try {
        await initDb();
      } catch (dbErr) {
        console.error("[app.vue] initDb failed:", dbErr);
        error.value = dbErr.message || "Failed to initialize database";
        phase.value = "error";
        return;
      }

      phase.value = "app";
      return;
    }

    // ── Web / SSR fallback ───────────────────────────────────────────────────
    phase.value = "app";
  } catch (err) {
    console.error("[app.vue] init failed:", err);
    error.value = err.message || "Failed to initialize";
    phase.value = "error";
  }
};

onMounted(() => init());
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
