<!-- store-app/pages/dashboard/customers/index.vue -->
<template>
  <div>
    <SharedUiHeaderPage
      :title="$t('sidebar.customers')"
      :subtitle="$t('customersSubtitle')"
      icon="mdi:account-group-outline"
      :is-rtl="locale === 'ar'"
      :actions="[
        { label: $t('addCustomer'), icon: 'mdi:plus', variant: 'primary' },
      ]"
      @action-click="showAddModal = true"
    />

    <div class="filters-row">
      <SharedUiFormBaseInput
        v-model="search"
        :placeholder="$t('searchCustomers')"
        icon-left="mdi:magnify"
        clearable
        class="search-input"
      />
    </div>

    <SharedUiTableDataTable
      :columns="cols"
      :data="customers"
      :loading="loading"
      :pagination="{ currentPage: page, pageSize: 20, totalItems: total }"
      empty-icon="mdi:account-group-outline"
      empty-text="noCustomers"
      row-clickable
      @row-click="(r) => navigateTo('/dashboard/customers/' + r.id)"
      @page-change="
        (p) => {
          page = p;
          load();
        }
      "
    >
      <template #cell-total_spent="{ row }">
        {{ fmtSpent(row) }}
      </template>
      <template #cell-last_order="{ row }">
        {{
          row.last_order ? new Date(row.last_order).toLocaleDateString() : "—"
        }}
      </template>
      <template #actions="{ row }">
        <div class="action-buttons">
          <button
            class="action-btn"
            @click.stop="navigateTo('/dashboard/customers/' + row.id)"
          >
            <Icon name="mdi:eye-outline" />
          </button>
          <button class="action-btn" @click.stop="openEdit(row)">
            <Icon name="mdi:pencil-outline" />
          </button>
          <button class="action-btn danger" @click.stop="confirmDelete(row)">
            <Icon name="mdi:trash-can-outline" />
          </button>
        </div>
      </template>
    </SharedUiTableDataTable>

    <!-- Add/Edit customer modal -->
    <SharedUiDialogAppModal
      v-model="showAddModal"
      :title="editTarget ? $t('editCustomer') : $t('addCustomer')"
      max-width="480px"
    >
      <div class="modal-form">
        <SharedUiFormBaseInput
          v-model="form.name"
          :label="$t('name')"
          required
        />
        <SharedUiFormBaseInput
          v-model="form.phone"
          :label="$t('phone')"
          icon-left="mdi:phone-outline"
        />
        <SharedUiFormBaseInput
          v-model="form.address"
          :label="$t('address')"
          icon-left="mdi:map-marker-outline"
        />
        <SharedUiFormBaseTextarea
          v-model="form.notes"
          :label="$t('notes')"
          :rows="2"
        />
      </div>
      <template #actions>
        <div class="d-flex gap-2 justify-content-end">
          <SharedUiButtonBase variant="outline" @click="closeModal">{{
            $t("cancel")
          }}</SharedUiButtonBase>
          <SharedUiButtonBase
            :loading="saving"
            icon-left="mdi:content-save-outline"
            @click="save"
            >{{ $t("save") }}</SharedUiButtonBase
          >
        </div>
      </template>
    </SharedUiDialogAppModal>

    <!-- Delete confirm -->
    <SharedUiDialogAppModal
      v-model="showDeleteModal"
      :title="$t('deleteCustomer')"
      max-width="420px"
    >
      <p>{{ $t("deleteCustomerConfirm") }}</p>
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
    label: "Customers",
    labelAr: "العملاء",
    icon: "mdi:account-group-outline",
    group: "Main",
  },
});

const { getCustomers, saveCustomer, deleteCustomer } = useStore();
import { watchDebounced } from "@vueuse/core";
const { locale, t: $t } = useI18n();
const { $toast } = useNuxtApp();
const { fmt, dollarRate, reportCurrency, loadSettings } = useCurrency();

const search = ref("");
const page = ref(1);
const loading = ref(false);
const customers = ref([]);
const total = ref(0);
const showAddModal = ref(false);
const saving = ref(false);
const showDeleteModal = ref(false);
const deleting = ref(false);
const toDelete = ref(null);
const editTarget = ref(null);

const form = reactive({ name: "", phone: "", address: "", notes: "" });

const cols = [
  { key: "name", label: "name", sortable: true },
  { key: "phone", label: "phone" },
  { key: "total_orders", label: "orders" },
  { key: "total_spent", label: "totalSpent" },
  { key: "last_order", label: "lastOrder" },
];

// Convert spent_usd + spent_sp using frozen USD + current rate for SP-only portion
const fmtSpent = (row) => {
  const usd = row.spent_usd ?? 0;
  const sp = row.spent_sp ?? 0;
  if (reportCurrency.value === "USD") {
    return fmt(usd + sp / dollarRate.value, "USD");
  }
  return fmt(usd * dollarRate.value + sp, "SP");
};

const load = async () => {
  loading.value = true;
  const r = await getCustomers({
    search: search.value,
    limit: 20,
    offset: (page.value - 1) * 20,
  });
  if (r.ok) {
    customers.value = r.data;
    total.value = r.total;
  }
  loading.value = false;
};

const openEdit = (c) => {
  editTarget.value = c;
  Object.assign(form, {
    name: c.name,
    phone: c.phone ?? "",
    address: c.address ?? "",
    notes: c.notes ?? "",
  });
  showAddModal.value = true;
};

const closeModal = () => {
  showAddModal.value = false;
  editTarget.value = null;
  Object.assign(form, { name: "", phone: "", address: "", notes: "" });
};

const save = async () => {
  if (!form.name.trim()) return;
  saving.value = true;
  const r = await saveCustomer({ ...form, id: editTarget.value?.id });
  saving.value = false;
  if (r.ok) {
    $toast.success($t("saved"));
    closeModal();
    load();
  } else $toast.error(r.error);
};

const confirmDelete = (row) => {
  toDelete.value = row;
  showDeleteModal.value = true;
};

const doDelete = async () => {
  deleting.value = true;
  const r = await deleteCustomer(toDelete.value.id);
  if (r.ok) {
    $toast.success($t("deleted"));
    showDeleteModal.value = false;
    load();
  } else $toast.error(r.error);
  deleting.value = false;
};

watchDebounced(
  search,
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
  margin-bottom: 1rem;
}
.search-input {
  flex: 1;
  max-width: 380px;
}
.modal-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
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
