<!-- store-app/pages/dashboard/orders/index.vue -->
<template>
  <div>
    <SharedUiHeaderPage
      :title="$t('sidebar.orders')"
      :subtitle="$t('ordersSubtitle')"
      icon="mdi:receipt-text-outline"
      :is-rtl="locale === 'ar'"
      :actions="[
        { label: $t('newOrder'), icon: 'mdi:plus', variant: 'primary' },
      ]"
      @action-click="navigateTo('/dashboard/orders/new')"
    />

    <div class="filters-row">
      <SharedUiFormBaseInput
        v-model="search"
        :placeholder="$t('searchOrders')"
        icon-left="mdi:magnify"
        clearable
        class="search-input"
      />
      <SharedUiFormBaseSelect
        v-model="filterStatus"
        :options="statusOptions"
        :placeholder="$t('allStatuses')"
        clearable
        class="filter-select"
      />
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
    </div>

    <SharedUiTableDataTable
      :columns="cols"
      :data="orders"
      :loading="loading"
      :pagination="{ currentPage: page, pageSize: pageSize, totalItems: total }"
      empty-icon="mdi:receipt-text-outline"
      empty-text="noOrders"
      row-clickable
      @row-click="(r) => navigateTo('/dashboard/orders/' + r.id)"
      @page-change="
        (p) => {
          page = p;
          load();
        }
      "
    >
      <template #cell-status="{ row }">
        <span class="badge" :class="statusClass(row.status)">
          {{ $t("order." + row.status) }}
        </span>
      </template>

      <template #cell-total_sp="{ row }">
        {{ fmtOrder(row, row.total_sp) }}
      </template>

      <template #cell-total_paid_sp="{ row }">
        <span :class="row.total_paid_sp > 0 ? 'paid-amount' : 'zero-amount'">
          {{ fmtOrder(row, row.total_paid_sp ?? 0) }}
        </span>
      </template>

      <template #cell-remaining="{ row }">
        <span v-if="row.status !== 'paid'" class="remaining-amount">
          {{
            fmtOrder(
              row,
              Math.max(0, (row.total_sp ?? 0) - (row.total_paid_sp ?? 0)),
            )
          }}
        </span>
        <span v-else class="fully-paid-badge">
          <Icon name="mdi:check-circle" size="13" />
          {{ $t("order.paid") }}
        </span>
      </template>

      <template #cell-order_date="{ row }">
        {{ new Date(row.order_date).toLocaleDateString() }}
      </template>

      <template #cell-item_count="{ row }">
        <span class="item-count-badge">{{ row.item_count ?? 0 }}</span>
      </template>

      <template #actions="{ row }">
        <div class="action-buttons">
          <button
            class="action-btn"
            :title="$t('view')"
            @click.stop="navigateTo('/dashboard/orders/' + row.id)"
          >
            <Icon name="mdi:eye-outline" />
          </button>
          <button
            class="action-btn danger"
            :title="$t('delete')"
            @click.stop="confirmDelete(row)"
          >
            <Icon name="mdi:trash-can-outline" />
          </button>
        </div>
      </template>
    </SharedUiTableDataTable>

    <SharedUiDialogAppModal
      v-model="showDeleteModal"
      :title="$t('deleteOrder')"
      max-width="420px"
    >
      <p>{{ $t("deleteOrderConfirm") }}</p>
      <template #actions>
        <div class="d-flex gap-2 justify-content-end">
          <SharedUiButtonBase
            variant="outline"
            @click="showDeleteModal = false"
          >
            {{ $t("cancel") }}
          </SharedUiButtonBase>
          <SharedUiButtonBase
            variant="error"
            :loading="deleting"
            icon-left="mdi:trash-can-outline"
            @click="doDelete"
          >
            {{ $t("delete") }}
          </SharedUiButtonBase>
        </div>
      </template>
    </SharedUiDialogAppModal>
  </div>
</template>

<script setup>
definePageMeta({
  searchMeta: {
    label: "Orders",
    labelAr: "الطلبات",
    icon: "mdi:receipt-text-outline",
    group: "Main",
  },
});

