<template>
  <div class="report-page">
    <div class="container-fluid">
      <SharedUiHeaderPage
        :title="$t('sidebar.revenueReport')"
        :subtitle="$t('revenueReportDesc')"
        icon="mdi:cash-multiple"
      />

      <!-- Date filters -->
      <div class="filters-section mb-4">
        <div class="row g-3 align-items-end">
          <div class="col-md-3">
            <SharedUiFormBaseInput v-model="dateFrom" :label="$t('from')" type="date" @update:model-value="loadReport" />
          </div>
          <div class="col-md-3">
            <SharedUiFormBaseInput v-model="dateTo" :label="$t('to')" type="date" @update:model-value="loadReport" />
          </div>
          <div class="col-md-6 d-flex gap-2">
            <SharedUiButtonBase variant="outline" size="sm" @click="setPreset('today')">{{ $t("today") }}</SharedUiButtonBase>
            <SharedUiButtonBase variant="outline" size="sm" @click="setPreset('week')">{{ $t("thisWeek") }}</SharedUiButtonBase>
            <SharedUiButtonBase variant="outline" size="sm" @click="setPreset('month')">{{ $t("thisMonth") }}</SharedUiButtonBase>
            <SharedUiButtonBase variant="outline" size="sm" @click="setPreset('year')">{{ $t("thisYear") }}</SharedUiButtonBase>
          </div>
        </div>
      </div>

      <div v-if="isLoading" class="loading-state">
        <Icon name="mdi:loading" size="36" class="spin" />
      </div>

      <div v-else>
        <!-- KPI Cards -->
        <div class="kpi-grid mb-4">
          <div class="kpi-card">
            <div class="kpi-icon" style="background: rgba(16,185,129,.1); color: #10b981;">
              <Icon name="mdi:cash-check" size="22" />
            </div>
            <div>
              <p class="kpi-label">{{ $t("totalRevenue") }}</p>
              <p class="kpi-value">{{ fmt(report.totals?.revenue ?? 0) }}</p>
            </div>
          </div>
          <div class="kpi-card">
            <div class="kpi-icon" style="background: rgba(59,130,246,.1); color: #3b82f6;">
              <Icon name="mdi:cash-multiple" size="22" />
            </div>
            <div>
              <p class="kpi-label">{{ $t("paidRevenue") }}</p>
              <p class="kpi-value">{{ fmt(report.totals?.paid ?? 0) }}</p>
            </div>
          </div>
          <div class="kpi-card">
            <div class="kpi-icon" style="background: rgba(245,158,11,.1); color: #f59e0b;">
              <Icon name="mdi:cash-clock" size="22" />
            </div>
            <div>
              <p class="kpi-label">{{ $t("unpaidRevenue") }}</p>
              <p class="kpi-value">{{ fmt(report.totals?.unpaid ?? 0) }}</p>
            </div>
          </div>
          <div class="kpi-card">
            <div class="kpi-icon" style="background: rgba(234,28,36,.1); color: var(--primary);">
              <Icon name="mdi:stethoscope" size="22" />
            </div>
            <div>
              <p class="kpi-label">{{ $t("totalVisits") }}</p>
              <p class="kpi-value">{{ report.totals?.visits ?? 0 }}</p>
            </div>
          </div>
        </div>

        <!-- Daily bar chart (pure CSS) -->
        <div class="surface-card mb-4">
          <h3 class="section-title">
            <Icon name="mdi:chart-bar" size="16" />
            {{ $t("dailyRevenue") }}
          </h3>
          <div v-if="!report.daily?.length" class="empty-chart">{{ $t("noData") }}</div>
          <div v-else class="bar-chart">
            <div
              v-for="day in report.daily"
              :key="day.day"
              class="bar-col"
              :title="`${day.day}: ${fmt(day.total)}`"
            >
              <div class="bar-fill" :style="{ height: barHeight(day.total) + '%' }" />
              <span class="bar-label">{{ shortDate(day.day) }}</span>
            </div>
          </div>
        </div>

        <!-- By doctor table -->
        <div class="surface-card">
          <h3 class="section-title">
            <Icon name="mdi:doctor" size="16" />
            {{ $t("revenueByDoctor") }}
          </h3>
          <div v-if="!report.byDoctor?.length" class="empty-chart">{{ $t("noData") }}</div>
          <div v-else class="doctor-table">
            <div v-for="(d, i) in report.byDoctor" :key="d.doctor" class="dt-row">
              <span class="dt-rank">#{{ i + 1 }}</span>
              <div class="dt-avatar">{{ d.doctor?.charAt(0) ?? "?" }}</div>
              <div class="dt-info">
                <p class="dt-name">{{ d.doctor || $t("unassigned") }}</p>
                <p class="dt-sub">{{ d.visits }} {{ $t("visits") }}</p>
              </div>
              <div class="dt-bar-wrap">
                <div class="dt-bar" :style="{ width: doctorBarPct(d.total) + '%' }" />
              </div>
              <span class="dt-val">{{ fmt(d.total) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
definePageMeta({ layout: "default" });

const { t } = useI18n();
const { getRevenueReport } = useClinic();
const { getSettings } = useClinic();

const isLoading = ref(true);
const report    = ref({ daily: [], byDoctor: [], totals: {} });
const currency  = ref("$");

const today = () => new Date().toISOString().slice(0, 10);
const dateFrom = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
const dateTo   = ref(today());

const setPreset = (p) => {
  const now = new Date();
  if (p === "today") { dateFrom.value = dateTo.value = today(); }
  else if (p === "week") {
    const d = new Date(); d.setDate(d.getDate() - d.getDay());
    dateFrom.value = d.toISOString().slice(0, 10); dateTo.value = today();
  } else if (p === "month") {
    dateFrom.value = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    dateTo.value = today();
  } else if (p === "year") {
    dateFrom.value = `${now.getFullYear()}-01-01`; dateTo.value = today();
  }
  loadReport();
};

const loadReport = async () => {
  isLoading.value = true;
  const r = await getRevenueReport({ dateFrom: dateFrom.value, dateTo: dateTo.value });
  if (r.ok) report.value = r.data;
  isLoading.value = false;
};

const maxRevenue = computed(() => Math.max(...(report.value.daily?.map(d => d.total) ?? [0]), 1));
const maxDoctor  = computed(() => Math.max(...(report.value.byDoctor?.map(d => d.total) ?? [0]), 1));
const barHeight  = (val) => Math.max((val / maxRevenue.value) * 100, 4);
const doctorBarPct = (val) => Math.max((val / maxDoctor.value) * 100, 4);

const fmt = (val) => `${currency.value}${Number(val ?? 0).toFixed(2)}`;
const shortDate = (d) => {
  const dt = new Date(d);
  return `${dt.getDate()}/${dt.getMonth() + 1}`;
};

onMounted(async () => {
  const s = await getSettings();
  if (s.ok) currency.value = s.data?.currency === "USD" ? "$" : (s.data?.currency ?? "$");
  loadReport();
});
</script>

<style lang="scss" scoped>
.report-page { padding: 2rem; min-height: 100vh; background: var(--bg-page); }

.filters-section, .surface-card {
  background: var(--bg-surface); border-radius: 16px; padding: 1.5rem;
  box-shadow: 0 2px 12px rgba(0,0,0,.05); border: 1px solid var(--border-color);
}

.loading-state { display: flex; justify-content: center; padding: 5rem; color: var(--primary); }
.spin { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

// KPI
.kpi-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem;
  @media (max-width: 1000px) { grid-template-columns: repeat(2, 1fr); }
  @media (max-width: 500px)  { grid-template-columns: 1fr; }
}
.kpi-card {
  background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 16px;
  padding: 1.2rem; display: flex; align-items: center; gap: 1rem;
  box-shadow: 0 2px 8px rgba(0,0,0,.04);
}
.kpi-icon {
  width: 48px; height: 48px; border-radius: 14px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.kpi-label { font-size: .74rem; color: var(--text-muted); margin: 0 0 .2rem; text-transform: uppercase; letter-spacing: .04em; font-weight: 600; }
.kpi-value { font-size: 1.45rem; font-weight: 800; color: var(--text-primary); margin: 0; }

.section-title {
  display: flex; align-items: center; gap: .45rem;
  font-size: .88rem; font-weight: 700; color: var(--text-primary);
  margin: 0 0 1.25rem; text-transform: uppercase; letter-spacing: .05em;
  .iconify { color: var(--primary); }
}

.empty-chart { text-align: center; padding: 2rem; color: var(--text-muted); font-size: .88rem; }

// Bar Chart
.bar-chart {
  display: flex; align-items: flex-end; gap: 4px; height: 160px;
  overflow-x: auto; padding-bottom: .5rem;
}
.bar-col {
  display: flex; flex-direction: column; align-items: center;
  min-width: 28px; flex: 1; max-width: 48px; height: 100%;
  justify-content: flex-end; gap: .3rem;
}
.bar-fill {
  width: 100%; background: var(--primary); border-radius: 6px 6px 0 0;
  transition: height .3s ease; min-height: 4px;
  opacity: .85; &:hover { opacity: 1; }
}
.bar-label { font-size: .62rem; color: var(--text-muted); white-space: nowrap; }

// Doctor table
.doctor-table { display: flex; flex-direction: column; gap: .65rem; }
.dt-row {
  display: flex; align-items: center; gap: .75rem;
  padding: .6rem .85rem; border-radius: 10px; background: var(--bg-elevated);
}
.dt-rank { font-size: .78rem; font-weight: 800; color: var(--text-muted); width: 20px; text-align: center; }
.dt-avatar {
  width: 32px; height: 32px; border-radius: 50%; background: var(--primary);
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: .8rem; flex-shrink: 0;
}
.dt-info { min-width: 120px; }
.dt-name { font-weight: 600; font-size: .85rem; color: var(--text-primary); margin: 0; }
.dt-sub  { font-size: .72rem; color: var(--text-muted); margin: 0; }
.dt-bar-wrap {
  flex: 1; height: 8px; background: var(--bg-page); border-radius: 4px; overflow: hidden;
}
.dt-bar {
  height: 100%; background: var(--primary); border-radius: 4px;
  transition: width .4s ease;
}
.dt-val { font-size: .85rem; font-weight: 800; color: var(--text-primary); white-space: nowrap; min-width: 60px; text-align: end; }

@media (max-width: 768px) { .report-page { padding: 1rem; } }
</style>
