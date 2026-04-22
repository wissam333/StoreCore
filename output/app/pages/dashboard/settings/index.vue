<template>
  <div class="settings-page">
    <div class="container-fluid">
      <SharedUiHeaderPage
        :title="$t('sidebar.settings')"
        :subtitle="$t('settingsDesc')"
        icon="mdi:cog-outline"
      />

      <div class="settings-layout">
        <!-- Sidebar nav -->
        <div class="settings-nav">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="snav-item"
            :class="{ active: activeTab === tab.key }"
            @click="activeTab = tab.key"
          >
            <Icon :name="tab.icon" size="18" />
            <span>{{ $t(tab.label) }}</span>
          </button>
        </div>

        <!-- Content -->
        <div class="settings-content">

          <!-- ── Clinic Info ──────────────────────────────────────── -->
          <div v-show="activeTab === 'clinic'" class="settings-section">
            <div class="section-head">
              <Icon name="mdi:hospital-building" size="18" />
              <h2>{{ $t("clinicInfo") }}</h2>
            </div>
            <div class="row g-3">
              <div class="col-12">
                <SharedUiFormBaseInput
                  v-model="settings.clinic_name"
                  :label="$t('clinicName')"
                  :placeholder="$t('enterClinicName')"
                  icon-left="mdi:hospital-building"
                />
              </div>
              <div class="col-12">
                <SharedUiFormBaseInput
                  v-model="settings.clinic_address"
                  :label="$t('address')"
                  :placeholder="$t('enterAddress')"
                  icon-left="mdi:map-marker-outline"
                  type="textarea"
                  :rows="2"
                />
              </div>
              <div class="col-md-6">
                <SharedUiFormBaseInput
                  v-model="settings.clinic_phone"
                  :label="$t('phone')"
                  :placeholder="$t('enterPhone')"
                  icon-left="mdi:phone-outline"
                />
              </div>
              <div class="col-md-6">
                <SharedUiFormBaseSelect
                  v-model="settings.currency"
                  :label="$t('currency')"
                  :options="currencyOptions"
                />
              </div>
              <div class="col-12">
                <SharedUiButtonBase variant="primary" icon-left="mdi:content-save-outline" :loading="isSaving" @click="saveAll">
                  {{ $t("saveSettings") }}
                </SharedUiButtonBase>
              </div>
            </div>
          </div>

          <!-- ── Sync ────────────────────────────────────────────── -->
          <div v-show="activeTab === 'sync'" class="settings-section">
            <div class="section-head">
              <Icon name="mdi:cloud-sync-outline" size="18" />
              <h2>{{ $t("syncSettings") }}</h2>
            </div>

            <!-- Sync status banner -->
            <div class="sync-status-banner" :class="syncBannerClass">
              <div class="sync-banner-left">
                <Icon :name="isOnline ? 'mdi:cloud-check-outline' : 'mdi:cloud-off-outline'" size="20" />
                <div>
                  <p class="sync-banner-title">{{ isOnline ? $t("online") : $t("offline") }}</p>
                  <p class="sync-banner-sub">
                    <span v-if="lastSyncedAt">{{ $t("lastSynced") }}: {{ fmtDateTime(lastSyncedAt) }}</span>
                    <span v-else>{{ $t("neverSynced") }}</span>
                    <span v-if="pendingCount > 0" class="pending-badge">{{ pendingCount }} {{ $t("pending") }}</span>
                  </p>
                </div>
              </div>
              <SharedUiButtonBase
                variant="primary"
                size="sm"
                icon-left="mdi:cloud-upload-outline"
                :loading="isSyncing"
                :disabled="!isOnline || !settings.sync_base"
                @click="sync"
              >
                {{ $t("syncNow") }}
              </SharedUiButtonBase>
            </div>

            <div class="row g-3 mt-2">
              <div class="col-12">
                <SharedUiFormBaseInput
                  v-model="settings.sync_base"
                  :label="$t('syncApiUrl')"
                  :placeholder="'https://yourapi.com/sync'"
                  icon-left="mdi:link-variant"
                />
              </div>
              <div class="col-12">
                <SharedUiFormBaseInput
                  v-model="settings.sync_token"
                  :label="$t('syncToken')"
                  :placeholder="$t('enterSyncToken')"
                  type="password"
                  icon-left="mdi:key-outline"
                />
              </div>
              <div class="col-12">
                <div class="info-box">
                  <Icon name="mdi:information-outline" size="16" />
                  <p>{{ $t("syncExplainer") }}</p>
                </div>
              </div>
              <div class="col-12">
                <SharedUiButtonBase variant="primary" icon-left="mdi:content-save-outline" :loading="isSaving" @click="saveAll">
                  {{ $t("saveSettings") }}
                </SharedUiButtonBase>
              </div>
            </div>
          </div>

          <!-- ── Appearance ──────────────────────────────────────── -->
          <div v-show="activeTab === 'appearance'" class="settings-section">
            <div class="section-head">
              <Icon name="mdi:palette-outline" size="18" />
              <h2>{{ $t("appearance") }}</h2>
            </div>
            <div class="appearance-grid">
              <div class="appearance-item">
                <p class="appearance-label">{{ $t("language") }}</p>
                <div class="lang-toggle">
                  <button class="lang-btn" :class="{ active: locale === 'ar' }" @click="setLocale('ar')">
                    <Icon name="mdi:abjad-arabic" size="16" /> العربية
                  </button>
                  <button class="lang-btn" :class="{ active: locale === 'en' }" @click="setLocale('en')">
                    <Icon name="mdi:translate" size="16" /> English
                  </button>
                </div>
              </div>
              <div class="appearance-item">
                <p class="appearance-label">{{ $t("theme") }}</p>
                <div class="theme-toggle">
                  <button class="theme-btn" :class="{ active: !isDark }" @click="setTheme('light')">
                    <Icon name="mdi:white-balance-sunny" size="16" /> {{ $t("light") }}
                  </button>
                  <button class="theme-btn" :class="{ active: isDark }" @click="setTheme('dark')">
                    <Icon name="mdi:moon-waning-crescent" size="16" /> {{ $t("dark") }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- ── About ───────────────────────────────────────────── -->
          <div v-show="activeTab === 'about'" class="settings-section">
            <div class="section-head">
              <Icon name="mdi:information-outline" size="18" />
              <h2>{{ $t("about") }}</h2>
            </div>
            <div class="about-card">
              <div class="about-logo">
                <Icon name="mdi:hospital-building" size="48" />
              </div>
              <h3>{{ settings.clinic_name || "MediCore" }}</h3>
              <p class="about-version">v1.0.0 — Offline-First Clinic System</p>
              <div class="about-features">
                <div class="feat-row"><Icon name="mdi:database-outline" size="15" /> {{ $t("localSqlite") }}</div>
                <div class="feat-row"><Icon name="mdi:cloud-sync-outline" size="15" /> {{ $t("cloudSyncReady") }}</div>
                <div class="feat-row"><Icon name="mdi:translate" size="15" /> {{ $t("bilingualArabicEnglish") }}</div>
                <div class="feat-row"><Icon name="mdi:shield-lock-outline" size="15" /> {{ $t("localDataPrivacy") }}</div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
definePageMeta({ layout: "default" });

const { t, locale, setLocale } = useI18n();
const { $toast } = useNuxtApp();
const { getSettings, setSetting } = useClinic();
const { isSyncing, isOnline, lastSyncedAt, pendingCount, sync } = useSyncManager();
const { isDark, toggleDark } = useTheme();

const isLoading = ref(true);
const isSaving  = ref(false);
const activeTab = ref("clinic");

const settings = ref({
  clinic_name: "", clinic_address: "", clinic_phone: "",
  currency: "USD", sync_base: "", sync_token: "",
});

const tabs = [
  { key: "clinic",     icon: "mdi:hospital-building",  label: "clinicInfo"   },
  { key: "sync",       icon: "mdi:cloud-sync-outline",  label: "syncSettings" },
  { key: "appearance", icon: "mdi:palette-outline",     label: "appearance"   },
  { key: "about",      icon: "mdi:information-outline", label: "about"        },
];

const currencyOptions = [
  { value: "USD", label: "USD ($)" },
  { value: "EUR", label: "EUR (€)" },
  { value: "GBP", label: "GBP (£)" },
  { value: "SAR", label: "SAR (ر.س)" },
  { value: "AED", label: "AED (د.إ)" },
  { value: "EGP", label: "EGP (ج.م)" },
];

const syncBannerClass = computed(() => isOnline.value ? "banner-online" : "banner-offline");

const loadSettings = async () => {
  isLoading.value = true;
  const r = await getSettings();
  if (r.ok) Object.assign(settings.value, r.data);
  isLoading.value = false;
};

const saveAll = async () => {
  isSaving.value = true;
  try {
    for (const [key, value] of Object.entries(settings.value)) {
      await setSetting({ key, value: String(value ?? "") });
    }
    $toast.success(t("settingsSaved"));
  } catch (err) {
    $toast.error(err.message || t("operationFailed"));
  } finally {
    isSaving.value = false;
  }
};

const setTheme = (mode) => {
  if (mode === "dark" && !isDark.value) toggleDark();
  if (mode === "light" && isDark.value) toggleDark();
};

const fmtDateTime = (d) => d ? new Date(d).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "—";

onMounted(loadSettings);
</script>

<style lang="scss" scoped>
.settings-page { padding: 2rem; min-height: 100vh; background: var(--bg-page); }

.settings-layout {
  display: flex; gap: 1.5rem; margin-top: 1.5rem;
  @media (max-width: 768px) { flex-direction: column; }
}

// ── Nav ───────────────────────────────────────────────────────────────────────
.settings-nav {
  width: 220px; flex-shrink: 0;
  background: var(--bg-surface); border-radius: 16px; padding: .75rem;
  border: 1px solid var(--border-color);
  height: fit-content;
  @media (max-width: 768px) { width: 100%; display: flex; flex-wrap: wrap; gap: .3rem; }
}

.snav-item {
  display: flex; align-items: center; gap: .6rem;
  width: 100%; padding: .7rem .85rem; border-radius: 10px; border: none;
  background: transparent; color: var(--text-muted); font-size: .85rem; font-weight: 500;
  cursor: pointer; text-align: start; transition: all .15s;
  &:hover { background: var(--bg-elevated); color: var(--text-primary); }
  &.active { background: var(--primary-soft); color: var(--primary); font-weight: 700; }
  @media (max-width: 768px) { width: auto; flex: 1; min-width: 110px; justify-content: center; }
}

// ── Content ───────────────────────────────────────────────────────────────────
.settings-content {
  flex: 1; background: var(--bg-surface); border-radius: 16px; padding: 2rem;
  border: 1px solid var(--border-color); box-shadow: 0 2px 12px rgba(0,0,0,.05);
}

.settings-section { max-width: 640px; }

.section-head {
  display: flex; align-items: center; gap: .55rem; margin-bottom: 1.5rem;
  h2 { font-size: 1.05rem; font-weight: 700; color: var(--text-primary); margin: 0; }
  .iconify { color: var(--primary); }
}

// ── Sync banner ───────────────────────────────────────────────────────────────
.sync-status-banner {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  padding: 1rem 1.25rem; border-radius: 12px; margin-bottom: 1rem; flex-wrap: wrap;
  &.banner-online  { background: rgba(16,185,129,.08); border: 1px solid rgba(16,185,129,.2); }
  &.banner-offline { background: rgba(245,158,11,.08); border: 1px solid rgba(245,158,11,.2); }
}
.sync-banner-left { display: flex; align-items: center; gap: .75rem; }
.sync-banner-title { font-weight: 700; font-size: .88rem; color: var(--text-primary); margin: 0; }
.sync-banner-sub   { font-size: .76rem; color: var(--text-muted); margin: 0; display: flex; align-items: center; gap: .4rem; }
.pending-badge {
  display: inline-block; padding: .1rem .45rem; border-radius: 20px;
  background: rgba(245,158,11,.15); color: #f59e0b; font-weight: 700; font-size: .72rem;
}

.info-box {
  display: flex; align-items: flex-start; gap: .5rem;
  background: var(--bg-elevated); border: 1px solid var(--border-color); border-radius: 10px; padding: .85rem;
  color: var(--text-sub); font-size: .82rem; line-height: 1.55;
  .iconify { color: var(--primary); flex-shrink: 0; margin-top: .05rem; }
  p { margin: 0; }
}

// ── Appearance ────────────────────────────────────────────────────────────────
.appearance-grid { display: flex; flex-direction: column; gap: 1.5rem; }
.appearance-item { display: flex; flex-direction: column; gap: .6rem; }
.appearance-label { font-size: .8rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; margin: 0; }

.lang-toggle, .theme-toggle {
  display: inline-flex; border: 1px solid var(--border-color); border-radius: 10px; overflow: hidden;
}
.lang-btn, .theme-btn {
  display: flex; align-items: center; gap: .4rem;
  padding: .55rem 1.1rem; border: none; background: transparent;
  font-size: .85rem; font-weight: 500; color: var(--text-muted); cursor: pointer;
  transition: all .15s;
  &.active { background: var(--primary); color: #fff; font-weight: 700; }
  &:not(.active):hover { background: var(--bg-elevated); color: var(--text-primary); }
}

// ── About ─────────────────────────────────────────────────────────────────────
.about-card {
  text-align: center; padding: 2rem;
  background: var(--bg-elevated); border-radius: 16px; border: 1px solid var(--border-color);
}
.about-logo {
  width: 80px; height: 80px; border-radius: 20px; background: var(--primary-soft);
  color: var(--primary); display: flex; align-items: center; justify-content: center;
  margin: 0 auto 1rem;
}
.about-card h3 { font-size: 1.2rem; font-weight: 800; color: var(--text-primary); margin: 0 0 .35rem; }
.about-version { font-size: .82rem; color: var(--text-muted); margin: 0 0 1.5rem; }
.about-features { display: flex; flex-direction: column; gap: .5rem; text-align: start; max-width: 280px; margin: 0 auto; }
.feat-row {
  display: flex; align-items: center; gap: .5rem;
  font-size: .83rem; color: var(--text-sub); font-weight: 500;
  .iconify { color: var(--primary); }
}

@media (max-width: 768px) {
  .settings-page { padding: 1rem; }
  .settings-content { padding: 1.25rem; }
}
</style>
