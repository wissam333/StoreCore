<template>
  <div class="report-page">
    <div class="container-fluid">
      <SharedUiHeaderPage
        :title="$t('sidebar.visitsReport')"
        :subtitle="$t('visitsReportDesc')"
        icon="mdi:chart-line"
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
          <div class="col-md-6 d-flex gap-2 flex-wrap">
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
        <!-- KPI cards -->
        <div class="kpi-grid mb-4">
          <div v-for="kpi in kpiCards" :key="kpi.key" class="kpi-card">
            <div class="kpi-icon" :style="{ background: kpi.bg, color: kpi.color }">
              <Icon :name="kpi.icon" size="22" />
            </div>
            <div>
              <p class="kpi-label">{{ kpi.label }}</p>
              <p class="kpi-value">{{ kpi.value }}</p>
            </div>
          </div>
        </div>

        <!-- Daily trend -->
        <div class="surface-card mb-4">
          <h3 class="section-title">
            <Icon name="mdi:chart-line" size="16" />
            {{ $t("dailyVisitsTrend") }}
          </h3>
          <div v-if="!report.daily?.length" class="empty-chart">{{ $t("noData") }}</div>
          <div v-else class="line-area">
            <svg :viewBox="`0 0 ${svgW} ${svgH}`" preserveAspectRatio="none" class="trend-svg">
              <!-- area fill -->
              <path :d="areaPath" class="trend-area" />
              <!-- line -->
              <path :d="linePath" class="trend-line" />
              <!-- dots -->
              <circle
                v-for="(pt, i) in points"
                :key="i"
                :cx="pt.x" :cy="pt.y" r="3.5"
                class="trend-dot"
              >
                <title>{{ report.daily[i].day }}: {{ report.daily[i].total }}</title>
              </circle>
            </svg>
            <div class="x-labels">
              <span v-for="day in report.daily" :key="day.day" class="x-label">{{ shortDate(day.day) }}</span>
            </div>
          </div>
        </div>

        <div class="row g-4">
          <!-- Status breakdown -->
          <div class="col-md-6">
            <div class="surface-card h-100">
              <h3 class="section-title">
                <Icon name="mdi:chart-donut" size="16" />
                {{ $t("visitsByStatus") }}
              </h3>
              <div v-if="!report.byStatus?.length" class="empty-chart">{{ $t("noData") }}</div>
              <div v-else class="status-breakdown">
                <div v-for="s in report.byStatus" :key="s.status" class="sb-row">
                  <span class="sb-dot" :class="`dot-${s.status}`" />
                  <span class="sb-label">{{ $t(`visitStatus.${s.status}`) }}</span>
                  <div class="sb-bar-wrap">
                    <div class="sb-bar" :class="`bar-${s.status}`" :style="{ width: statusBarPct(s.total) + '%' }" />
                  </div>
                  <span class="sb-count">{{ s.total }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Top diagnoses -->
          <div class="col-md-6">
            <div class="surface-card h-100">
              <h3 class="section-title">
                <Icon name="mdi:stethoscope" size="16" />
                {{ $t("topDiagnoses") }}
              </h3>
              <div v-if="!report.topDiagnoses?.length" class="empty-chart">{{ $t("noData") }}</div>
              <div v-else class="diag-list">
                <div v-for="(d, i) in report.topDiagnoses" :key="d.diagnosis" class="diag-row">
                  <span class="diag-rank">#{{ i + 1 }}</span>
                  <span class="diag-name">{{ d.diagnosis }}</span>
                  <div class="sb-bar-wrap">
                    <div class="sb-bar bar-primary" :style="{ width: diagBarPct(d.total) + '%' }" />
                  </div>
                  <span class="sb-count">{{ d.total }}</span>
                </div>
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

const { t } = useI18n();
const { getVisitsReport } = useClinic();

const isLoading = ref(true);
const report    = ref({ daily: [], byStatus: [], topDiagnoses: [] });

const today = () => new Date().toISOString().slice(0, 10);
const dateFrom = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
const dateTo   = ref(today());

const setPreset = (p) => {
  const now = new Date();
  if (p === "today")  { dateFrom.value = dateTo.value = today(); }
  else if (p === "week") {
    const d = new Date(); d.setDate(d.getDate() - d.getDay());
    dateFrom.value = d.toISOString().slice(0, 10); dateTo.value = today();
  } else if (p === "month") {
    dateFrom.value = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10); dateTo.value = today();
  } else if (p === "year") {
    dateFrom.value = `${now.getFullYear()}-01-01`; dateTo.value = today();
  }
  loadReport();
};

const loadReport = async () => {
  isLoading.value = true;
  const r = await getVisitsReport({ dateFrom: dateFrom.value, dateTo: dateTo.value });
  if (r.ok) report.value = r.data;
  isLoading.value = false;
};

