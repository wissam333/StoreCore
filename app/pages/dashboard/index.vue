<!-- store-app/pages/dashboard/index.vue -->
<template>
  <div>
    <!-- ── Stats grid ─────────────────────────────────────────────────────── -->
    <div class="stats-grid">
      <div
        v-for="(card, i) in statCards"
        :key="card.key"
        class="stat-card"
        :class="[`accent-${card.color}`, { clickable: !!card.onClick }]"
        :style="{ animationDelay: `${i * 60}ms` }"
        @click="card.onClick?.()"
      >
        <div class="stat-card__top">
          <div class="stat-card__icon">
            <Icon :name="card.icon" size="20" />
          </div>
          <span class="stat-card__label">{{ $t(card.label) }}</span>
        </div>
        <div class="stat-card__value">
          <span v-if="loading" class="skeleton-val" />
          <template v-else>
            {{ card.formatter ? card.formatter(card.value) : card.value }}
          </template>
        </div>
        <div v-if="card.description" class="stat-card__desc">
          {{ card.description }}
        </div>
        <div v-if="card.onClick" class="stat-card__cta">
          <Icon name="mdi:arrow-right" size="12" />
          {{ $t("clickToView") }}
        </div>
      </div>
    </div>

    <!-- ── Order Status Quick Filter ─────────────────────────────────────── -->
    <div class="status-pills-row">
      <button
        v-for="s in orderStatuses"
        :key="s.value"
        class="status-pill"
        :class="[s.class, { active: activeStatus === s.value }]"
        @click="toggleStatus(s.value)"
      >
        <span class="pill-dot" />
        {{ $t("order." + s.value) }}
        <span class="pill-count">{{ statusCounts[s.value] ?? 0 }}</span>
      </button>
      <button
        v-if="activeStatus"
        class="status-pill pill-clear"
        @click="clearStatus"
      >
        <Icon name="mdi:close" size="12" />
        {{ $t("clearFilter") }}
      </button>
    </div>

    <!-- ── Low stock alert ────────────────────────────────────────────────── -->
    <Transition name="fade-slide">
      <div v-if="lowStockProducts.length" class="alert-section mt-4">
        <div class="section-head">
          <div class="section-head__icon warn">
            <Icon name="mdi:alert-circle-outline" size="16" />
          </div>
          <h3 class="section-title">{{ $t("lowStockAlert") }}</h3>
          <span class="badge-count warn">{{ lowStockProducts.length }}</span>
        </div>
        <div class="low-stock-grid">
          <div v-for="p in lowStockProducts" :key="p.id" class="low-stock-card">
            <div class="ls-left">
              <div class="ls-avatar">
                {{ p.name?.charAt(0)?.toUpperCase() }}
              </div>
              <div class="ls-info">
                <span class="ls-name">{{ p.name }}</span>
                <span class="ls-cat">{{
                  p.category_name ?? $t("general")
                }}</span>
              </div>
            </div>
            <div class="ls-stock" :class="p.stock === 0 ? 'out' : 'low'">
              <Icon
                :name="p.stock === 0 ? 'mdi:close-circle' : 'mdi:alert'"
                size="13"
              />
              {{ p.stock }} {{ p.unit }}
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── Bottom two-col ─────────────────────────────────────────────────── -->
    <div class="two-col mt-4">
      <!-- Recent orders (filtered if status active) -->
      <div class="panel">
        <div class="panel-head">
          <div class="panel-head__left">
            <div class="panel-icon blue">
              <Icon name="mdi:receipt-text-outline" size="15" />
            </div>
            <span>
              {{ $t("recentOrders") }}
              <span
                v-if="activeStatus"
                class="panel-filter-badge"
                :class="statusBadgeClass(activeStatus)"
              >
                {{ $t("order." + activeStatus) }}
              </span>
            </span>
          </div>
          <NuxtLink
            :to="
              activeStatus
                ? '/dashboard/orders?status=' + activeStatus
                : '/dashboard/orders'
            "
            class="panel-link"
          >
            {{ $t("seeAll") }}
            <Icon name="mdi:arrow-right" size="14" />
          </NuxtLink>
        </div>

        <div v-if="loading" class="panel-skeletons">
          <div v-for="n in 4" :key="n" class="skeleton-row" />
        </div>
        <div v-else-if="!filteredOrders.length" class="panel-empty">
          <Icon name="mdi:receipt-text-outline" size="36" />
          <p>{{ $t("noOrders") }}</p>
        </div>
        <div v-else class="order-list">
          <div
            v-for="(o, i) in filteredOrders"
            :key="o.id"
            class="order-row"
            @click="navigateTo('/dashboard/orders/' + o.id)"
          >
            <div class="or-id">#{{ i + 1 }}</div>
            <div class="or-info">
              <span class="or-customer">{{
                o.customer_name || $t("walkIn")
              }}</span>
              <span class="or-date">{{ formatDate(o.order_date) }}</span>
            </div>
            <div class="or-right">
              <span class="or-amount">{{ fmtSP(o.total_sp) }}</span>
              <span class="badge" :class="statusClass(o.status)">
                {{ $t("order." + o.status) }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Top debtors -->
      <div class="panel">
        <div class="panel-head">
          <div class="panel-head__left">
            <div class="panel-icon rose">
              <Icon name="mdi:cash-clock" size="15" />
            </div>
            <span>{{ $t("topDebtors") }}</span>
          </div>
          <NuxtLink to="/dashboard/dues" class="panel-link">
            {{ $t("seeAll") }}
            <Icon name="mdi:arrow-right" size="14" />
          </NuxtLink>
        </div>

        <div v-if="loading" class="panel-skeletons">
          <div v-for="n in 4" :key="n" class="skeleton-row" />
        </div>
        <div v-else-if="!topDebtors.length" class="panel-empty">
          <Icon name="mdi:check-circle-outline" size="36" />
          <p>{{ $t("noDues") }}</p>
        </div>
        <div v-else class="debtor-list">
          <div
            v-for="(d, i) in topDebtors"
            :key="i"
            class="debtor-row"
            @click="navigateTo('/dashboard/customers')"
          >
            <div class="debtor-rank">{{ i + 1 }}</div>
            <div class="debtor-avatar">
              {{ d.name?.charAt(0)?.toUpperCase() }}
            </div>
            <div class="debtor-info">
              <span class="debtor-name">{{ d.name }}</span>
              <span class="debtor-phone">{{ d.phone || "—" }}</span>
            </div>
            <div class="debtor-amount">{{ fmtSP(d.total_sp) }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
definePageMeta({
  searchMeta: {
    label: "Dashboard",
    labelAr: "لوحة التحكم",
    icon: "mdi:view-dashboard-outline",
    group: "Main",
  },
});

const { getStats, getOrders, getDuesReport, getProducts } = useStore();
const currency = useCurrency();
const { t: $t } = useI18n();

const loading = ref(true);
const stats = ref({});
const lowStockProducts = ref([]);
const recentOrders = ref([]);
const topDebtors = ref([]);
const fmtSP = ref((v) => v);
const fmt = ref((v) => v);
const activeStatus = ref(null); // "pending" | "partly_paid" | "paid" | null

const orderStatuses = [
  { value: "pending", class: "pill-warning" },
  { value: "partly_paid", class: "pill-info" },
  { value: "paid", class: "pill-success" },
];

// ── Status counts from loaded orders ─────────────────────────────────────────
const statusCounts = computed(() => {
  const counts = { pending: 0, partly_paid: 0, paid: 0 };
  for (const o of recentOrders.value) {
    if (counts[o.status] !== undefined) counts[o.status]++;
  }
  return counts;
});

// ── Filtered orders list ──────────────────────────────────────────────────────
const filteredOrders = computed(() => {
  if (!activeStatus.value) return recentOrders.value;
  return recentOrders.value.filter((o) => o.status === activeStatus.value);
});

const toggleStatus = (val) => {
  activeStatus.value = activeStatus.value === val ? null : val;
};

const clearStatus = () => {
  activeStatus.value = null;
};

// ── Stat cards ────────────────────────────────────────────────────────────────
const formatDate = (d) =>
  d
    ? new Date(d).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

const statusClass = (s) =>
  ({
    pending: "badge-warning",
    partly_paid: "badge-info",
    paid: "badge-success",
  }[s] ?? "badge-secondary");

const statusBadgeClass = (s) =>
  ({
    pending: "filter-badge-warning",
    partly_paid: "filter-badge-info",
    paid: "filter-badge-success",
  }[s] ?? "");

const statCards = computed(() => [
  {
    key: "products",
    label: "stats.totalProducts",
    value: stats.value.totalProducts ?? 0,
    icon: "mdi:package-variant-closed",
    color: "blue",
    onClick: () => navigateTo("/dashboard/products"),
  },
  {
    key: "customers",
    label: "stats.totalCustomers",
    value: stats.value.totalCustomers ?? 0,
    icon: "mdi:account-group-outline",
    color: "teal",
    onClick: () => navigateTo("/dashboard/customers"),
  },
  {
    key: "todayOrders",
    label: "stats.todayOrders",
    value: stats.value.todayOrders ?? 0,
    icon: "mdi:receipt-text-outline",
    color: "green",
    onClick: () => navigateTo("/dashboard/orders"),
  },
  {
    key: "revenue",
    label: "stats.monthRevenue",
    value: stats.value.monthRevenue ?? 0,
    icon: "mdi:cash-multiple",
    color: "amber",
    formatter: (v) => fmt.value(v),
    onClick: () => navigateTo("/dashboard/reports/revenue"),
  },
  {
    key: "lowStock",
    label: "stats.lowStock",
    value: stats.value.lowStock ?? 0,
    icon: "mdi:alert-circle-outline",
    color: "orange",
    onClick: () => navigateTo("/dashboard/products?lowStock=1"),
  },
  {
    key: "dues",
    label: "stats.unpaidDues",
    value: stats.value.unpaidDues ?? 0,
    icon: "mdi:cash-clock",
    color: "red",
    description: stats.value.unpaidDuesAmount
      ? fmt.value(stats.value.unpaidDuesAmount)
      : undefined,
    onClick: () => navigateTo("/dashboard/dues"),
  },
]);

// ── Load ──────────────────────────────────────────────────────────────────────
const load = async () => {
  loading.value = true;
  try {
    await currency.loadSettings();
    fmtSP.value = currency.fmtSP;
    fmt.value = currency.fmt;

    const [sR, oR, dR] = await Promise.all([
      getStats(),
      getOrders({ limit: 20 }), // load more so status counts are meaningful
      getDuesReport(),
    ]);

    if (sR.ok) stats.value = sR.data;
    if (oR.ok) recentOrders.value = oR.data;
    if (dR.ok) topDebtors.value = dR.data.topDebtors?.slice(0, 5) ?? [];

    const pAll = await getProducts({ limit: 200, activeOnly: true });
    if (pAll.ok) {
      lowStockProducts.value = pAll.data
        .filter((p) => p.stock <= p.min_stock && p.min_stock > 0)
        .slice(0, 8);
    }
  } finally {
    loading.value = false;
  }
};

onMounted(load);
watch(useSyncTick(), () => load());
</script>

<style lang="scss" scoped>
// ── Stats grid ────────────────────────────────────────────────────────────────
.stats-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 14px;

  @media (max-width: 1200px) {
    grid-template-columns: repeat(3, 1fr);
  }
  @media (max-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
  }
  @media (max-width: 420px) {
    grid-template-columns: 1fr;
  }
}

.stat-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: fadeUp 0.4s ease both;
  transition: box-shadow 0.2s, transform 0.2s, border-color 0.2s;
  position: relative;
  overflow: hidden;

  &.clickable {
    cursor: pointer;
    &:hover {
      transform: translateY(-3px);
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.1);
      border-color: var(--primary);
    }
    &:active {
      transform: translateY(-1px);
    }
  }

  &:not(.clickable):hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
  }

  // Color accents
  &.accent-blue .stat-card__icon {
    background: rgba(59, 130, 246, 0.1);
    color: #3b82f6;
  }
  &.accent-teal .stat-card__icon {
    background: rgba(20, 184, 166, 0.1);
    color: #14b8a6;
  }
  &.accent-green .stat-card__icon {
    background: rgba(16, 185, 129, 0.1);
    color: #10b981;
  }
  &.accent-amber .stat-card__icon {
    background: rgba(245, 158, 11, 0.1);
    color: #f59e0b;
  }
  &.accent-orange .stat-card__icon {
    background: rgba(249, 115, 22, 0.1);
    color: #f97316;
  }
  &.accent-red .stat-card__icon {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
  }
}

