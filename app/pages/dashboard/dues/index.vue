<!-- store-app/pages/dashboard/dues/index.vue -->
<template>
  <div>
    <SharedUiHeaderPage
      :title="$t('sidebar.dues')"
      :subtitle="$t('duesSubtitle')"
      icon="mdi:cash-clock"
      :is-rtl="locale === 'ar'"
      :actions="[{ label: $t('addDue'), icon: 'mdi:plus', variant: 'primary' }]"
      @action-click="openAdd"
    />

    <!-- Summary strip -->
    <div class="dues-summary">
      <div class="sum-chip danger">
        <Icon name="mdi:alert-circle-outline" size="18" />
        <div>
          <span class="sum-chip-label">{{ $t("totalUnpaid") }}</span>
          <span class="sum-chip-val">{{ fmtSP(totalUnpaidSp) }}</span>
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="filters-row">
      <SharedUiFormBaseInput
        v-model="search"
        :placeholder="$t('searchCustomer')"
        icon-left="mdi:magnify"
        clearable
        class="search-input"
      />
      <SharedUiFormBaseSelect
        v-model="filterPaid"
        :options="paidOptions"
        :placeholder="$t('allStatuses')"
        clearable
        class="filter-select"
      />
    </div>

    <SharedUiTableDataTable
      :columns="cols"
      :data="dues"
      :loading="loading"
      :pagination="{ currentPage: page, pageSize: 20, totalItems: total }"
      empty-icon="mdi:cash-clock"
      empty-text="noDues"
      @page-change="
        (p) => {
          page = p;
          load();
        }
      "
    >
      <template #cell-amount="{ row }">
        {{ row.amount }} {{ row.currency }}
      </template>

      <template #cell-customer_name="{ row }">
        <NuxtLink
          v-if="row.customer_id"
          :to="'/dashboard/customers/' + row.customer_id"
          class="customer-link"
        >
          {{ row.customer_name }}
        </NuxtLink>
        <span v-else>{{ row.customer_name ?? "—" }}</span>
      </template>
      <template #cell-paid="{ row }">
        <span
          class="badge"
          :class="row.paid ? 'badge-success' : 'badge-warning'"
        >
          {{ row.paid ? $t("paid") : $t("unpaid") }}
        </span>
      </template>
      <template #cell-due_date="{ row }">
        <span :class="isOverdue(row) ? 'overdue' : ''">
          {{ row.due_date ? new Date(row.due_date).toLocaleDateString() : "—" }}
        </span>
      </template>
      <template #actions="{ row }">
        <div class="action-buttons">
          <button
            v-if="!row.paid"
            class="action-btn success"
            :title="$t('markPaid')"
            @click.stop="payDue(row.id)"
          >
            <Icon name="mdi:check" />
          </button>
          <button
            class="action-btn"
            :title="$t('edit')"
            @click.stop="openEdit(row)"
          >
            <Icon name="mdi:pencil-outline" />
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

    <!-- Add/Edit modal -->
    <SharedUiDialogAppModal
      v-model="showModal"
      :title="editTarget ? $t('editDue') : $t('addDue')"
      max-width="500px"
    >
      <div class="modal-form">
        <!-- ✅ Use the shared Combobox component -->
        <SharedUiFormCombobox
          v-model="selectedCustomer"
          v-model:search="customerSearch"
          :options="customerSuggestions"
          :loading="customerLoading"
          :label="$t('customer')"
          :placeholder="$t('typeCustomerName')"
          :allow-create="true"
          :create-label="$t('createNew')"
          display-key="name"
          sub-key="phone"
          @update:search="onCustomerSearch"
          @create="onCreateCustomer"
        />

        <SharedUiFormBaseInput
          v-model.number="form.amount"
          type="number"
          min="0"
          :label="$t('amount')"
          required
        />
        <SharedUiFormBaseSelect
          v-model="form.currency"
          :options="currencyOptions"
          :label="$t('currency')"
        />
        <SharedUiFormBaseInput
          v-model="form.description"
          :label="$t('description')"
        />
        <SharedUiFormBaseInput
          v-model="form.due_date"
          type="date"
          :label="$t('dueDate')"
        />
      </div>
      <template #actions>
        <div class="d-flex gap-2 justify-content-end">
          <SharedUiButtonBase variant="outline" @click="closeModal">
            {{ $t("cancel") }}
          </SharedUiButtonBase>
          <SharedUiButtonBase
            :loading="saving"
            icon-left="mdi:content-save-outline"
            @click="save"
          >
            {{ $t("save") }}
          </SharedUiButtonBase>
        </div>
      </template>
    </SharedUiDialogAppModal>

    <!-- Delete confirm -->
    <SharedUiDialogAppModal
      v-model="showDeleteModal"
      :title="$t('deleteDue')"
      max-width="420px"
    >
      <p>{{ $t("deleteDueConfirm") }}</p>
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
    label: "Dues",
    labelAr: "المديونيات",
    icon: "mdi:cash-clock",
    group: "Main",
  },
});

import { watchDebounced } from "@vueuse/core";

const {
  getDues,
  saveDue,
  markDuePaid,
  deleteDue,
  getCustomers,
  findOrCreateCustomer,
} = useStore();

const { locale, t: $t } = useI18n();
const { $toast } = useNuxtApp();

// ✅ Destructure fmtSP directly — it's a stable function from the singleton
const { fmtSP, loadSettings } = useCurrency();

// ── Table state ───────────────────────────────────────────────────────────────
const search = ref("");
const filterPaid = ref("");
const page = ref(1);
const loading = ref(false);
const dues = ref([]);
const total = ref(0);
const totalUnpaidSp = ref(0);

