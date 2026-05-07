<!-- store-app/components/Dashboard/Orders/Detail.vue -->
<template>
  <div>
    <SharedUiHeaderPage
      :title="$t('Order')"
      icon="mdi:receipt-text-outline"
      show-back
      back-to="/dashboard/orders"
      :is-rtl="locale === 'ar'"
      :actions="headerActions"
      @action-click="handleAction"
    />

    <div v-if="loading" class="loading-center">
      <Icon name="mdi:loading" size="40" class="spin" />
    </div>

    <div v-else-if="order" class="order-detail-grid">
      <!-- Info Card -->
      <div class="detail-card">
        <div class="card-head">
          <Icon name="mdi:information-outline" size="18" />
          <div class="detail-section-title">{{ $t("orderInfo") }}</div>
          <span class="badge ms-auto" :class="statusClass(order.status)">
            {{ $t("order." + order.status) }}
          </span>
        </div>

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
            <span class="info-label">{{ $t("total") }}</span>
            <span class="info-value strong">{{
              fmtOrder(order.total_sp)
            }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">{{ $t("collected") }}</span>
            <span class="info-value strong collected">{{
              fmtOrder(totalPaidSP)
            }}</span>
          </div>
          <div v-if="remainingSP > 0.01" class="info-item">
            <span class="info-label">{{ $t("remaining") }}</span>
            <span class="info-value strong remaining">{{
              fmtOrder(remainingSP)
            }}</span>
          </div>
          <div v-if="order.notes" class="info-item info-item--full">
            <span class="info-label">{{ $t("notes") }}</span>
            <span class="info-value">{{ order.notes }}</span>
          </div>
        </div>

        <!-- Progress bar -->
        <div v-if="order.total_sp > 0" class="payment-progress">
          <div class="progress-labels">
            <span>{{ $t("paymentProgress") }}</span>
            <span class="progress-pct">{{ progressPct }}%</span>
          </div>
          <div class="progress-track">
            <div
              class="progress-fill"
              :style="{ width: progressPct + '%' }"
              :class="progressClass"
            />
          </div>
        </div>

        <!-- Action buttons — guarded by props -->
        <div class="order-actions-row">
          <SharedUiButtonBase
            v-if="order.status !== 'paid'"
            icon-left="mdi:cash-check"
            variant="success"
            :loading="markingPaid"
            @click="doMarkFullyPaid"
          >
            {{ $t("markFullyPaid") }}
          </SharedUiButtonBase>

          <SharedUiButtonBase
            icon-left="mdi:cash-multiple"
            variant="outline"
            @click="showPaymentsDialog = true"
          >
            {{ $t("viewPayments") }}
            <span v-if="order.payments?.length" class="payment-count-badge">{{
              order.payments.length
            }}</span>
          </SharedUiButtonBase>

          <SharedUiButtonBase
            v-if="order.status !== 'paid'"
            icon-left="mdi:plus"
            @click="openAddPayment"
          >
            {{ $t("addPayment") }}
          </SharedUiButtonBase>
        </div>
      </div>

      <!-- Items Card -->
      <div class="detail-card">
        <div class="card-head">
          <Icon name="mdi:cart-outline" size="18" />
          <div class="detail-section-title">{{ $t("orderItems") }}</div>
          <span class="item-count-badge">{{ order.items?.length ?? 0 }}</span>
        </div>

        <div v-if="!order.items?.length" class="items-empty">
          <Icon name="mdi:cart-outline" size="36" />
          <p>{{ $t("noItems") }}</p>
        </div>

        <template v-else>
          <SharedUiTableDataTable
            :columns="itemCols"
            :data="order.items"
            empty-icon="mdi:cart-outline"
            empty-text="noItems"
          >
            <template #cell-sell_price_at_sale="{ row }">
              {{ fmtTx(row.sell_price_at_sale, row.currency_at_sale, null) }}
            </template>
            <template #cell-line_total_sp="{ row }">
              {{
                fmtTx(
                  row.sell_price_at_sale * row.quantity,
                  row.currency_at_sale,
                  row.line_total_sp,
                )
              }}
            </template>
          </SharedUiTableDataTable>
          <div class="items-total-row">
            <span>{{ $t("grandTotal") }}</span>
            <strong>{{ fmtOrder(order.total_sp) }}</strong>
          </div>
        </template>
      </div>
    </div>

    <!-- Payments Dialog -->
    <SharedUiDialogAppModal
      v-model="showPaymentsDialog"
      :title="$t('payments')"
      max-width="620px"
    >
      <div class="payment-summary-strip">
        <div class="summary-item">
          <span class="summary-label">{{ $t("orderTotal") }}</span>
          <strong>{{ fmtOrder(order?.total_sp ?? 0) }}</strong>
        </div>
        <div class="summary-divider" />
        <div class="summary-item">
          <span class="summary-label">{{ $t("totalPaid") }}</span>
          <strong class="text-success">{{ fmtOrder(totalPaidSP) }}</strong>
        </div>
        <div class="summary-divider" />
        <div class="summary-item">
          <span class="summary-label">{{ $t("remaining") }}</span>
          <strong :class="remainingSP > 0.01 ? 'text-warning' : 'text-success'">
            {{ fmtOrder(Math.max(0, remainingSP)) }}
          </strong>
        </div>
      </div>

      <div v-if="order?.status !== 'paid'" class="add-payment-form">
        <div class="form-section-title">
          <Icon name="mdi:plus-circle-outline" size="16" />
          {{ $t("addPayment") }}
        </div>
        <div class="add-payment-row">
          <SharedUiFormBaseInput
            v-model.number="newPayAmount"
            type="number"
            :label="$t('amount')"
            :placeholder="fmtRaw(remainingSP)"
            min="0"
            step="any"
            class="pay-input"
          />
          <SharedUiFormBaseSelect
            v-model="newPayCurrency"
            :options="currencyOptions"
            :label="$t('currency')"
            class="pay-currency"
          />
          <SharedUiFormBaseInput
            v-model="newPayNote"
            :label="$t('note')"
            :placeholder="$t('optional')"
            class="pay-note"
          />
        </div>
        <div class="add-payment-actions">
          <SharedUiButtonBase
            size="sm"
            variant="outline"
            icon-left="mdi:cash-fast"
            :loading="addingPayment"
            @click="doAddRemainingAsPayment"
          >
            {{ $t("payRemaining") }} ({{ fmtOrder(remainingSP) }})
          </SharedUiButtonBase>
          <SharedUiButtonBase
            size="sm"
            icon-left="mdi:check"
            :loading="addingPayment"
            :disabled="!newPayAmount || newPayAmount <= 0"
            @click="doAddPayment"
          >
            {{ $t("addPayment") }}
          </SharedUiButtonBase>
        </div>
      </div>

      <div class="payments-list-section">
        <div class="form-section-title">
          <Icon name="mdi:history" size="16" />
          {{ $t("paymentHistory") }}
        </div>
        <div v-if="!order?.payments?.length" class="payments-empty">
          <Icon name="mdi:cash-remove" size="32" />
          <p>{{ $t("noPayments") }}</p>
        </div>
        <div v-else class="payments-list">
          <div
            v-for="(p, idx) in order.payments"
            :key="p.id"
            class="payment-row"
          >
            <div class="payment-index">#{{ idx + 1 }}</div>
            <div class="payment-info">
              <div class="payment-amount">
                <strong>{{ p.amount }} {{ p.currency }}</strong>
                <span v-if="p.currency !== reportCurrency" class="payment-equiv"
                  >≈ {{ fmtTx(p.amount, p.currency, p.amount_sp) }}</span
                >
              </div>
              <div class="payment-meta">
                <span class="payment-date">{{
                  new Date(p.paid_at).toLocaleString()
                }}</span>
                <span v-if="p.note" class="payment-note">· {{ p.note }}</span>
              </div>
            </div>
            <button
              class="payment-del-btn"
              :title="$t('delete')"
              @click="confirmDeletePayment(p)"
            >
              <Icon name="mdi:trash-can-outline" size="14" />
            </button>
          </div>
        </div>
      </div>

      <template #actions>
        <div class="d-flex gap-2 justify-content-end">
          <SharedUiButtonBase
            v-if="order?.status !== 'paid'"
            variant="success"
            icon-left="mdi:cash-check"
            :loading="markingPaid"
            @click="doMarkFullyPaid"
          >
            {{ $t("markFullyPaid") }}
          </SharedUiButtonBase>
          <SharedUiButtonBase
            variant="outline"
            @click="showPaymentsDialog = false"
            >{{ $t("close") }}</SharedUiButtonBase
          >
        </div>
      </template>
    </SharedUiDialogAppModal>

    <!-- Delete Payment Confirm -->
    <SharedUiDialogAppModal
      v-model="showDeletePaymentModal"
      :title="$t('deletePayment')"
      max-width="420px"
    >
      <p>{{ $t("deletePaymentConfirm") }}</p>
      <div v-if="paymentToDelete" class="delete-confirm-detail">
        <strong
          >{{ paymentToDelete.amount }} {{ paymentToDelete.currency }}</strong
        >
        · {{ new Date(paymentToDelete.paid_at).toLocaleDateString() }}
      </div>
      <template #actions>
        <div class="d-flex gap-2 justify-content-end">
          <SharedUiButtonBase
            variant="outline"
            @click="showDeletePaymentModal = false"
            >{{ $t("cancel") }}</SharedUiButtonBase
          >
          <SharedUiButtonBase
            variant="error"
            :loading="deletingPayment"
            icon-left="mdi:trash-can-outline"
            @click="doDeletePayment"
          >
            {{ $t("delete") }}
          </SharedUiButtonBase>
        </div>
      </template>
    </SharedUiDialogAppModal>

    <!-- Delete Order Confirm -->
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
const props = defineProps({
  canEdit: { type: Boolean, default: false },
  canDelete: { type: Boolean, default: false },
});

const {
  getOrderById,
  deleteOrder,
  addOrderPayment,
  deleteOrderPayment,
  markOrderFullyPaid,
} = useStore();
const route = useRoute();
const { locale, t: $t } = useI18n();
const { $toast } = useNuxtApp();
const {
  fmtTx,
  dollarRate,
  reportCurrency: reportCurrencyRef,
  loadSettings,
} = useCurrency();

const reportCurrency = computed(() => reportCurrencyRef.value);

const loading = ref(true);
const order = ref(null);
const showDeleteModal = ref(false);
const deleting = ref(false);
const showPaymentsDialog = ref(false);
const addingPayment = ref(false);
const markingPaid = ref(false);
const newPayAmount = ref(0);
const newPayCurrency = ref("SP");
const newPayNote = ref("");
const showDeletePaymentModal = ref(false);
const deletingPayment = ref(false);
const paymentToDelete = ref(null);

const currencyOptions = [
  { label: "SP (ل.س)", value: "SP" },
  { label: "USD ($)", value: "USD" },
];

const itemCols = [
  { key: "product_name", label: "product" },
  { key: "quantity", label: "qty" },
  { key: "sell_price_at_sale", label: "unitPrice" },
  { key: "line_total_sp", label: "total" },
];

// ── Header actions — only show edit/delete when permitted ──────────────────
const headerActions = computed(() => {
  const actions = [];
  if (props.canEdit)
    actions.push({
      key: "edit",
      label: $t("edit"),
      icon: "mdi:pencil-outline",
      variant: "outline",
    });
  if (props.canDelete)
    actions.push({
      key: "delete",
      label: $t("delete"),
      icon: "mdi:trash-can-outline",
      variant: "error",
    });
  return actions;
});

const handleAction = (action) => {
  if (action.key === "delete") showDeleteModal.value = true;
  if (action.key === "edit")
    navigateTo(`/dashboard/orders/${route.params.id}/edit`);
};

const statusClass = (s) =>
  ({
    pending: "badge-warning",
    partly_paid: "badge-info",
    paid: "badge-success",
  }[s] ?? "badge-secondary");

// ── Display ────────────────────────────────────────────────────────────────
const fmtOrder = (spValue) => {
  if (!order.value) return "";
  if (order.value.display_currency === "USD") {
    const rate =
      order.value.total_sp > 0
        ? order.value.total_usd / order.value.total_sp
        : 1 / (dollarRate.value ?? 15000);
    return fmtTx(spValue * rate, "USD", spValue ?? 0);
  }
  return fmtTx(spValue ?? 0, "SP", spValue ?? 0);
};

const fmtRaw = (remainingSp) => {
  if (newPayCurrency.value === "USD")
    return (remainingSp / (dollarRate.value ?? 15000)).toFixed(2);
  return Math.round(remainingSp).toLocaleString();
};

// ── Computed ───────────────────────────────────────────────────────────────
const totalPaidSP = computed(
  () =>
    order.value?.payments?.reduce((s, p) => s + (p.amount_sp ?? 0), 0) ??
    order.value?.total_paid_sp ??
    0,
);
const remainingSP = computed(() =>
  Math.max(0, (order.value?.total_sp ?? 0) - totalPaidSP.value),
);
const progressPct = computed(() => {
  if (!order.value?.total_sp) return 0;
  return Math.min(
    100,
    Math.round((totalPaidSP.value / order.value.total_sp) * 100),
  );
});
const progressClass = computed(() => {
  if (progressPct.value >= 100) return "fill-paid";
  if (progressPct.value > 0) return "fill-partial";
  return "fill-pending";
});

// ── Load ───────────────────────────────────────────────────────────────────
const load = async () => {
  loading.value = true;
  const r = await getOrderById(route.params.id);
  if (r.ok) {
    order.value = r.data;
    newPayCurrency.value = r.data.display_currency ?? "SP";
  }
  loading.value = false;
};

// ── Actions ────────────────────────────────────────────────────────────────
const doDelete = async () => {
  deleting.value = true;
  const r = await deleteOrder(route.params.id);
  if (r.ok) {
    $toast.success($t("deleted"));
    navigateTo("/dashboard/orders");
  } else $toast.error(r.error);
  deleting.value = false;
};

const openAddPayment = () => {
  newPayAmount.value = 0;
  newPayNote.value = "";
  showPaymentsDialog.value = true;
};

const doAddPayment = async () => {
  if (!newPayAmount.value || newPayAmount.value <= 0) return;
  addingPayment.value = true;
  const r = await addOrderPayment({
    order_id: route.params.id,
    amount: newPayAmount.value,
    currency: newPayCurrency.value,
    note: newPayNote.value || null,
  });
  if (r.ok) {
    $toast.success($t("paymentAdded"));
    newPayAmount.value = 0;
    newPayNote.value = "";
    await load();
  } else $toast.error(r.error);
  addingPayment.value = false;
};

const doAddRemainingAsPayment = async () => {
  if (remainingSP.value <= 0.01) return;
  addingPayment.value = true;
  const rate = dollarRate.value ?? 15000;
  const amt =
    newPayCurrency.value === "USD"
      ? remainingSP.value / rate
      : remainingSP.value;
  const r = await addOrderPayment({
    order_id: route.params.id,
    amount: parseFloat(amt.toFixed(2)),
    currency: newPayCurrency.value,
    note: newPayNote.value || $t("remainingPayment"),
  });
  if (r.ok) {
    $toast.success($t("paymentAdded"));
    newPayNote.value = "";
    await load();
  } else $toast.error(r.error);
  addingPayment.value = false;
};

const doMarkFullyPaid = async () => {
  markingPaid.value = true;
  const r = await markOrderFullyPaid({
    order_id: route.params.id,
    currency: newPayCurrency.value,
    note: $t("fullPayment"),
  });
  if (r.ok) {
    $toast.success($t("orderMarkedPaid"));
    await load();
    showPaymentsDialog.value = false;
  } else $toast.error(r.error);
  markingPaid.value = false;
};

const confirmDeletePayment = (p) => {
  paymentToDelete.value = p;
  showDeletePaymentModal.value = true;
};

const doDeletePayment = async () => {
  if (!paymentToDelete.value) return;
  deletingPayment.value = true;
  const r = await deleteOrderPayment(paymentToDelete.value.id);
  if (r.ok) {
    $toast.success($t("deleted"));
    showDeletePaymentModal.value = false;
    paymentToDelete.value = null;
    await load();
  } else $toast.error(r.error);
  deletingPayment.value = false;
};

onMounted(async () => {
  await loadSettings();
  await load();
});
watch(useSyncTick(), () => load());
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
.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 1.25rem;
  color: var(--text-sub);
}
.detail-section-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-primary);
  flex: 1;
}
.item-count-badge {
  font-size: 0.7rem;
  font-weight: 700;
  background: var(--primary-soft);
  color: var(--primary);
  padding: 2px 8px;
  border-radius: 20px;
}
.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 1rem;
  margin-bottom: 1.25rem;
}
.info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  &--full {
    grid-column: 1/-1;
  }
}
.info-label {
  font-size: 0.72rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}