.stat-card__top {
  display: flex;
  align-items: center;
  gap: 10px;
}

.stat-card__icon {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.stat-card__label {
  font-size: 0.76rem;
  font-weight: 500;
  color: var(--text-muted);
  line-height: 1.3;
}

.stat-card__value {
  font-size: 1.6rem;
  font-weight: 750;
  color: var(--text-primary);
  letter-spacing: -0.03em;
  line-height: 1;

  @media (max-width: 1200px) {
    font-size: 1.4rem;
  }
}

.stat-card__desc {
  font-size: 0.72rem;
  color: var(--text-muted);
  margin-top: -4px;
}

.stat-card__cta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--primary);
  opacity: 0;
  transition: opacity 0.15s;
  margin-top: -4px;
}

.stat-card.clickable:hover .stat-card__cta {
  opacity: 1;
}

.skeleton-val {
  display: block;
  height: 1.8rem;
  width: 70px;
  border-radius: 8px;
  background: linear-gradient(
    90deg,
    var(--bg-elevated) 25%,
    var(--border-color) 50%,
    var(--bg-elevated) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
}

// ── Status pill filters ───────────────────────────────────────────────────────
.status-pills-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 1rem;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 0.78rem;
  font-weight: 600;
  border: 1.5px solid transparent;
  background: var(--bg-elevated);
  color: var(--text-sub);
  cursor: pointer;
  transition: all 0.18s;

  &:hover {
    transform: translateY(-1px);
  }

  &.pill-warning {
    &.active,
    &:hover {
      background: rgba(245, 158, 11, 0.12);
      border-color: #f59e0b;
      color: #f59e0b;
    }
  }
  &.pill-info {
    &.active,
    &:hover {
      background: rgba(6, 182, 212, 0.12);
      border-color: #06b6d4;
      color: #06b6d4;
    }
  }
  &.pill-success {
    &.active,
    &:hover {
      background: rgba(16, 185, 129, 0.12);
      border-color: #10b981;
      color: #10b981;
    }
  }

  &.pill-clear {
    background: transparent;
    border-color: var(--border-color);
    color: var(--text-muted);
    &:hover {
      background: rgba(239, 68, 68, 0.08);
      border-color: #ef4444;
      color: #ef4444;
    }
  }
}

