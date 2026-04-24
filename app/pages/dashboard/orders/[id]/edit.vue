<!-- store-app/pages/dashboard/orders/[id]/edit.vue -->
<!-- Thin wrapper: loads the order then renders the same new-order form -->
<template>
  <div>
    <SharedUiHeaderPage
      :title="$t('editOrder')"
      icon="mdi:receipt-text-edit-outline"
      show-back
      :back-to="'/dashboard/orders/' + route.params.id"
      :is-rtl="locale === 'ar'"
    />

    <div v-if="loading" class="loading-center">
      <Icon name="mdi:loading" size="40" class="spin" />
    </div>

    <div v-else class="order-form-grid">
      <!-- LEFT: customer + items -->
      <div class="order-main">
        <!-- Customer -->
        <div class="form-card">
          <div class="card-title-row">
            <Icon name="mdi:account-outline" size="18" />
            <h4>{{ $t("customer") }}</h4>
          </div>
          <div class="customer-row">
            <div class="customer-combo">
              <SharedUiFormBaseInput
                v-model="customerSearch"
                :placeholder="$t('typeCustomerName')"
                icon-left="mdi:account-search-outline"
                clearable
                @input="onCustomerInput"
                @focus="showDropdown = true"
              />
              <div
                v-if="showDropdown && suggestions.length"
                class="combo-dropdown"
              >
                <button
                  v-for="c in suggestions"
                  :key="c.id"
                  class="combo-item"
                  @mousedown.prevent="selectCustomer(c)"
                >
                  <Icon name="mdi:account-outline" size="14" />
                  {{ c.name }}
                  <span v-if="c.phone" class="combo-sub">{{ c.phone }}</span>
                </button>
                <button
                  v-if="customerSearch && !exactMatch"
                  class="combo-item combo-create"
                  @mousedown.prevent="createCustomer"
                >
                  <Icon name="mdi:plus" size="14" />
                  {{ $t("createCustomer") }}:
                  <strong>{{ customerSearch }}</strong>
                </button>
              </div>
            </div>
            <div v-if="selectedCustomer" class="selected-chip">
              <Icon name="mdi:check-circle" size="16" class="chip-check" />
              {{ selectedCustomer.name }}
              <button
                class="chip-remove"
                @click="
                  selectedCustomer = null;
                  customerSearch = '';
                "
              >
                <Icon name="mdi:close" size="14" />
              </button>
            </div>
          </div>
        </div>

        <!-- Items -->
        <div class="form-card">
          <div class="card-title-row">
            <Icon name="mdi:package-variant-outline" size="18" />
            <h4>{{ $t("orderItems") }}</h4>
            <SharedUiButtonBase
              size="sm"
              icon-left="mdi:plus"
              @click="addItem"
              >{{ $t("addItem") }}</SharedUiButtonBase
            >
          </div>
          <div v-if="!items.length" class="items-empty">
            <Icon name="mdi:cart-outline" size="40" />
            <p>{{ $t("noItemsYet") }}</p>
          </div>
          <div v-else class="items-list">
            <div v-for="(item, idx) in items" :key="idx" class="item-row">
              <div class="item-product">
                <SharedUiFormBaseSelect
                  v-model="item.product_id"
                  :options="productOptions"
                  :placeholder="$t('selectProduct')"
                  searchable
                  @change="onProductSelect(idx, $event)"
                />
              </div>
              <div class="item-price">
                <SharedUiFormBaseInput
                  v-model.number="item.sell_price_at_sale"
                  type="number"
                  :label="$t('price')"
                  min="0"
                />
              </div>
              <div class="item-currency">
                <SharedUiFormBaseSelect
                  v-model="item.currency_at_sale"
                  :options="currencyOptions"
                  :label="$t('currency')"
                />
              </div>
              <div class="item-qty">
                <SharedUiFormBaseInput
                  v-model.number="item.quantity"
                  type="number"
                  :label="$t('qty')"
                  min="1"
                />
                <span v-if="item._maxStock" class="stock-hint"
                  >{{ $t("stock") }}: {{ item._maxStock }}</span
                >
              </div>
              <div class="item-total">
                <span class="total-label">{{ $t("lineTotal") }}</span>
                <span class="total-value">{{ fmtSP(lineTotalSP(item)) }}</span>
              </div>
              <button class="item-remove" @click="items.splice(idx, 1)">
                <Icon name="mdi:trash-can-outline" size="18" />
              </button>
            </div>
          </div>
        </div>

        <div class="form-card">
          <SharedUiFormBaseTextarea
            v-model="orderNotes"
            :label="$t('notes')"
            :rows="3"
          />
        </div>
      </div>

      <!-- RIGHT: summary -->
      <div class="order-sidebar">
        <div class="form-card summary-card">
          <div class="card-title-row">
            <Icon name="mdi:calculator-outline" size="18" />
            <h4>{{ $t("orderSummary") }}</h4>
          </div>
          <div class="summary-lines">
            <div class="sum-row">
              <span>{{ $t("total") }}</span
              ><strong class="sum-total">{{ fmtSP(grandTotalSP) }}</strong>
            </div>
          </div>
          <div class="payment-section">
            <SharedUiFormBaseInput
              v-model.number="paidAmount"
              type="number"
              :label="$t('paidAmount')"
              min="0"
            />
            <SharedUiFormBaseSelect
              v-model="displayCurrency"
              :options="currencyOptions"
              :label="$t('paidCurrency')"
            />
            <div class="status-preview">
              <span class="status-label">{{ $t("status") }}:</span>
              <span class="badge" :class="statusClass(previewStatus)">{{
                $t("order." + previewStatus)
              }}</span>
            </div>
          </div>
          <SharedUiButtonBase
            class="w-100 mt-3"
            size="lg"
            icon-left="mdi:content-save-outline"
            :loading="saving"
            :disabled="!items.length"
            @click="save"
          >
            {{ $t("saveChanges") }}
          </SharedUiButtonBase>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
