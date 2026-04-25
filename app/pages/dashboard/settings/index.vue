<template>
  <div>
    <SharedUiHeaderPage
      :title="$t('sidebar.settings')"
      icon="mdi:cog-outline"
      :is-rtl="locale === 'ar'"
    />

    <div class="settings-grid">
      <div class="settings-card">
        <div class="card-title">{{ $t("storeInfo") }}</div>
        <div class="form-col">
          <SharedUiFormBaseInput
            v-model="s.store_name"
            :label="$t('storeName')"
            icon-left="mdi:store-outline"
          />
          <SharedUiFormBaseInput
            v-model="s.store_address"
            :label="$t('storeAddress')"
            icon-left="mdi:map-marker-outline"
          />
          <SharedUiFormBaseInput
            v-model="s.store_phone"
            :label="$t('storePhone')"
            icon-left="mdi:phone-outline"
          />
        </div>
      </div>

      <div class="settings-card">
        <div class="card-title">{{ $t("currencySettings") }}</div>
        <div class="form-col">
          <div class="rate-row">
            <SharedUiFormBaseInput
              v-model.number="s.dollar_rate"
              type="number"
              min="1"
              :label="$t('dollarRate')"
              :hint="$t('dollarRateHint')"
              icon-left="mdi:currency-usd"
            />
            <SharedUiButtonBase
              size="sm"
              variant="outline"
              icon-left="mdi:refresh"
              :loading="fetchingRate"
              @click="fetchRate"
            >
              {{ $t("fetchRate") }}
            </SharedUiButtonBase>
          </div>

          <div v-if="rateNote" class="rate-note" :class="rateNoteType">
            <Icon name="mdi:information-outline" size="14" />
            {{ rateNote }}
          </div>

          <SharedUiFormBaseSelect
            v-model="s.report_currency"
            :options="currencyOptions"
            :label="$t('reportCurrency')"
            :hint="$t('reportCurrencyHint')"
          />

          <div class="preview-box">
            <Icon name="mdi:eye-outline" size="14" />
            {{ $t("1USD") }} = {{ Number(s.dollar_rate).toLocaleString() }} ل.س
          </div>
        </div>
      </div>

      <div class="settings-card">
        <div class="card-title">{{ $t("syncSettings") }}</div>
        <div class="form-col">
          <div class="license-key-box" :class="{ active: !!licenseKey }">
            <div class="license-key-label">
              <Icon
                :name="
                  licenseKey
                    ? 'mdi:shield-check-outline'
                    : 'mdi:shield-off-outline'
                "
                size="15"
              />
              {{ $t("licenseKey") }}
            </div>
            <div class="license-key-value">
              {{ licenseKey || $t("noLicenseActivated") }}
            </div>
          </div>

          <SharedUiFormBaseInput
            v-model="s.sync_base"
            :label="$t('syncBase')"
            :hint="$t('syncBaseHint')"
            icon-left="mdi:server-outline"
          />

          <div class="sync-status-row">
            <div class="sync-meta">
              <span v-if="syncStore.isSyncing.value" class="sync-badge syncing">
                <Icon name="mdi:loading" size="13" class="spinning" />
                {{ $t("syncing") }}
              </span>
              <span
                v-else-if="syncStore.syncError.value"
                class="sync-badge error"
              >
                <Icon name="mdi:alert-circle-outline" size="13" />
                {{ syncStore.syncError.value }}
              </span>
              <span v-else class="sync-badge ok">
                <Icon name="mdi:check-circle-outline" size="13" />
                {{ $t("syncIdle") }}
              </span>

              <span v-if="syncStore.lastSyncedAt.value" class="sync-time">
                {{ $t("lastSync") }}:
                {{ formatTime(syncStore.lastSyncedAt.value) }}
              </span>
            </div>

            <SharedUiButtonBase
              size="sm"
              variant="outline"
              icon-left="mdi:sync"
              :loading="syncStore.isSyncing.value"
              :disabled="
                !licenseKey || !s.sync_base || !syncStore.isOnline.value
              "
              @click="manualSync"
            >
              {{ $t("syncNow") }}
            </SharedUiButtonBase>
          </div>
        </div>
      </div>
    </div>

    <div class="save-row">
      <SharedUiButtonBase
        size="lg"
        icon-left="mdi:content-save-outline"
        :loading="saving"
        @click="saveAll"
      >
        {{ $t("saveSettings") }}
      </SharedUiButtonBase>
    </div>
  </div>
</template>

<script setup>
const { locale, t: $t } = useI18n();
const { $toast } = useNuxtApp();
const { getSettings, setSetting } = useStore();
const currency = useCurrency();
const syncStore = useStoreSyncManager();
const { getLiveRate, loading: fetchingRate } = useSypRate();

const saving = ref(false);
const rateNote = ref("");
const rateNoteType = ref("info");

