<!-- store-app/pages/dashboard/reports/revenue.vue -->
<template>
  <div>
    <SharedUiHeaderPage
      :title="$t('sidebar.revenueReport')"
      icon="mdi:cash-multiple"
      :is-rtl="locale === 'ar'"
    />

    <!-- Filters -->
    <div class="filters-row">
      <SharedUiFormBaseInput
        v-model="dateFrom"
        type="date"
        :label="$t('from')"
        class="filter-date"
      />
      <SharedUiFormBaseInput
        v-model="dateTo"
        type="date"
        :label="$t('to')"
        class="filter-date"
      />
      <SharedUiButtonBase
        icon-left="mdi:refresh"
        :loading="loading"
        @click="load"
      >
        {{ $t("refresh") }}
      </SharedUiButtonBase>
      <div class="currency-note">
        <Icon name="mdi:information-outline" size="14" />
        {{ $t("reportIn") }}:
        <strong>{{ reportData?.reportCurrency ?? "…" }}</strong>
        <NuxtLink to="/dashboard/settings" class="change-link">{{
          $t("change")
        }}</NuxtLink>
      </div>
    </div>

    <!-- KPI cards -->
    <SharedUiCardsStats v-if="reportData" :stats="kpiCards" :columns="2" />

    <!-- Daily revenue chart -->
    <div v-if="reportData?.daily?.length" class="section-card">
      <div class="section-title">{{ $t("dailyRevenue") }}</div>
      <div class="chart-scroll">
        <div class="bar-chart" :style="{ minWidth: barChartMinWidth }">
          <div
            v-for="d in reportData.daily"
            :key="d.day"
            class="bar-col"
            :title="`${d.day}: ${fmt(d.paid)}`"
          >
            <div
              class="bar-fill"
              :style="{ height: barPct(d.paid) + '%' }"
            ></div>
            <span class="bar-label">{{ d.day.slice(5) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Top products -->
    <div v-if="reportData?.topProducts?.length" class="section-card">
      <div class="section-title">{{ $t("topProducts") }}</div>
      <SharedUiTableDataTable
        :columns="productCols"
        :data="reportData.topProducts"
        empty-text="noData"
      >
        <template #cell-total="{ row }">{{ fmt(row.total) }}</template>
      </SharedUiTableDataTable>
    </div>

    <!-- By status -->
    <div v-if="reportData?.byStatus?.length" class="section-card">
      <div class="section-title">{{ $t("byStatus") }}</div>
      <div class="status-list">
        <div
          v-for="s in reportData.byStatus"
          :key="s.status"
          class="status-row"
        >
          <span
            class="badge"
            :class="statusClass(s.status)"
            style="min-width: 90px"
          >
            {{ $t("order." + s.status) }}
          </span>
          <div class="bar-track">
            <div
              class="bar-progress"
              :style="{
                width: statusPct(s.count) + '%',
                background: statusColor(s.status),
              }"
            ></div>
          </div>
          <span class="status-count">{{ s.count }} {{ $t("orders") }}</span>
          <span class="status-amount">{{
            fmt(
              s.total_sp /
                (reportData.reportCurrency === "USD" ? dollarRate : 1),
            )
          }}</span>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <SharedUiFeedbackEmptyState
      v-if="reportData && !reportData.daily?.length"
      icon="mdi:chart-bar"
      title="noReportData"
      description="tryChangingDateRange"
      size="md"
    />
  </div>
</template>

<script setup>
definePageMeta({
  searchMeta: {
    label: "Revenue Report",
    labelAr: "تقرير الإيرادات",
    icon: "mdi:cash-multiple",
    group: "Reports",
  },
});

const { locale } = useI18n();
const { t: $t } = useI18n();
const { getRevenueReport } = useStore();
const { fmt, fmtSP, dollarRate, loadSettings } = useCurrency();

const today = new Date().toISOString().slice(0, 10);
const firstOfMonth = today.slice(0, 7) + "-01";
const dateFrom = ref(firstOfMonth);
const dateTo = ref(today);
const loading = ref(false);
const reportData = ref(null);

const productCols = [
  { key: "product_name", label: "product" },
  { key: "qty", label: "qty" },
  { key: "total", label: "revenue", align: "end" },
];

const kpiCards = computed(() => {
  if (!reportData.value) return [];
  const t = reportData.value.totals;
  return [
    {
      key: "revenue",
      label: "stats.totalRevenue",
      value: t.revenue,
      icon: "mdi:cash-multiple",
      color: "success",
      formatter: (v) => fmt(v),
    },
    {
      key: "orders",
      label: "stats.totalOrders",
      value: t.orders,
      icon: "mdi:receipt-text-outline",
      color: "primary",
    },
    {
      key: "paid",
      label: "stats.paidRevenue",
      value: t.paid,
      icon: "mdi:check-circle-outline",
      color: "success",
      formatter: (v) => fmt(v),
    },
    {
      key: "unpaid",
      label: "stats.unpaidRevenue",
      value: t.unpaid,
      icon: "mdi:clock-alert-outline",
      color: "warning",
      formatter: (v) => fmt(v),
    },
  ];
});

const maxPaid = computed(() =>
  Math.max(1, ...(reportData.value?.daily?.map((d) => d.paid) ?? [0])),
);
const barPct = (v) => Math.max(4, (v / maxPaid.value) * 100);
const barChartMinWidth = computed(
  () => `${Math.max((reportData.value?.daily?.length ?? 0) * 36, 300)}px`,
);

const totalOrders = computed(
  () => reportData.value?.byStatus?.reduce((s, x) => s + x.count, 0) || 1,
);
const statusPct = (c) => (c / totalOrders.value) * 100;
const statusClass = (s) =>
  ({
    pending: "badge-warning",
    partly_paid: "badge-info",
    paid: "badge-success",
  }[s] ?? "");
const statusColor = (s) =>
  ({ pending: "#f59e0b", partly_paid: "#06b6d4", paid: "#10b981" }[s] ??
  "#94a3b8");

const load = async () => {
  loading.value = true;
  const r = await getRevenueReport({
    dateFrom: dateFrom.value,
    dateTo: dateTo.value,
  });
  if (r.ok) reportData.value = r.data;
  loading.value = false;
};

onMounted(async () => {
  await loadSettings();
  load();
});

watch(useSyncTick(), () => load());
</script>

<style lang="scss" scoped>
.filters-row {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
  margin-bottom: 1.5rem;
}
.filter-date {
  width: 160px;
}
.currency-note {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--text-muted);
  background: var(--bg-elevated);
  padding: 8px 12px;
  border-radius: 8px;
  flex-wrap: wrap;
}
.change-link {
  color: var(--primary);
  cursor: pointer;
  text-decoration: underline;
  margin-inline-start: 4px;
}

