<!-- store-app/pages/dashboard/reports/revenue.vue -->
<template>
  <div>
    <SharedUiHeaderPage
      :title="$t('sidebar.revenueReport')"
      icon="mdi:chart-bar"
      :is-rtl="locale === 'ar'"
    />

    <!-- ── Filters ──────────────────────────────────────────────────────── -->
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

    <!-- ── KPI Row ──────────────────────────────────────────────────────── -->
    <div v-if="reportData" class="kpi-grid">
      <!-- Order Value -->
      <div class="kpi-card kpi-neutral">
        <div class="kpi-icon">
          <Icon name="mdi:receipt-text-outline" size="22" />
        </div>
        <div class="kpi-body">
          <div class="kpi-label">{{ $t("stats.orderValue") }}</div>
          <div class="kpi-value">{{ fmt(reportData.totals.orderValue) }}</div>
          <div class="kpi-sub">
            {{ reportData.totals.orders }} {{ $t("orders") }}
          </div>
        </div>
      </div>

      <!-- Collected (actual cash received) -->
      <div class="kpi-card kpi-success">
        <div class="kpi-icon"><Icon name="mdi:cash-check" size="22" /></div>
        <div class="kpi-body">
          <div class="kpi-label">{{ $t("stats.collected") }}</div>
          <div class="kpi-value">{{ fmt(reportData.totals.collected) }}</div>
          <div class="kpi-sub">{{ $t("actualCashReceived") }}</div>
        </div>
      </div>

      <!-- Outstanding -->
      <div class="kpi-card kpi-warning">
        <div class="kpi-icon">
          <Icon name="mdi:clock-alert-outline" size="22" />
        </div>
        <div class="kpi-body">
          <div class="kpi-label">{{ $t("stats.outstanding") }}</div>
          <div class="kpi-value">{{ fmt(reportData.totals.outstanding) }}</div>
          <div class="kpi-sub">{{ $t("uncollectedYet") }}</div>
        </div>
      </div>

      <!-- Cost -->
      <div class="kpi-card kpi-danger">
        <div class="kpi-icon">
          <Icon name="mdi:package-variant" size="22" />
        </div>
        <div class="kpi-body">
          <div class="kpi-label">{{ $t("stats.cost") }}</div>
          <div class="kpi-value">{{ fmt(reportData.totals.cost) }}</div>
          <div class="kpi-sub">{{ $t("costOfGoodsSold") }}</div>
        </div>
      </div>

      <!-- Profit -->
      <div
        class="kpi-card"
        :class="reportData.totals.profit >= 0 ? 'kpi-profit' : 'kpi-loss'"
      >
        <div class="kpi-icon"><Icon name="mdi:trending-up" size="22" /></div>
        <div class="kpi-body">
          <div class="kpi-label">{{ $t("stats.profit") }}</div>
          <div class="kpi-value">{{ fmt(reportData.totals.profit) }}</div>
          <div class="kpi-sub">{{ profitMarginPct }}% {{ $t("margin") }}</div>
        </div>
      </div>

      <!-- Collection Rate -->
      <div class="kpi-card kpi-info">
        <div class="kpi-icon"><Icon name="mdi:percent" size="22" /></div>
        <div class="kpi-body">
          <div class="kpi-label">{{ $t("collectionRate") }}</div>
          <div class="kpi-value">{{ collectionRatePct }}%</div>
          <div class="kpi-sub">{{ $t("ofOrderValueCollected") }}</div>
        </div>
      </div>
    </div>

    <!-- ── Status Breakdown ─────────────────────────────────────────────── -->
    <div v-if="reportData" class="section-card">
      <div class="section-title">
        <Icon name="mdi:chart-donut" size="18" />
        {{ $t("orderStatusBreakdown") }}
      </div>
      <div class="status-breakdown-grid">
        <div class="status-block status-paid">
          <div class="status-block-label">{{ $t("order.paid") }}</div>
          <div class="status-block-value">
            {{ fmt(reportData.totals.fullyPaid) }}
          </div>
          <div class="status-block-count">
            {{
              reportData.byStatus.find((s) => s.status === "paid")?.count ?? 0
            }}
            {{ $t("orders") }}
          </div>
        </div>
        <div class="status-block status-partial">
          <div class="status-block-label">{{ $t("order.partly_paid") }}</div>
          <div class="status-block-value">
            {{ fmt(reportData.totals.partlyPaid) }}
          </div>
          <div class="status-block-count">
            {{
              reportData.byStatus.find((s) => s.status === "partly_paid")
                ?.count ?? 0
            }}
            {{ $t("orders") }}
          </div>
        </div>
        <div class="status-block status-pending">
          <div class="status-block-label">{{ $t("order.pending") }}</div>
          <div class="status-block-value">
            {{ fmt(reportData.totals.pending) }}
          </div>
          <div class="status-block-count">
            {{
              reportData.byStatus.find((s) => s.status === "pending")?.count ??
              0
            }}
            {{ $t("orders") }}
          </div>
        </div>
      </div>
    </div>

    <!-- ── Daily Collections Chart ──────────────────────────────────────── -->
    <div v-if="reportData?.daily?.length" class="section-card">
      <div class="section-title">
        <Icon name="mdi:chart-bar" size="18" />
        {{ $t("dailyCollections") }}
      </div>
      <div class="chart-scroll">
        <div class="bar-chart" :style="{ minWidth: barChartMinWidth }">
          <div
            v-for="d in reportData.daily"
            :key="d.day"
            class="bar-col"
            :title="`${d.day}: ${fmt(d.collected)}`"
          >
            <div
              class="bar-fill"
              :style="{ height: barPct(d.collected) + '%' }"
            ></div>
            <span class="bar-label">{{ d.day.slice(5) }}</span>
            <span class="bar-tooltip">{{ fmt(d.collected) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Top Products ─────────────────────────────────────────────────── -->
    <div v-if="reportData?.topProducts?.length" class="section-card">
      <div class="section-title">
        <Icon name="mdi:trophy-outline" size="18" />
        {{ $t("topProducts") }}
      </div>
      <div class="products-table-wrap">
        <table class="products-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{{ $t("product") }}</th>
              <th class="text-end">{{ $t("qty") }}</th>
              <th class="text-end">{{ $t("revenue") }}</th>
              <th class="text-end">{{ $t("cost") }}</th>
              <th class="text-end">{{ $t("profit") }}</th>
              <th class="text-end">{{ $t("margin") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(p, idx) in reportData.topProducts"
              :key="p.product_name"
              :class="idx === 0 ? 'top-row' : ''"
            >
              <td>
                <span v-if="idx === 0" class="rank-medal gold">🥇</span>
                <span v-else-if="idx === 1" class="rank-medal">🥈</span>
                <span v-else-if="idx === 2" class="rank-medal">🥉</span>
                <span v-else class="rank-num">{{ idx + 1 }}</span>
              </td>
              <td class="product-name-cell">{{ p.product_name }}</td>
              <td class="text-end">{{ p.qty }}</td>
              <td class="text-end text-primary">{{ fmt(p.revenue) }}</td>
              <td class="text-end text-muted">{{ fmt(p.cost) }}</td>
              <td
                class="text-end"
                :class="p.profit >= 0 ? 'text-success' : 'text-danger'"
              >
                {{ fmt(p.profit) }}
              </td>
              <td class="text-end">
                <span class="margin-badge" :class="productMarginClass(p)">
                  {{ productMarginPct(p) }}%
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── Status bar chart ─────────────────────────────────────────────── -->
    <div v-if="reportData?.byStatus?.length" class="section-card">
      <div class="section-title">
        <Icon name="mdi:chart-timeline-variant" size="18" />
        {{ $t("byStatus") }}
      </div>
      <div class="status-list">
        <div
          v-for="s in reportData.byStatus"
          :key="s.status"
          class="status-row"
        >
          <span
            class="badge"
            :class="statusClass(s.status)"
            style="min-width: 100px"
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
      v-if="
        !loading &&
        reportData &&
        !reportData.daily?.length &&
        !reportData.topProducts?.length
      "
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
    icon: "mdi:chart-bar",
    group: "Reports",
  },
});

const { locale } = useI18n();
const { t: $t } = useI18n();
const { getRevenueReport } = useStore();
const { fmt, dollarRate, loadSettings } = useCurrency();

const today = new Date().toISOString().slice(0, 10);
const firstOfMonth = today.slice(0, 7) + "-01";
const dateFrom = ref(firstOfMonth);
const dateTo = ref(today);
const loading = ref(false);
const reportData = ref(null);

// ── Computed stats ────────────────────────────────────────────────────────────
const profitMarginPct = computed(() => {
  const t = reportData.value?.totals;
  if (!t || !t.collected || t.collected === 0) return 0;
  return Math.round((t.profit / t.collected) * 100);
});

const collectionRatePct = computed(() => {
  const t = reportData.value?.totals;
  if (!t || !t.orderValue || t.orderValue === 0) return 0;
  return Math.min(100, Math.round((t.collected / t.orderValue) * 100));
});

// ── Chart helpers ─────────────────────────────────────────────────────────────
const maxCollected = computed(() =>
  Math.max(1, ...(reportData.value?.daily?.map((d) => d.collected) ?? [0])),
);
const barPct = (v) => Math.max(4, (v / maxCollected.value) * 100);
const barChartMinWidth = computed(
  () => `${Math.max((reportData.value?.daily?.length ?? 0) * 38, 300)}px`,
);

// ── Status helpers ────────────────────────────────────────────────────────────
const totalOrders = computed(
  () => reportData.value?.byStatus?.reduce((s, x) => s + x.count, 0) || 1,
);
const statusPct = (c) => Math.max(2, (c / totalOrders.value) * 100);
const statusClass = (s) =>
  ({
    pending: "badge-warning",
    partly_paid: "badge-info",
    paid: "badge-success",
  }[s] ?? "");
const statusColor = (s) =>
  ({ pending: "#f59e0b", partly_paid: "#06b6d4", paid: "#10b981" }[s] ??
  "#94a3b8");

// ── Product helpers ───────────────────────────────────────────────────────────
const productMarginPct = (p) => {
  if (!p.revenue || p.revenue === 0) return 0;
  return Math.round((p.profit / p.revenue) * 100);
};
const productMarginClass = (p) => {
  const pct = productMarginPct(p);
  if (pct >= 30) return "margin-high";
  if (pct >= 10) return "margin-mid";
  if (pct >= 0) return "margin-low";
  return "margin-neg";
};

// ── Load ──────────────────────────────────────────────────────────────────────
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
// ── Filters ───────────────────────────────────────────────────────────────────
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

// ── KPI grid ──────────────────────────────────────────────────────────────────
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.kpi-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 1.1rem 1.25rem;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  border-left: 4px solid transparent;
  transition: transform 0.15s, box-shadow 0.15s;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  }

  &.kpi-neutral {
    border-left-color: var(--primary);
  }
  &.kpi-success {
    border-left-color: #10b981;
  }
  &.kpi-warning {
    border-left-color: #f59e0b;
  }
  &.kpi-danger {
    border-left-color: #ef4444;
  }
  &.kpi-profit {
    border-left-color: #10b981;
  }
  &.kpi-loss {
    border-left-color: #ef4444;
  }
  &.kpi-info {
    border-left-color: #06b6d4;
  }
}

