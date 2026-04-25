<!-- store-app/pages/dashboard/customers/[id]/index.vue -->
<template>
  <div>
    <SharedUiHeaderPage
      :title="customer?.name ?? $t('customerProfile')"
      icon="mdi:account-outline"
      show-back
      back-to="/dashboard/customers"
      :is-rtl="locale === 'ar'"
      :actions="[
        { label: $t('edit'), icon: 'mdi:pencil-outline', variant: 'outline' },
      ]"
      @action-click="showEditModal = true"
    />

    <div v-if="loading" class="loading-center">
      <Icon name="mdi:loading" size="40" class="spin" />
    </div>

    <div v-else-if="customer" class="profile-grid">
      <!-- Info sidebar -->
      <div class="profile-sidebar">
        <div class="profile-card">
          <div class="profile-avatar">
            {{ customer.name?.charAt(0)?.toUpperCase() }}
          </div>
          <h2 class="profile-name">{{ customer.name }}</h2>
          <p v-if="customer.phone" class="profile-contact">
            <Icon name="mdi:phone-outline" size="14" /> {{ customer.phone }}
          </p>
          <p v-if="customer.address" class="profile-contact">
            <Icon name="mdi:map-marker-outline" size="14" />
            {{ customer.address }}
          </p>
          <p v-if="customer.notes" class="profile-notes">
            {{ customer.notes }}
          </p>

          <div class="profile-stats">
            <div class="pstat">
              <span class="pstat-val">{{ customer.total_orders }}</span>
              <span class="pstat-label">{{ $t("orders") }}</span>
            </div>
            <div class="pstat">
              <span class="pstat-val">{{ fmtSP(customer.total_spent) }}</span>
              <span class="pstat-label">{{ $t("totalSpent") }}</span>
            </div>
          </div>
        </div>

        <!-- Quick actions -->
        <SharedUiButtonBase
          class="w-100"
          icon-left="mdi:receipt-text-plus-outline"
          @click="navigateTo('/dashboard/orders/new')"
        >
          {{ $t("newOrderFor") }} {{ customer.name }}
        </SharedUiButtonBase>
      </div>

      <!-- Main content -->
      <div class="profile-main">
        <SharedUiNavigationTabs
          v-model="activeTab"
          :tabs="tabs"
          variant="underlined"
          scrollable
        >
          <template #tab-orders>
            <div class="tab-content">
              <SharedUiTableDataTable
                :columns="orderCols"
                :data="customer.orders || []"
                empty-icon="mdi:receipt-text-outline"
                empty-text="noOrders"
                row-clickable
                @row-click="(r) => navigateTo('/dashboard/orders/' + r.id)"
              >
                <template #cell-status="{ row }">
                  <span class="badge" :class="statusClass(row.status)">{{
                    $t("order." + row.status)
                  }}</span>
                </template>
                <template #cell-total_sp="{ row }">{{
                  fmtSP(row.total_sp)
                }}</template>
                <template #cell-order_date="{ row }">{{
                  new Date(row.order_date).toLocaleDateString()
                }}</template>
              </SharedUiTableDataTable>
            </div>
          </template>

          <template #tab-dues>
            <div class="tab-content">
              <SharedUiTableDataTable
                :columns="dueCols"
                :data="customer.dues?.filter((d) => !d._deleted) || []"
                empty-icon="mdi:cash-clock"
                empty-text="noDues"
              >
                <template #cell-amount="{ row }"
                  >{{ row.amount }} {{ row.currency }}</template
                >

                <template #cell-paid="{ row }">
                  <span
                    class="badge"
                    :class="row.paid ? 'badge-success' : 'badge-warning'"
                  >
                    {{ row.paid ? $t("paid") : $t("unpaid") }}
                  </span>
                </template>
                <template #actions="{ row }">
                  <SharedUiButtonBase
                    v-if="!row.paid"
                    size="sm"
                    icon-left="mdi:check"
                    @click="payDue(row.id)"
                    >{{ $t("markPaid") }}</SharedUiButtonBase
                  >
                </template>
              </SharedUiTableDataTable>
            </div>
          </template>
        </SharedUiNavigationTabs>
      </div>
    </div>

    <!-- Edit modal -->
    <SharedUiDialogAppModal
      v-model="showEditModal"
      :title="$t('editCustomer')"
      max-width="480px"
    >
      <div class="modal-form">
        <SharedUiFormBaseInput
          v-model="editForm.name"
          :label="$t('name')"
          required
        />
        <SharedUiFormBaseInput
          v-model="editForm.phone"
          :label="$t('phone')"
          icon-left="mdi:phone-outline"
        />
        <SharedUiFormBaseInput
          v-model="editForm.address"
          :label="$t('address')"
          icon-left="mdi:map-marker-outline"
        />
        <SharedUiFormBaseTextarea
          v-model="editForm.notes"
          :label="$t('notes')"
          :rows="2"
        />
      </div>
      <template #actions>
        <div class="d-flex gap-2 justify-content-end">
          <SharedUiButtonBase
            variant="outline"
            @click="showEditModal = false"
            >{{ $t("cancel") }}</SharedUiButtonBase
          >
          <SharedUiButtonBase
            :loading="saving"
            icon-left="mdi:content-save-outline"
            @click="saveEdit"
            >{{ $t("save") }}</SharedUiButtonBase
          >
        </div>
      </template>
    </SharedUiDialogAppModal>
  </div>