// ── Modal state ───────────────────────────────────────────────────────────────
const showModal = ref(false);
const saving = ref(false);
const editTarget = ref(null);
const showDeleteModal = ref(false);
const deleting = ref(false);
const toDelete = ref(null);

// ── Customer combobox — exact same pattern as orders/new.vue ──────────────────
const customerSearch = ref("");
const customerSuggestions = ref([]);
const customerLoading = ref(false);
const selectedCustomer = ref(null);

let customerTimer;
const onCustomerSearch = (val) => {
  customerSearch.value = val;
  clearTimeout(customerTimer);
  if (!val.trim()) {
    customerSuggestions.value = [];
    return;
  }
  customerLoading.value = true;
  customerTimer = setTimeout(async () => {
    const r = await getCustomers({ search: val, limit: 8 });
    if (r.ok) customerSuggestions.value = r.data;
    customerLoading.value = false;
  }, 250);
};

const onCreateCustomer = async (name) => {
  const r = await findOrCreateCustomer(name);
  if (r.ok) {
    selectedCustomer.value = r.data;
    customerSearch.value = r.data.name;
    form.customer_id = r.data.id;
    $toast.success($t("customerCreated"));
  } else {
    $toast.error(r.error);
  }
};

// Keep form.customer_id in sync when combobox selection changes
watch(selectedCustomer, (c) => {
  form.customer_id = c?.id ?? null;
});

// ── Form ──────────────────────────────────────────────────────────────────────
const form = reactive({
  customer_id: null,
  order_id: null,
  amount: 0,
  currency: "SP",
  description: "",
  due_date: "",
});

const currencyOptions = [
  { label: "SP (ل.س)", value: "SP" },
  { label: "USD ($)", value: "USD" },
];

const paidOptions = computed(() => [
  { label: $t("paid"), value: "1" },
  { label: $t("unpaid"), value: "0" },
]);

// ── Table columns ─────────────────────────────────────────────────────────────
const cols = [
  { key: "customer_name", label: "customer", sortable: true },
  { key: "description", label: "description" },
  { key: "amount", label: "amount", align: "end" },
  { key: "due_date", label: "dueDate" },
  { key: "paid", label: "status" },
];

const isOverdue = (row) =>
  !row.paid && row.due_date && new Date(row.due_date) < new Date();

// ── CRUD ──────────────────────────────────────────────────────────────────────
const openAdd = () => {
  editTarget.value = null;
  selectedCustomer.value = null;
  customerSearch.value = "";
  customerSuggestions.value = [];
  Object.assign(form, {
    customer_id: null,
    order_id: null,
    amount: 0,
    currency: "SP",
    description: "",
    due_date: "",
  });
  showModal.value = true;
};

const openEdit = (due) => {
  editTarget.value = due;
  selectedCustomer.value = due.customer_id
    ? { id: due.customer_id, name: due.customer_name ?? "" }
    : null;
  customerSearch.value = due.customer_name ?? "";
  customerSuggestions.value = [];
  Object.assign(form, {
    customer_id: due.customer_id,
    order_id: due.order_id ?? null,
    amount: due.amount,
    currency: due.currency,
    description: due.description ?? "",
    due_date: due.due_date ?? "",
  });
  showModal.value = true;
};

const closeModal = () => {
  showModal.value = false;
  editTarget.value = null;
};

const save = async () => {
  if (!form.customer_id && customerSearch.value.trim()) {
    await onCreateCustomer(customerSearch.value.trim());
  }
  saving.value = true;
  const r = await saveDue({ ...form, id: editTarget.value?.id });
  saving.value = false;
  if (r.ok) {
    $toast.success($t("saved"));
    closeModal();
    load();
  } else {
    $toast.error(r.error);
  }
};

const payDue = async (id) => {
  const r = await markDuePaid(id);
  if (r.ok) {
    $toast.success($t("marked"));
    load();
  } else $toast.error(r.error);
};

const confirmDelete = (row) => {
  toDelete.value = row;
  showDeleteModal.value = true;
};

const doDelete = async () => {
  deleting.value = true;
  const r = await deleteDue(toDelete.value.id);
  if (r.ok) {
    $toast.success($t("deleted"));
    showDeleteModal.value = false;
    load();
  } else {
    $toast.error(r.error);
  }
  deleting.value = false;
};

// ── Load ──────────────────────────────────────────────────────────────────────
const load = async () => {
  loading.value = true;
  const paid =
    filterPaid.value === "1"
      ? true
      : filterPaid.value === "0"
        ? false
        : undefined;

  const r = await getDues({
    search: search.value,
    paid,
    limit: 20,
    offset: (page.value - 1) * 20,
  });

  if (r.ok) {
    dues.value = r.data;
    total.value = r.total;
    totalUnpaidSp.value = r.totalUnpaidSp;
  }
  loading.value = false;
};

watchDebounced(
  [search, filterPaid],
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
</script>

<style lang="scss" scoped>
.dues-summary {
  margin-bottom: 1.5rem;
}
.sum-chip {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  border-radius: 12px;
  &.danger {
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.2);
    color: #ef4444;
  }
}
.sum-chip-label {
  display: block;
  font-size: 0.75rem;
  opacity: 0.8;
}
.sum-chip-val {
  display: block;
  font-size: 1.1rem;
  font-weight: 700;
}
.filters-row {
  display: flex;
  gap: 12px;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}
.search-input {
  flex: 1;
  min-width: 200px;
}
.filter-select {
  width: 160px;
}
.customer-link {
  color: var(--primary);
  text-decoration: none;
  font-weight: 600;
}
.overdue {
  color: #ef4444;
  font-weight: 600;
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
  &.success:hover {
    background: rgba(16, 185, 129, 0.1);
    color: #10b981;
  }
  &.danger:hover {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
  }
}
.modal-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
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