// KPIs
const totalVisits  = computed(() => report.value.daily?.reduce((s, d) => s + d.total, 0) ?? 0);
const openVisits   = computed(() => report.value.byStatus?.find(s => s.status === "open")?.total ?? 0);
const closedVisits = computed(() => report.value.byStatus?.find(s => s.status === "closed")?.total ?? 0);
const avgPerDay    = computed(() => report.value.daily?.length ? (totalVisits.value / report.value.daily.length).toFixed(1) : 0);

const kpiCards = computed(() => [
  { key: "total",   label: t("totalVisits"),   value: totalVisits.value,  icon: "mdi:format-list-checks",  bg: "rgba(59,130,246,.1)",  color: "#3b82f6" },
  { key: "closed",  label: t("closedVisits"),  value: closedVisits.value, icon: "mdi:check-circle-outline", bg: "rgba(16,185,129,.1)",  color: "#10b981" },
  { key: "open",    label: t("openVisits"),    value: openVisits.value,   icon: "mdi:clock-outline",        bg: "rgba(245,158,11,.1)",  color: "#f59e0b" },
  { key: "avg",     label: t("avgPerDay"),     value: avgPerDay.value,    icon: "mdi:trending-up",          bg: "rgba(234,28,36,.1)",   color: "var(--primary)" },
]);

// SVG trend line
const svgW = 600; const svgH = 120;
const maxDailyTotal = computed(() => Math.max(...(report.value.daily?.map(d => d.total) ?? [0]), 1));

const points = computed(() => {
  const data = report.value.daily ?? [];
  if (!data.length) return [];
  return data.map((d, i) => ({
    x: (i / Math.max(data.length - 1, 1)) * (svgW - 20) + 10,
    y: svgH - 10 - ((d.total / maxDailyTotal.value) * (svgH - 20)),
  }));
});

const linePath = computed(() => {
  if (!points.value.length) return "";
  return points.value.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
});

const areaPath = computed(() => {
  if (!points.value.length) return "";
  const pts = points.value;
  return `${linePath.value} L ${pts[pts.length - 1].x} ${svgH} L ${pts[0].x} ${svgH} Z`;
});

// Bar helpers
const maxStatus = computed(() => Math.max(...(report.value.byStatus?.map(s => s.total) ?? [0]), 1));
const maxDiag   = computed(() => Math.max(...(report.value.topDiagnoses?.map(d => d.total) ?? [0]), 1));
const statusBarPct = (v) => Math.max((v / maxStatus.value) * 100, 4);
const diagBarPct   = (v) => Math.max((v / maxDiag.value)   * 100, 4);

const shortDate = (d) => {
  const dt = new Date(d);
  return `${dt.getDate()}/${dt.getMonth() + 1}`;
};

onMounted(loadReport);
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

// SVG trend
.line-area { position: relative; }
.trend-svg { width: 100%; height: 130px; display: block; overflow: visible; }
.trend-area { fill: var(--primary); opacity: .08; }
.trend-line { fill: none; stroke: var(--primary); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.trend-dot { fill: var(--primary); }
.x-labels { display: flex; justify-content: space-between; padding: .25rem .5rem 0; }
.x-label  { font-size: .62rem; color: var(--text-muted); }

// Status breakdown
.status-breakdown, .diag-list { display: flex; flex-direction: column; gap: .75rem; }
.sb-row, .diag-row { display: flex; align-items: center; gap: .65rem; }

.sb-dot {
  width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
  &.dot-open     { background: #f59e0b; }
  &.dot-closed   { background: #10b981; }
  &.dot-followup { background: #3b82f6; }
}
.sb-label { font-size: .82rem; font-weight: 600; color: var(--text-primary); min-width: 70px; }
.sb-bar-wrap { flex: 1; height: 8px; background: var(--bg-elevated); border-radius: 4px; overflow: hidden; }
.sb-bar {
  height: 100%; border-radius: 4px; transition: width .4s ease;
  &.bar-open     { background: #f59e0b; }
  &.bar-closed   { background: #10b981; }
  &.bar-followup { background: #3b82f6; }
  &.bar-primary  { background: var(--primary); }
}
.sb-count { font-size: .82rem; font-weight: 800; color: var(--text-primary); min-width: 30px; text-align: end; }

.diag-rank { font-size: .75rem; font-weight: 800; color: var(--text-muted); width: 22px; text-align: center; flex-shrink: 0; }
.diag-name { font-size: .82rem; font-weight: 600; color: var(--text-primary); min-width: 120px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.h-100 { height: 100%; }

@media (max-width: 768px) { .report-page { padding: 1rem; } }
</style>
