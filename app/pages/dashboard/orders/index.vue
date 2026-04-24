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

    <!-- Filters -->
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

    <!-- Table -->
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
        <span class="badge" :class="statusClass(row.status)">{{
          $t("order." + row.status)
        }}</span>
      </template>
      <template #cell-total_sp="{ row }">
        {{ fmtSP(row.total_sp) }}
      </template>
      <template #cell-paid_amount="{ row }">
        {{
          row.display_currency === "USD"
            ? "$" + row.paid_amount
            : row.paid_amount + " ل.س"
        }}
      </template>
      <template #cell-order_date="{ row }">
        {{ new Date(row.order_date).toLocaleDateString() }}
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

    <!-- Delete confirm -->
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
            >{{ $t("cancel") }}</SharedUiButtonBase
          >
          <SharedUiButtonBase
            variant="error"
            :loading="deleting"
            icon-left="mdi:trash-can-outline"
            @click="doDelete"
            >{{ $t("delete") }}</SharedUiButtonBase
          >
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

// ✅ Top-level
const { getOrders, deleteOrder } = useStore();
import { watchDebounced } from "@vueuse/core";
const { locale, t: $t } = useI18n();
const { $toast } = useNuxtApp();
const currency = useCurrency();

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
const fmtSP = ref((v) => v);

const statusOptions = [
  { label: "Pending", value: "pending" },
  { label: "Partly Paid", value: "partly_paid" },
  { label: "Paid", value: "paid" },
];

const cols = [
  { key: "customer_name", label: "customer" },
  { key: "order_date", label: "date" },
  { key: "item_count", label: "items" },
  { key: "total_sp", label: "total", align: "end" },
  { key: "paid_amount", label: "paid", align: "end" },
  { key: "status", label: "status" },
];

const statusClass = (s) =>
  ({
    pending: "badge-warning",
    partly_paid: "badge-info",
    paid: "badge-success",
  }[s] ?? "badge-secondary");

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
  } else $toast.error(r.error);
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
  await currency.loadSettings();
  fmtSP.value = currency.fmtSP;
  await load();
});
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
</style>