import { watchDebounced } from "@vueuse/core";

const { getOrders, deleteOrder } = useStore();
const { locale, t: $t } = useI18n();
const { $toast } = useNuxtApp();
const { fmtTx, loadSettings } = useCurrency();

const search = ref("");
const filterStatus = ref("");
const dateFrom = ref("");
const dateTo = ref("");
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);
const orders = ref([]);
const total = ref(0);
const showDeleteModal = ref(false);
const deleting = ref(false);
const toDelete = ref(null);

const statusOptions = [
  { label: $t("order.pending"), value: "pending" },
  { label: $t("order.partly_paid"), value: "partly_paid" },
  { label: $t("order.paid"), value: "paid" },
];

const cols = [
  { key: "customer_name", label: "customer" },
  { key: "order_date", label: "date" },
  { key: "item_count", label: "items" },
  { key: "total_sp", label: "total" },
  { key: "total_paid_sp", label: "paid" },
  { key: "remaining", label: "remaining" },
  { key: "status", label: "status" },
];

const statusClass = (s) =>
  ({
    pending: "badge-warning",
    partly_paid: "badge-info",
    paid: "badge-success",
  }[s] ?? "badge-secondary");

// Formats any SP value using the order's frozen rate when display_currency=USD
const fmtOrder = (row, spValue) => {
  if (row.display_currency === "USD" && row.total_usd > 0) {
    const frozenRate = row.total_sp / row.total_usd;
    const usdValue = spValue / frozenRate;
    return fmtTx(usdValue, "USD", spValue ?? 0);
  }
  return fmtTx(spValue ?? 0, "SP", spValue ?? 0);
};

const load = async () => {
  loading.value = true;
  try {
    const r = await getOrders({
      search: search.value,
      status: filterStatus.value || undefined,
      dateFrom: dateFrom.value || undefined,
      dateTo: dateTo.value || undefined,
      limit: pageSize.value,
      offset: (page.value - 1) * pageSize.value,
    });
    if (r.ok) {
      orders.value = r.data;
      total.value = r.total;
    }
  } finally {
    loading.value = false;
  }
};

const confirmDelete = (row) => {
  toDelete.value = row;
  showDeleteModal.value = true;
};

const doDelete = async () => {
  deleting.value = true;
  const r = await deleteOrder(toDelete.value.id);
  if (r.ok) {
    $toast.success($t("deleted"));
    showDeleteModal.value = false;
    load();
  } else {
    $toast.error(r.error);
  }
  deleting.value = false;
};

watchDebounced(
  [search, filterStatus, dateFrom, dateTo],
  () => {
    page.value = 1;
    load();
  },
  { debounce: 300 },
);

onMounted(async () => {
  await loadSettings();
  await load();
});

watch(useSyncTick(), () => load());
</script>

<style lang="scss" scoped>
.filters-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: flex-end;
  margin-bottom: 1rem;
}
.search-input {
  flex: 1;
  min-width: 200px;
}
.filter-select,
.filter-date {
  width: 160px;
}
.badge {
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
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
.paid-amount {
  font-weight: 600;
  color: #10b981;
}
.zero-amount {
  color: var(--text-muted);
  font-size: 0.85em;
}
.remaining-amount {
  font-weight: 600;
  color: #f59e0b;
}
.fully-paid-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.72rem;
  font-weight: 600;
  color: #10b981;
}
.item-count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: var(--bg-elevated);
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-sub);
}
.action-buttons {
  display: flex;
  gap: 6px;
}
.action-btn {
  width: 30px;
  height: 30px;
  border: none;
  background: var(--bg-elevated);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--text-sub);
  transition: all 0.15s;
  &:hover {
    background: var(--primary-soft);
    color: var(--primary);
  }
  &.danger:hover {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
  }
}
.d-flex {
  display: flex;
}
.gap-2 {
  gap: 8px;
}
.justify-content-end {
  justify-content: flex-end;
}
</style>