const route = useRoute();
const { locale } = useI18n();
const { t: $t } = useI18n();
const { $toast } = useNuxtApp();
const {
  getProducts,
  getCustomers,
  findOrCreateCustomer,
  getOrderById,
  saveOrder,
} = useStore();
const { fmtSP, toSP, dollarRate } = useCurrency();

const loading = ref(true);
const saving = ref(false);

const customerSearch = ref("");
const showDropdown = ref(false);
const suggestions = ref([]);
const selectedCustomer = ref(null);
const allProducts = ref([]);
const items = ref([]);
const paidAmount = ref(0);
const displayCurrency = ref("SP");
const orderNotes = ref("");

const currencyOptions = [
  { label: "SP (ل.س)", value: "SP" },
  { label: "USD ($)", value: "USD" },
];
const productOptions = computed(() =>
  allProducts.value.map((p) => ({
    label: `${p.name} (${p.stock} ${p.unit})`,
    value: p.id,
  })),
);
const exactMatch = computed(() =>
  suggestions.value.some(
    (c) => c.name.toLowerCase() === customerSearch.value.toLowerCase(),
  ),
);
const grandTotalSP = computed(() =>
  items.value.reduce((s, i) => s + lineTotalSP(i), 0),
);
const previewStatus = computed(() => {
  const paidSP = toSP(paidAmount.value, displayCurrency.value);
  if (paidSP <= 0) return "pending";
  if (paidSP >= grandTotalSP.value - 0.001) return "paid";
  return "partly_paid";
});

const lineTotalSP = (i) =>
  toSP(i.sell_price_at_sale * (i.quantity || 1), i.currency_at_sale);
const statusClass = (s) =>
  ({
    pending: "badge-warning",
    partly_paid: "badge-info",
    paid: "badge-success",
  }[s] ?? "");

let customerTimer;
const onCustomerInput = () => {
  clearTimeout(customerTimer);
  if (!customerSearch.value.trim()) {
    suggestions.value = [];
    return;
  }
  customerTimer = setTimeout(async () => {
    const r = await getCustomers({ search: customerSearch.value, limit: 6 });
    if (r.ok) suggestions.value = r.data;
  }, 250);
};
const selectCustomer = (c) => {
  selectedCustomer.value = c;
  customerSearch.value = c.name;
  showDropdown.value = false;
};
const createCustomer = async () => {
  const r = await findOrCreateCustomer(customerSearch.value);
  if (r.ok) selectCustomer(r.data);
};
const addItem = () =>
  items.value.push({
    product_id: null,
    product_name: "",
    quantity: 1,
    sell_price_at_sale: 0,
    currency_at_sale: "SP",
    _maxStock: null,
  });
const onProductSelect = (idx, pid) => {
  const p = allProducts.value.find((x) => x.id === pid);
  if (!p) return;
  items.value[idx] = {
    ...items.value[idx],
    product_name: p.name,
    sell_price_at_sale: p.sell_price,
    currency_at_sale: p.currency,
    _maxStock: p.stock,
  };
};

