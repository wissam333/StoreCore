<!-- store-app/pages/dashboard/reports/dues.vue -->
<template>
  <div>
    <SharedUiHeaderPage
      :title="$t('sidebar.duesReport')"
      icon="mdi:currency-usd-off"
      :is-rtl="locale === 'ar'"
    />

    <div class="filters-row">
      <SharedUiFormBaseInput
        v-model="dateFrom"
        type="date"
        :label="$t('from')"
      />
      <SharedUiFormBaseInput v-model="dateTo" type="date" :label="$t('to')" />
      <SharedUiButtonBase
        icon-left="mdi:refresh"
        :loading="loading"
        @click="load"
        >{{ $t("refresh") }}</SharedUiButtonBase
      >
    </div>

    <!-- KPI cards -->
    <SharedUiCardsStats v-if="report" :stats="kpiCards" :columns="2" />

    <!-- Top debtors -->
    <div v-if="report?.topDebtors?.length" class="section-card">
      <div class="section-title">{{ $t("topDebtors") }}</div>
      <div class="debtors-list">
        <div v-for="(d, i) in report.topDebtors" :key="i" class="debtor-row">
          <div class="rank">{{ i + 1 }}</div>
          <div class="debtor-avatar">
            {{ d.name?.charAt(0)?.toUpperCase() }}
          </div>
          <div class="debtor-info">
            <span class="debtor-name">{{ d.name }}</span>
            <span class="debtor-phone">{{ d.phone || "—" }}</span>
          </div>
          <div class="debtor-bar-wrap">
            <div
              class="debtor-bar"
              :style="{ width: debtorPct(d.total) + '%' }"
            ></div>
          </div>
          <div class="debtor-amount">{{ fmt(d.total) }}</div>
        </div>
      </div>
    </div>

    <SharedUiFeedbackEmptyState
      v-else-if="report && !report.topDebtors?.length"
      icon="mdi:check-circle-outline"
      title="noDues"
      description="noDuesDesc"
      size="md"
    />
  </div>
</template>

<script setup>
definePageMeta({
  searchMeta: {
    label: "Dues Report",
    labelAr: "تقرير الديون",
    icon: "mdi:cash",
    group: "Reports",
  },
});
const { locale } = useI18n();
const { t: $t } = useI18n();
const { getDuesReport } = useStore();
const { fmt, fmtSP, loadSettings } = useCurrency();

const today = new Date().toISOString().slice(0, 10);
const firstOfMonth = today.slice(0, 7) + "-01";
const dateFrom = ref(firstOfMonth);
const dateTo = ref(today);
const loading = ref(false);
const report = ref(null);

const kpiCards = computed(() => {
  if (!report.value) return [];
  return [
    {
      key: "unpaid",
      label: "stats.unpaidDues",
      value: report.value.unpaid,
      icon: "mdi:cash-clock",
      color: "danger",
      formatter: (v) => fmt(v),
    },
    {
      key: "unpaidCount",
      label: "stats.unpaidCount",
      value: report.value.unpaidCount,
      icon: "mdi:alert-circle-outline",
      color: "warning",
    },
    {
      key: "paid",
      label: "stats.paidDues",
      value: report.value.paid,
      icon: "mdi:check-circle-outline",
      color: "success",
      formatter: (v) => fmt(v),
    },
    {
      key: "paidCount",
      label: "stats.paidCount",
      value: report.value.paidCount,
      icon: "mdi:receipt-text-check-outline",
      color: "info",
    },
  ];
});

const maxDebt = computed(() =>
  Math.max(...(report.value?.topDebtors?.map((d) => d.total) ?? [1])),
);
const debtorPct = (v) => Math.max(4, (v / maxDebt.value) * 100);

const load = async () => {
  loading.value = true;
  const r = await getDuesReport({
    dateFrom: dateFrom.value,
    dateTo: dateTo.value,
  });
  if (r.ok) report.value = r.data;
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
.section-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 1.5rem;
}
.section-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 1.25rem;
}
.debtors-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.debtor-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.rank {
  width: 24px;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-muted);
  text-align: center;
}
.debtor-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--primary-soft);
  color: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  flex-shrink: 0;
}
.debtor-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 120px;
}
.debtor-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
}
.debtor-phone {
  font-size: 0.75rem;
  color: var(--text-muted);
}
.debtor-bar-wrap {
  flex: 1;
  height: 8px;
  background: var(--bg-elevated);
  border-radius: 4px;
  overflow: hidden;
}
.debtor-bar {
  height: 100%;
  background: #ef4444;
  border-radius: 4px;
  transition: width 0.4s;
}
.debtor-amount {
  font-weight: 700;
  color: #ef4444;
  font-size: 0.9rem;
  min-width: 100px;
  text-align: end;
}
</style>