.pill-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}

.pill-count {
  background: currentColor;
  color: var(--bg-surface);
  border-radius: 20px;
  padding: 0 6px;
  font-size: 0.65rem;
  font-weight: 700;
  min-width: 18px;
  text-align: center;
  line-height: 1.6;
}

.status-pill:not(.active):not(:hover) .pill-count {
  background: var(--border-color);
  color: var(--text-muted);
}

// ── Low stock ─────────────────────────────────────────────────────────────────
.alert-section {
  background: var(--bg-surface);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 16px;
  padding: 1.25rem 1.5rem;
}

.section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 1rem;
}

.section-head__icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  &.warn {
    background: rgba(245, 158, 11, 0.12);
    color: #f59e0b;
  }
}

.section-title {
  font-size: 0.9rem;
  font-weight: 700;
  margin: 0;
  color: var(--text-primary);
  flex: 1;
}

.badge-count {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 20px;
  &.warn {
    background: rgba(245, 158, 11, 0.15);
    color: #f59e0b;
  }
}

.low-stock-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;

  @media (max-width: 500px) {
    grid-template-columns: 1fr;
  }
}

.low-stock-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: var(--bg-elevated);
  border-radius: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
}

.ls-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ls-avatar {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--primary-soft);
  color: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.8rem;
  flex-shrink: 0;
}