.kpi-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: var(--bg-elevated);
  color: var(--text-sub);
}

.kpi-neutral .kpi-icon {
  background: var(--primary-soft);
  color: var(--primary);
}
.kpi-success .kpi-icon {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
}
.kpi-warning .kpi-icon {
  background: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
}
.kpi-danger .kpi-icon {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}
.kpi-profit .kpi-icon {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
}
.kpi-loss .kpi-icon {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}
.kpi-info .kpi-icon {
  background: rgba(6, 182, 212, 0.1);
  color: #06b6d4;
}

.kpi-body {
  flex: 1;
  min-width: 0;
}

.kpi-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.kpi-value {
  font-size: 1rem;
  font-weight: 800;
  color: var(--text-primary);
  line-height: 1.2;
  margin-bottom: 3px;
}

.kpi-sub {
  font-size: 0.68rem;
  color: var(--text-muted);
}

// ── Status breakdown ──────────────────────────────────────────────────────────
.status-breakdown-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
}

.status-block {
  padding: 1rem;
  border-radius: 12px;
  border: 1px solid transparent;
  text-align: center;

  &.status-paid {
    background: rgba(16, 185, 129, 0.06);
    border-color: rgba(16, 185, 129, 0.2);
  }
  &.status-partial {
    background: rgba(6, 182, 212, 0.06);
    border-color: rgba(6, 182, 212, 0.2);
  }
  &.status-pending {
    background: rgba(245, 158, 11, 0.06);
    border-color: rgba(245, 158, 11, 0.2);
  }
}