.section-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  // Prevent overflow from leaking to page level
  overflow: hidden;
  min-width: 0;
}
.section-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 1.25rem;
}

// ── Bar chart — scrollable container ─────────────────────────────────────────
.chart-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 8px;
  // Custom scrollbar
  &::-webkit-scrollbar {
    height: 4px;
  }
  &::-webkit-scrollbar-track {
    background: var(--bg-elevated);
    border-radius: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background: var(--border-color);
    border-radius: 4px;
  }
}
.bar-chart {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 140px;
  padding-bottom: 24px; // space for labels
}
.bar-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 30px;
  height: 100%;
  justify-content: flex-end;
  position: relative;
}
.bar-fill {
  width: 22px;
  background: var(--primary);
  border-radius: 4px 4px 0 0;
  transition: height 0.3s;
  min-height: 4px;
}
.bar-label {
  font-size: 0.62rem;
  color: var(--text-muted);
  position: absolute;
  bottom: 0;
  white-space: nowrap;
}

// ── Status bars ───────────────────────────────────────────────────────────────
.status-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.status-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: nowrap; // keep in one line on desktop
  @media (max-width: 576px) {
    flex-wrap: wrap;
  }
}
.bar-track {
  flex: 1;
  min-width: 60px;
  height: 8px;
  background: var(--bg-elevated);
  border-radius: 4px;
  overflow: hidden;
}
.bar-progress {
  height: 100%;
  border-radius: 4px;
  transition: width 0.4s;
}
.status-count {
  font-size: 0.8rem;
  color: var(--text-muted);
  min-width: 72px;
  text-align: end;
  white-space: nowrap;
}
.status-amount {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
  min-width: 100px;
  text-align: end;
  white-space: nowrap;
}

.badge {
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
  text-align: center;
  display: inline-block;
}
.badge-warning {
  background: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
}
.badge-info {
  background: rgba(6, 182, 212, 0.1);
  color: #06b6d4;
}
.badge-success {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
}
</style>