</template>

<script setup>
definePageMeta({
  searchMeta: {
    label: "Customer Profile",
    labelAr: "ملف العميل",
    icon: "mdi:account-outline",
    group: "Main",
  },
});

// ✅ Top-level
const { getCustomerById, saveCustomer, markDuePaid } = useStore();
const route = useRoute();
const { locale, t: $t } = useI18n();
const { $toast } = useNuxtApp();
const currency = useCurrency();

const loading = ref(true);
const customer = ref(null);
const activeTab = ref("orders");
const showEditModal = ref(false);
const saving = ref(false);
const fmtSP = ref((v) => v);
const editForm = reactive({ name: "", phone: "", address: "", notes: "" });

const tabs = [
  { label: "orderHistory", value: "orders", icon: "mdi:receipt-text-outline" },
  { label: "dues", value: "dues", icon: "mdi:cash-clock" },
];

const orderCols = [
  { key: "order_date", label: "date", sortable: true },
  { key: "total_sp", label: "total", align: "end" },
  { key: "status", label: "status" },
];

const dueCols = [
  { key: "description", label: "description" },
  { key: "amount", label: "amount", align: "end" },
  { key: "due_date", label: "dueDate" },
  { key: "paid", label: "status" },
];

const statusClass = (s) =>
  ({
    pending: "badge-warning",
    partly_paid: "badge-info",
    paid: "badge-success",
  }[s] ?? "");

const load = async () => {
  loading.value = true;
  const r = await getCustomerById(route.params.id);
  if (r.ok) {
    customer.value = r.data;
    Object.assign(editForm, {
      name: r.data.name,
      phone: r.data.phone ?? "",
      address: r.data.address ?? "",
      notes: r.data.notes ?? "",
    });
  }
  loading.value = false;
};

const saveEdit = async () => {
  saving.value = true;
  const r = await saveCustomer({ ...editForm, id: route.params.id });
  if (r.ok) {
    $toast.success($t("saved"));
    showEditModal.value = false;
    load();
  } else $toast.error(r.error);
  saving.value = false;
};

const payDue = async (id) => {
  const r = await markDuePaid(id);
  if (r.ok) {
    $toast.success($t("marked"));
    load();
  } else $toast.error(r.error);
};

onMounted(async () => {
  await currency.loadSettings();
  fmtSP.value = currency.fmtSP;
  await load();
});

watch(useSyncTick(), () => load());
</script>

<style lang="scss" scoped>
.profile-grid {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 1rem;
  align-items: start;
  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
}
.profile-sidebar {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.profile-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 1.5rem;
  text-align: center;
}
.profile-avatar {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 2rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 1rem;
}
.profile-name {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 0.5rem;
}
.profile-contact {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 0.85rem;
  color: var(--text-muted);
  margin: 0 0 4px;
}
.profile-notes {
  font-size: 0.8rem;
  color: var(--text-sub);
  margin: 0.5rem 0 0;
}
.profile-stats {
  display: flex;
  justify-content: space-around;
  padding-top: 1rem;
  margin-top: 1rem;
  border-top: 1px solid var(--border-color);
}
.pstat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.pstat-val {
  font-weight: 700;
  font-size: 1.1rem;
  color: var(--text-primary);
}
.pstat-label {
  font-size: 0.72rem;
  color: var(--text-muted);
}
.profile-main {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 1.5rem;
}
.tab-content {
  padding-top: 1rem;
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
.modal-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.w-100 {
  width: 100%;
}
.loading-center {
  display: flex;
  justify-content: center;
  padding: 4rem;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
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