// License key is displayed separately from the main settings object.
// Source depends on platform:
//   Electron  → window.license.getKey() (IPC → licenseManager.js file store)
//   Mobile    → useMobileLicense().getKey() (Capacitor Preferences)
// We never read it from SQLite because persistToSettings() is deferred
// and may not have run yet, or may have failed silently.
const licenseKey = ref("");

const s = reactive({
  store_name: "",
  store_address: "",
  store_phone: "",
  dollar_rate: "15000",
  report_currency: "SP",
  sync_base: "https://storecore-backend.onrender.com",
});

const currencyOptions = [
  { label: "SP (ل.س) — Syrian Pound", value: "SP" },
  { label: "USD ($) — US Dollar", value: "USD" },
];

// ── Read license key from the correct source for this platform ────────────────
const loadLicenseKey = async () => {
  try {
    // Electron: window.license is exposed by the preload script via contextBridge
    if (
      typeof window !== "undefined" &&
      window.__ELECTRON__ &&
      window.license?.getKey
    ) {
      licenseKey.value = (await window.license.getKey()) ?? "";
      return;
    }

    // Native mobile: read from Capacitor Preferences
    if (
      typeof window !== "undefined" &&
      window?.Capacitor?.isNativePlatform?.()
    ) {
      const { getKey } = useMobileLicense();
      licenseKey.value = (await getKey()) ?? "";
      return;
    }

    // Web / unknown — no license key concept
    licenseKey.value = "";
  } catch (err) {
    console.warn("[settings] loadLicenseKey failed:", err?.message ?? err);
    licenseKey.value = "";
  }
};

// ── Load all settings ─────────────────────────────────────────────────────────
const load = async () => {
  const r = await getSettings();
  if (r.ok) {
    // Pull everything except license_key — that comes from loadLicenseKey()
    const { license_key, ...rest } = r.data ?? {};
    Object.assign(s, rest);
  }
  if (!s.sync_base?.trim())
    s.sync_base = "https://storecore-backend.onrender.com";

  await loadLicenseKey();
};

const fetchRate = async () => {
  const result = await getLiveRate();
  if (result) {
    s.dollar_rate = result.rate;
    rateNote.value = `Black Market: ${result.rate.toLocaleString()} SYP`;
    rateNoteType.value = "info";
    $toast.success("Rate updated successfully");
  } else {
    rateNote.value = "Failed to fetch live rate";
    rateNoteType.value = "error";
  }
};

const manualSync = async () => {
  await syncStore.sync();
  if (!syncStore.syncError.value) $toast.success($t("syncComplete"));
};

const formatTime = (date) => {
  if (!date) return "";
  return new Intl.DateTimeFormat(locale.value === "ar" ? "ar-SY" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  }).format(new Date(date));
};

const saveAll = async () => {
  saving.value = true;
  // Never write license_key from this page — it is managed by the license system
  const skip = new Set(["license_key"]);
  for (const key of Object.keys(s)) {
    if (skip.has(key)) continue;
    await setSetting({ key, value: String(s[key] ?? "") });
  }
  await currency.loadSettings(true);
  saving.value = false;
  $toast.success($t("settingsSaved"));
};

onMounted(load);
</script>

<style lang="scss" scoped>
.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 1.5rem;
}
.settings-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 1.5rem;
}
.card-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 1.25rem;
}
.form-col {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.rate-row {
  display: flex;
  align-items: center;
  gap: 10px;
  > :first-child {
    flex: 1;
  }
}
.preview-box {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  background: var(--bg-elevated);
  padding: 8px 12px;
  border-radius: 8px;
  color: var(--text-sub);
  font-weight: 600;
}
.rate-note {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 0.8rem;
  padding: 8px 12px;
  border-radius: 8px;
  &.info {
    background: rgba(6, 182, 212, 0.08);
    color: #06b6d4;
  }
  &.warning {
    background: rgba(245, 158, 11, 0.08);
    color: #f59e0b;
  }
  &.error {
    background: rgba(239, 68, 68, 0.08);
    color: #ef4444;
  }
}
.license-key-box {
  background: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 10px 14px;
  &.active {
    border-color: rgba(34, 197, 94, 0.4);
    background: rgba(34, 197, 94, 0.05);
  }
}
.license-key-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  .active & {
    color: #22c55e;
  }
}
.license-key-value {
  font-family: monospace;
  font-size: 0.82rem;
  color: var(--text-primary);
  word-break: break-all;
  letter-spacing: 0.03em;
}
.sync-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.sync-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.sync-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 20px;
  &.syncing {
    background: rgba(6, 182, 212, 0.1);
    color: #06b6d4;
  }
  &.ok {
    background: rgba(34, 197, 94, 0.1);
    color: #22c55e;
  }
  &.error {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
  }
}
.sync-time {
  font-size: 0.73rem;
  color: var(--text-muted);
}
.save-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 1rem;
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
