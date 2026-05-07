<!-- store-app/components/Dashboard/Settings/Main.vue -->
<template>
  <div>
    <SharedUiHeaderPage
      :title="$t('sidebar.settings')"
      icon="mdi:cog-outline"
      :is-rtl="locale === 'ar'"
    />

    <div class="settings-grid">
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
              :disabled="!canEdit"
            />
            <SharedUiButtonBase
              size="sm"
              variant="outline"
              icon-left="mdi:refresh"
              :loading="fetchingRate"
              :disabled="!canEdit"
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
            :disabled="!canEdit"
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
            :disabled="!canEdit"
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

    <!-- Read-only notice for non-editors -->
    <div v-if="!canEdit" class="readonly-notice">
      <Icon name="mdi:lock-outline" size="15" />
      {{ $t("settings.readonlyNotice") }}
    </div>

    <div v-if="canEdit" class="save-row">
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
defineProps({
  canEdit: { type: Boolean, default: false },
});

const { locale, t: $t } = useI18n();
const { $toast } = useNuxtApp();
const { getSettings, setSetting } = useStore();
const currency = useCurrency();
const syncStore = useStoreSyncManager();
const { getLiveRate, loading: fetchingRate } = useSypRate();

const DEFAULT_SYNC_BASE = "https://storecore-backend.onrender.com";

const saving = ref(false);
const rateNote = ref("");
const rateNoteType = ref("info");
const licenseKey = ref("");

const s = reactive({
  store_name: "",
  store_address: "",
  store_phone: "",
  dollar_rate: "15000",
  report_currency: "SP",
  sync_base: DEFAULT_SYNC_BASE,
});

const currencyOptions = [
  { label: "SP (ل.س) — Syrian Pound", value: "SP" },
  { label: "USD ($) — US Dollar", value: "USD" },
];

// ── License key ────────────────────────────────────────────────────────────
const loadLicenseKey = async () => {
  try {
    // Electron
    if (typeof window !== "undefined" && window.__ELECTRON__) {
      if (window.license?.getKey) {
        const k = await window.license.getKey();
        licenseKey.value = k ?? "";
        return;
      }
    }

    // Native mobile
    if (
      typeof window !== "undefined" &&
      window?.Capacitor?.isNativePlatform?.()
    ) {
      const { Preferences } = await import("@capacitor/preferences");
      const r = await Preferences.get({ key: "license_key" });
      licenseKey.value = r?.value?.trim() ?? "";
      return;
    }

    licenseKey.value = "";
  } catch (err) {
    console.warn("[settings] loadLicenseKey failed:", err?.message ?? err);
    licenseKey.value = "";
  }
};

const ensureDefaultsWritten = async (key) => {
  const writes = [];
  if (!s.sync_base?.trim()) {
    s.sync_base = DEFAULT_SYNC_BASE;
    writes.push(setSetting({ key: "sync_base", value: DEFAULT_SYNC_BASE }));
  }
  if (key) writes.push(setSetting({ key: "license_key", value: key }));
  if (writes.length)
    await Promise.all(writes).catch((err) =>
      console.warn("[settings] ensureDefaultsWritten failed:", err?.message),
    );
};

// ── Load ───────────────────────────────────────────────────────────────────
const load = async () => {
  const r = await getSettings();
  if (r.ok) {
    // Never pull license_key from SQLite into reactive state
    const { license_key, ...rest } = r.data ?? {};
    Object.assign(s, rest);
  }
  if (!s.sync_base?.trim()) s.sync_base = DEFAULT_SYNC_BASE;

  // Load license key from authoritative source (license.json on Electron, Preferences on mobile)
  await loadLicenseKey();

  // Only write defaults — never overwrite the license key back to SQLite
  if (!s.sync_base?.trim()) {
    s.sync_base = DEFAULT_SYNC_BASE;
    await setSetting({ key: "sync_base", value: DEFAULT_SYNC_BASE }).catch(
      () => {},
    );
  }
};

// ── Actions ────────────────────────────────────────────────────────────────
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
watch(useSyncTick(), () => load());
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
  text-transform: lowercase;
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

/* Read-only notice */
.readonly-notice {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 1rem;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 0.8rem;
  font-weight: 500;
  background: var(--bg-elevated);
  color: var(--text-muted);
  border: 1px solid var(--border-color);
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