.status-block-label {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.status-block-value {
  font-size: 1.1rem;
  font-weight: 800;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.status-block-count {
  font-size: 0.72rem;
  color: var(--text-muted);
}

// ── Section card ──────────────────────────────────────────────────────────────
.section-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  min-width: 0;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 1.25rem;
}

// ── Bar chart ─────────────────────────────────────────────────────────────────
.chart-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 8px;
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
  height: 150px;
  padding-bottom: 24px;
}

.bar-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 32px;
  height: 100%;
  justify-content: flex-end;
  position: relative;

  &:hover .bar-tooltip {
    opacity: 1;
    transform: translateY(0);
  }
}

.bar-fill {
  width: 24px;
  background: linear-gradient(180deg, var(--primary), rgba(234, 28, 36, 0.6));
  border-radius: 4px 4px 0 0;
  transition: height 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  min-height: 4px;
}

.bar-label {
  font-size: 0.6rem;
  color: var(--text-muted);
  position: absolute;
  bottom: 0;
  white-space: nowrap;
}

.bar-tooltip {
  position: absolute;
  top: -4px;
  transform: translateY(-4px);
  background: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 3px 6px;
  font-size: 0.65rem;
  white-space: nowrap;
  color: var(--text-primary);
  font-weight: 600;
  opacity: 0;
  transition: opacity 0.15s, transform 0.15s;
  pointer-events: none;
  z-index: 10;
}