.info-value {
  font-size: 0.9rem;
  color: var(--text-primary);
  &.strong {
    font-weight: 700;
    font-size: 1.05rem;
    color: var(--primary);
  }
  &.collected {
    color: #10b981;
  }
  &.remaining {
    color: #f59e0b;
  }
}
.info-link {
  color: var(--primary);
  text-decoration: none;
  font-weight: 600;
  font-size: 0.9rem;
}
.payment-progress {
  margin-bottom: 1.25rem;
}
.progress-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.progress-pct {
  font-weight: 700;
  color: var(--text-primary);
}
.progress-track {
  height: 8px;
  background: var(--bg-elevated);
  border-radius: 20px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  border-radius: 20px;
  transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  &.fill-paid {
    background: linear-gradient(90deg, #10b981, #34d399);
  }
  &.fill-partial {
    background: linear-gradient(90deg, #f59e0b, #fbbf24);
  }
  &.fill-pending {
    background: var(--border-color);
    width: 4px !important;
  }
}
.order-actions-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  padding-top: 1rem;
  border-top: 1px solid var(--border-color);
}
.payment-count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--primary);
  color: #fff;
  font-size: 0.65rem;
  font-weight: 700;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  margin-inline-start: 4px;
}
.items-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 2rem;
  color: var(--text-muted);
  text-align: center;
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
.payment-summary-strip {
  display: flex;
  background: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 1.25rem;
}
.summary-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 10px;
  text-align: center;
}
.summary-divider {
  width: 1px;
  background: var(--border-color);
  margin: 10px 0;
}
.summary-label {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  font-weight: 600;
}
.add-payment-form {
  background: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 1rem;
  margin-bottom: 1.25rem;
}
.form-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text-primary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 10px;
}
.add-payment-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: flex-end;
  margin-bottom: 10px;
}
.pay-input {
  flex: 1 1 100px;
}
.pay-currency {
  flex: 0 1 110px;
}
.pay-note {
  flex: 2 1 140px;
}
.add-payment-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.payments-list-section {
  margin-top: 0.5rem;
}
.payments-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 1.5rem;
  color: var(--text-muted);
  text-align: center;
}
.payments-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.payment-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  transition: border-color 0.15s;
  &:hover {
    border-color: var(--primary);
  }
}
.payment-index {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--text-muted);
  min-width: 24px;
}
.payment-info {
  flex: 1;
  min-width: 0;
}
.payment-amount {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
  strong {
    color: var(--text-primary);
  }
}
.payment-equiv {
  font-size: 0.75rem;
  color: var(--text-muted);
}
.payment-meta {
  display: flex;
  gap: 6px;
  margin-top: 2px;
  font-size: 0.72rem;
  color: var(--text-muted);
}
.payment-date {
  white-space: nowrap;
}
.payment-note {
  font-style: italic;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.payment-del-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: rgba(239, 68, 68, 0.08);
  border-radius: 6px;
  cursor: pointer;
  color: #ef4444;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
  flex-shrink: 0;
  &:hover {
    background: rgba(239, 68, 68, 0.18);
  }
}
.delete-confirm-detail {
  margin-top: 10px;
  padding: 8px 12px;
  background: var(--bg-elevated);
  border-radius: 8px;
  font-size: 0.85rem;
  color: var(--text-primary);
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
.ms-auto {
  margin-inline-start: auto;
}
.text-success {
  color: #10b981 !important;
}
.text-warning {
  color: #f59e0b !important;
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