.ls-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.ls-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ls-cat {
  font-size: 0.7rem;
  color: var(--text-muted);
}

.ls-stock {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 20px;
  font-size: 0.72rem;
  font-weight: 600;
  flex-shrink: 0;
  &.out {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
  }
  &.low {
    background: rgba(245, 158, 11, 0.1);
    color: #f59e0b;
  }
}

// ── Two-col layout ────────────────────────────────────────────────────────────
.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
  }
}

// ── Panel ─────────────────────────────────────────────────────────────────────
.panel {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  overflow: hidden;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-color);
}

.panel-head__left {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  font-weight: 650;
  color: var(--text-primary);
}

.panel-filter-badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 20px;
  font-size: 0.68rem;
  font-weight: 700;
  margin-inline-start: 4px;

  &.filter-badge-warning {
    background: rgba(245, 158, 11, 0.12);
    color: #f59e0b;
  }
  &.filter-badge-info {
    background: rgba(6, 182, 212, 0.12);
    color: #06b6d4;
  }
  &.filter-badge-success {
    background: rgba(16, 185, 129, 0.12);
    color: #10b981;
  }
}

.panel-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  &.blue {
    background: rgba(59, 130, 246, 0.12);
    color: #3b82f6;
  }
  &.rose {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
  }
}

