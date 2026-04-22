<!-- store-app/pages/dashboard/orders/[id]/index.vue -->
<template>
  <div>
    <SharedUiHeaderPage
      :title="$t('order') + ' #' + route.params.id"
      icon="mdi:receipt-text-outline"
      show-back
      back-to="/dashboard/orders"
      :is-rtl="locale === 'ar'"
      :actions="[
        { label: $t('edit'), icon: 'mdi:pencil-outline', variant: 'outline' },
        {
          label: $t('delete'),
          icon: 'mdi:trash-can-outline',
          variant: 'error',
        },
      ]"
      @action-click="handleAction"
    />

    <div v-if="loading" class="loading-center">
      <Icon name="mdi:loading" size="40" class="spin" />
    </div>

    <div v-else-if="order" class="order-detail-grid">
      <!-- Info card -->
      <div class="detail-card">
        <div class="detail-section-title">{{ $t("orderInfo") }}</div>
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">{{ $t("customer") }}</span>
            <NuxtLink
              v-if="order.customer_id"
              :to="'/dashboard/customers/' + order.customer_id"
              class="info-link"
            >
              {{ order.customer_name || "—" }}
            </NuxtLink>
            <span v-else class="info-value">{{ $t("walkIn") }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">{{ $t("date") }}</span>
            <span class="info-value">{{
              new Date(order.order_date).toLocaleString()
            }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">{{ $t("status") }}</span>
            <span class="badge" :class="statusClass(order.status)">{{
              $t("order." + order.status)
            }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">{{ $t("total") }}</span>
            <span class="info-value strong">{{ fmtSP(order.total_sp) }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">{{ $t("paid") }}</span>
            <span class="info-value">{{
              order.display_currency === "USD"
                ? "$" + order.paid_amount
                : order.paid_amount + " ل.س"
            }}</span>
          </div>
          <div class="info-item" v-if="order.notes">
            <span class="info-label">{{ $t("notes") }}</span>
            <span class="info-value">{{ order.notes }}</span>
          </div>
        </div>

        <!-- Quick pay -->
        <div v-if="order.status !== 'paid'" class="quick-pay">
          <div class="quick-pay-title">{{ $t("recordPayment") }}</div>
          <div class="quick-pay-row">
            <SharedUiFormBaseInput
              v-model.number="payAmount"
              type="number"
              :label="$t('amount')"
              min="0"
            />
            <SharedUiFormBaseSelect
              v-model="payCurrency"
              :options="currencyOptions"
              :label="$t('currency')"
            />
            <SharedUiButtonBase
              icon-left="mdi:check"
              :loading="paying"
              @click="doQuickPay"
              >{{ $t("markPaid") }}</SharedUiButtonBase
            >
          </div>
        </div>
      </div>

      <!-- Items -->
      <div class="detail-card">
        <div class="detail-section-title">{{ $t("orderItems") }}</div>
        <SharedUiTableDataTable
          :columns="itemCols"
          :data="order.items || []"
          empty-icon="mdi:cart-outline"
          empty-text="noItems"
        >
          <template #cell-sell_price_at_sale="{ row }">
            {{ row.sell_price_at_sale }} {{ row.currency_at_sale }}
          </template>
          <template #cell-line_total_sp="{ row }">
            {{ fmtSP(row.line_total_sp) }}
          </template>
        </SharedUiTableDataTable>

        <div class="items-total-row">
          <span>{{ $t("grandTotal") }}</span>
          <strong>{{ fmtSP(order.total_sp) }}</strong>
        </div>
      </div>
    </div>

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
    label: "Order Detail",
    labelAr: "تفاصيل الطلب",
    icon: "mdi:receipt-text-outline",
    group: "Main",
  },
});

// ✅ Top-level
const { getOrderById, deleteOrder, updateOrderPayment } = useStore();
const route = useRoute();
const { locale, t: $t } = useI18n();
const { $toast } = useNuxtApp();
const currency = useCurrency();

const loading = ref(true);
const order = ref(null);
const showDeleteModal = ref(false);
const deleting = ref(false);
const paying = ref(false);
const payAmount = ref(0);
const payCurrency = ref("SP");
const fmtSP = ref((v) => v);

const currencyOptions = [
  { label: "SP (ل.س)", value: "SP" },
  { label: "USD ($)", value: "USD" },
];

const itemCols = [
  { key: "product_name", label: "product" },
  { key: "quantity", label: "qty", },
  { key: "sell_price_at_sale", label: "unitPrice", align: "end" },
  { key: "line_total_sp", label: "total", align: "end" },
];

const statusClass = (s) =>
  ({
    pending: "badge-warning",
    partly_paid: "badge-info",
    paid: "badge-success",
  })[s] ?? "badge-secondary";

const load = async () => {
  loading.value = true;
  const r = await getOrderById(Number(route.params.id));
  if (r.ok) {
    order.value = r.data;
    payAmount.value = 0;
    payCurrency.value = r.data.display_currency;
  }
  loading.value = false;
};

const handleAction = ({ icon }) => {
  if (icon === "mdi:pencil-outline")
    navigateTo("/dashboard/orders/" + route.params.id + "/edit");
  if (icon === "mdi:trash-can-outline") showDeleteModal.value = true;
};

const doDelete = async () => {
  deleting.value = true;
  const r = await deleteOrder(Number(route.params.id));
  if (r.ok) {
    $toast.success($t("deleted"));
    navigateTo("/dashboard/orders");
  } else $toast.error(r.error);
  deleting.value = false;
};

const doQuickPay = async () => {
  paying.value = true;
  const r = await updateOrderPayment({
    id: Number(route.params.id),
    paid_amount: payAmount.value,
    display_currency: payCurrency.value,
  });
  if (r.ok) {
    $toast.success($t("paymentRecorded"));
    load();
  } else $toast.error(r.error);
  paying.value = false;
};

onMounted(async () => {
  await currency.loadSettings();
  fmtSP.value = currency.fmtSP;
  await load();
});
</script>

<style lang="scss" scoped>
.order-detail-grid {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.detail-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 1.5rem;
}
.detail-section-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 1.25rem;
}
.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
}
.info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.info-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.info-value {
  font-size: 0.9rem;
  color: var(--text-primary);
}
.info-value.strong {
  font-weight: 700;
  font-size: 1.1rem;
  color: var(--primary);
}
.info-link {
  color: var(--primary);
  text-decoration: none;
  font-weight: 600;
  font-size: 0.9rem;
}
.badge {
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
  width: fit-content;
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

.quick-pay {
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border-color);
}
.quick-pay-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 1rem;
}
.quick-pay-row {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
}

.items-total-row {
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-color);
  font-size: 1rem;
  font-weight: 700;
  color: var(--primary);
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