// ── Top products table ────────────────────────────────────────────────────────
.products-table-wrap {
  overflow-x: auto;
}

.products-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0 4px;
  font-size: 0.85rem;

  thead th {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    padding: 6px 10px;
    text-align: start;
  }

  tbody tr {
    background: var(--bg-elevated);
    border-radius: 8px;
    transition: background 0.15s;

    &:hover {
      background: var(--primary-soft);
    }

    &.top-row {
      background: rgba(16, 185, 129, 0.06);
    }
  }

  td {
    padding: 10px 10px;
    color: var(--text-primary);

    &:first-child {
      border-radius: 8px 0 0 8px;
    }
    &:last-child {
      border-radius: 0 8px 8px 0;
    }
  }
}

.text-end {
  text-align: end;
}
.text-primary {
  color: var(--primary) !important;
}
.text-muted {
  color: var(--text-muted) !important;
}
.text-success {
  color: #10b981 !important;
}
.text-danger {
  color: #ef4444 !important;
}

.rank-medal {
  font-size: 1rem;
}
.rank-num {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-weight: 700;
}

.product-name-cell {
  font-weight: 600;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.margin-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 20px;
  font-size: 0.7rem;
  font-weight: 700;

  &.margin-high {
    background: rgba(16, 185, 129, 0.1);
    color: #10b981;
  }
  &.margin-mid {
    background: rgba(6, 182, 212, 0.1);
    color: #06b6d4;
  }
  &.margin-low {
    background: rgba(245, 158, 11, 0.1);
    color: #f59e0b;
  }
  &.margin-neg {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
  }
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
  flex-wrap: nowrap;

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
  transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
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
  min-width: 110px;
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