.panel-link {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--primary);
  text-decoration: none;
  opacity: 0.8;
  transition: opacity 0.15s;
  &:hover {
    opacity: 1;
  }
}

.panel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 36px 20px;
  color: var(--text-muted);
  font-size: 0.83rem;
  p {
    margin: 0;
  }
}

.panel-skeletons {
  padding: 8px 0;
}

.skeleton-row {
  height: 48px;
  margin: 6px 18px;
  border-radius: 10px;
  background: linear-gradient(
    90deg,
    var(--bg-elevated) 25%,
    var(--border-color) 50%,
    var(--bg-elevated) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
}

// ── Order list ────────────────────────────────────────────────────────────────
.order-list {
  padding: 4px 0;
}

.order-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 18px;
  cursor: pointer;
  transition: background 0.13s;
  border-bottom: 1px solid var(--border-color);

  &:last-child {
    border-bottom: none;
  }
  &:hover {
    background: var(--bg-elevated);
  }
}

.or-id {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-muted);
  min-width: 32px;
}

.or-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.or-customer {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.or-date {
  font-size: 0.72rem;
  color: var(--text-muted);
}

.or-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.or-amount {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--text-primary);
}

// ── Debtor list ───────────────────────────────────────────────────────────────
.debtor-list {
  padding: 4px 0;
}

.debtor-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 18px;
  cursor: pointer;
  transition: background 0.13s;
  border-bottom: 1px solid var(--border-color);

  &:last-child {
    border-bottom: none;
  }
  &:hover {
    background: var(--bg-elevated);
  }
}

.debtor-rank {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--text-muted);
  min-width: 16px;
  text-align: center;
}

.debtor-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.85rem;
  flex-shrink: 0;
}

.debtor-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.debtor-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.debtor-phone {
  font-size: 0.72rem;
  color: var(--text-muted);
}

.debtor-amount {
  font-weight: 700;
  color: #ef4444;
  font-size: 0.875rem;
  flex-shrink: 0;
}

// ── Badges ────────────────────────────────────────────────────────────────────
.badge {
  padding: 2px 8px;
  border-radius: 20px;
  font-size: 0.68rem;
  font-weight: 650;
  white-space: nowrap;
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
.badge-secondary {
  background: var(--bg-elevated);
  color: var(--text-muted);
}

// ── Utils ─────────────────────────────────────────────────────────────────────
.mt-4 {
  margin-top: 1rem;
}

// ── Animations ────────────────────────────────────────────────────────────────
@keyframes fadeUp {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes shimmer {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}

.fade-slide-enter-active {
  transition: all 0.3s ease;
}
.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