const save = async () => {
  saving.value = true;
  const r = await saveOrder({
    order: {
      id: route.params.id,
      customer_id: selectedCustomer.value?.id ?? null,
      order_date: new Date().toISOString(),
      paid_amount: paidAmount.value,
      display_currency: displayCurrency.value,
      notes: orderNotes.value,
    },
    items: items.value.map((i) => ({
      product_id: i.product_id,
      product_name: i.product_name || "Unknown",
      quantity: i.quantity,
      sell_price_at_sale: i.sell_price_at_sale,
      currency_at_sale: i.currency_at_sale,
    })),
  });
  saving.value = false;
  if (r.ok) {
    $toast.success($t("orderUpdated"));
    navigateTo("/dashboard/orders/" + route.params.id);
  } else $toast.error(r.error);
};

onMounted(async () => {
  document.addEventListener("click", () => {
    showDropdown.value = false;
  });
  const [pR, oR] = await Promise.all([
    getProducts({ limit: 500, activeOnly: true }),
    getOrderById(route.params.id),
  ]);
  if (pR.ok) allProducts.value = pR.data;
  if (oR.ok) {
    const o = oR.data;
    selectedCustomer.value = o.customer_id
      ? { id: o.customer_id, name: o.customer_name }
      : null;
    customerSearch.value = o.customer_name ?? "";
    paidAmount.value = o.paid_amount;
    displayCurrency.value = o.display_currency;
    orderNotes.value = o.notes ?? "";
    items.value = (o.items ?? []).map((i) => ({
      product_id: i.product_id,
      product_name: i.product_name,
      quantity: i.quantity,
      sell_price_at_sale: i.sell_price_at_sale,
      currency_at_sale: i.currency_at_sale,
      _maxStock: i.current_stock,
    }));
  }
  loading.value = false;
});
</script>

<style lang="scss" scoped>
.order-form-grid {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 1.5rem;
  align-items: start;
  @media (max-width: 991px) {
    grid-template-columns: 1fr;
  }
}
.order-main {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.form-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 1.5rem;
}
.card-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 1.25rem;
  h4 {
    font-size: 0.95rem;
    font-weight: 700;
    margin: 0;
    flex: 1;
    color: var(--text-primary);
  }
}
.customer-row {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.customer-combo {
  position: relative;
}
.combo-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  inset-inline-start: 0;
  width: 100%;
  z-index: 100;
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  overflow: hidden;
  max-height: 220px;
  overflow-y: auto;
}
.combo-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--text-primary);
  text-align: start;
  &:hover {
    background: var(--bg-elevated);
  }
  &.combo-create {
    color: var(--primary);
    font-weight: 600;
  }
}
.combo-sub {
  color: var(--text-muted);
  font-size: 0.75rem;
  margin-inline-start: auto;
}
.selected-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--primary-soft);
  border-radius: 20px;
  padding: 6px 12px;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--primary);
}
.chip-check {
  color: #10b981;
}
.chip-remove {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--primary);
  display: flex;
  padding: 0;
}
.items-empty {
  text-align: center;
  padding: 2rem;
  color: var(--text-muted);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.items-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.item-row {
  display: grid;
  grid-template-columns: 1fr 120px 100px 80px auto auto;
  gap: 10px;
  align-items: end;
  @media (max-width: 768px) {
    grid-template-columns: 1fr 1fr;
  }
}
.item-total {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.total-label {
  font-size: 0.72rem;
  color: var(--text-muted);
}
.total-value {
  font-weight: 700;
  color: var(--text-primary);
  font-size: 0.9rem;
}
.stock-hint {
  font-size: 0.72rem;
  color: var(--text-muted);
  margin-top: 2px;
  display: block;
}
.item-remove {
  width: 34px;
  height: 34px;
  border: none;
  background: rgba(239, 68, 68, 0.08);
  border-radius: 8px;
  cursor: pointer;
  color: #ef4444;
  display: flex;
  align-items: center;
  justify-content: center;
  &:hover {
    background: rgba(239, 68, 68, 0.18);
  }
}
.summary-card {
  position: sticky;
  top: 0;
}
.summary-lines {
  margin-bottom: 1.25rem;
}
.sum-row {
  display: flex;
  justify-content: space-between;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
}
.sum-total {
  font-size: 1.25rem;
  color: var(--primary);
}
.payment-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 1rem;
  border-top: 1px solid var(--border-color);
}
.status-preview {
  display: flex;
  align-items: center;
  gap: 8px;
}
.status-label {
  font-size: 0.85rem;
  color: var(--text-muted);
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
.w-100 {
  width: 100%;
}
.mt-3 {
  margin-top: 1rem;
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
</style>
