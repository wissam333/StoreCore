<!-- store-app/pages/dashboard/orders/new.vue -->
<!-- New order (and edit when route.params.id exists) -->
<template>
  <div>
    <SharedUiHeaderPage
      :title="isEdit ? $t('editOrder') : $t('newOrder')"
      :subtitle="isEdit ? $t('editOrderSubtitle') : $t('newOrderSubtitle')"
      icon="mdi:receipt-text-plus-outline"
      show-back
      :back-to="
        isEdit ? '/dashboard/orders/' + route.params.id : '/dashboard/orders'
      "
      :is-rtl="locale === 'ar'"
    />

    <div class="order-layout">
      <!-- ── LEFT column ──────────────────────────────────────────────────── -->
      <div class="order-main">
        <!-- Customer card -->
        <div class="form-card">
          <div class="card-head">
            <Icon name="mdi:account-outline" size="18" />
            <h4>{{ $t("customer") }}</h4>
            <span v-if="!selectedCustomer" class="optional-badge">{{
              $t("optional")
            }}</span>
          </div>

          <SharedUiFormCombobox
            v-model="selectedCustomer"
            v-model:search="customerSearch"
            :options="customerSuggestions"
            :loading="customerLoading"
            :label="$t('customerName')"
            :placeholder="$t('typeCustomerName')"
            :allow-create="true"
            :create-label="$t('createNew')"
            display-key="name"
            sub-key="phone"
            @update:search="onCustomerSearch"
            @create="onCreateCustomer"
          />
        </div>

        <!-- Items card -->
        <div v-if="!items.length" class="items-empty">
          <Icon name="mdi:cart-outline" size="48" />
          <p>{{ $t("noItemsYet") }}</p>
          <SharedUiButtonBase
            size="sm"
            variant="outline"
            icon-left="mdi:plus"
            @click="addItem"
          >
            {{ $t("addFirstItem") }}
          </SharedUiButtonBase>
        </div>

        <div v-else class="items-list">
          <div v-for="(item, idx) in items" :key="idx" class="item-card">
            <!-- Row 1: Product select + delete -->
            <div class="item-top">
              <div class="item-product">
                <SharedUiFormBaseSelect
                  v-model="item.product_id"
                  :options="productOptions"
                  :placeholder="$t('selectProduct')"
                  searchable
                  @change="onProductSelect(idx, $event)"
                />
                <span
                  v-if="item._maxStock !== null"
                  class="stock-tag"
                  :class="item._maxStock === 0 ? 'stock-out' : ''"
                >
                  <Icon name="mdi:cube-outline" size="12" />
                  {{ $t("inStock") }}: {{ item._maxStock }}
                </span>
              </div>
              <button class="del-btn" @click="items.splice(idx, 1)">
                <Icon name="mdi:trash-can-outline" size="16" />
              </button>
            </div>

            <!-- Row 2: Price · Currency · Qty · Total -->
            <div class="item-bottom">
              <div class="item-field">
                <label class="field-label">{{ $t("price") }}</label>
                <SharedUiFormBaseInput
                  v-model.number="item.sell_price_at_sale"
                  type="number"
                  min="0"
                  step="any"
                />
              </div>

              <div class="item-field item-field--cur">
                <label class="field-label">{{ $t("cur") }}</label>
                <SharedUiFormBaseSelect
                  v-model="item.currency_at_sale"
                  :options="currencyOpts"
                />
              </div>

              <div class="item-field item-field--qty">
                <label class="field-label">{{ $t("qty") }}</label>
                <SharedUiFormBaseInput
                  v-model.number="item.quantity"
                  type="number"
                  min="1"
                  :max="item._maxStock || undefined"
                />
              </div>

              <div class="item-total">
                <label class="field-label">{{ $t("lineTotal") }}</label>
                <strong>{{ fmtSP(lineTotalSP(item)) }}</strong>
              </div>
            </div>
          </div>
        </div>

        <!-- Notes -->
        <div class="form-card">
          <SharedUiFormBaseTextarea
            v-model="orderNotes"
            :label="$t('notes')"
            :placeholder="$t('orderNotesPlaceholder')"
            :rows="3"
          />
        </div>
      </div>

      <!-- ── RIGHT sidebar ────────────────────────────────────────────────── -->
      <div class="order-sidebar">
        <div class="form-card summary-card">
          <div class="card-head">
            <Icon name="mdi:calculator-outline" size="18" />
            <h4>{{ $t("orderSummary") }}</h4>
          </div>

          <!-- Totals -->
          <div class="totals-block">
            <div class="total-line">
              <span>{{ $t("subtotal") }}</span>
              <strong>{{ fmtSP(grandTotalSP) }}</strong>
            </div>
            <div class="total-line total-line--grand">
              <span>{{ $t("total") }}</span>
              <strong class="grand-val">{{ fmtDisplay(grandTotalSP) }}</strong>
            </div>
          </div>

          <!-- Payment -->
          <div class="payment-block">
            <SharedUiFormBaseInput
              v-model.number="paidAmount"
              type="number"
              :label="$t('paidAmount')"
              min="0"
              step="any"
            />
            <SharedUiFormBaseSelect
              v-model="displayCurrency"
              :options="currencyOpts"
              :label="$t('paidCurrency')"
            />

            <!-- Status badge -->
            <div class="status-row">
              <span class="status-key">{{ $t("status") }}:</span>
              <span class="badge" :class="statusClass(previewStatus)">
                {{ $t("order." + previewStatus) }}
              </span>
            </div>

            <!-- Remaining -->
            <div v-if="previewStatus !== 'paid'" class="remaining-row">
              <Icon name="mdi:clock-alert-outline" size="14" />
              {{ $t("remaining") }}: <strong>{{ fmtSP(remainingSP) }}</strong>
            </div>
          </div>

          <SharedUiButtonBase
            class="save-btn"
            size="lg"
            icon-left="mdi:content-save-outline"
            :loading="saving"
            :disabled="!items.length"
            @click="save"
          >
            {{ isEdit ? $t("saveChanges") : $t("createOrder") }}
          </SharedUiButtonBase>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
definePageMeta({
  searchMeta: {
    label: "New Order",
    labelAr: "طلب جديد",
    icon: "mdi:receipt-text-plus-outline",
    group: "Main",
  },
});

const route = useRoute();
const { locale, t: $t } = useI18n();
const { $toast } = useNuxtApp();
const {
  getCustomers,
  findOrCreateCustomer,
  getProducts,
  getOrderById,
  saveOrder,
} = useStore();
const { fmtSP, toSP, dollarRate, reportCurrency, loadSettings } = useCurrency();

const isEdit = computed(
  () => !!route.params.id && route.path.includes("/edit"),
);

// ── Currency ─────────────────────────────────────────────────────────────────
const currencyOpts = [
  { label: "SP (ل.س)", value: "SP" },
  { label: "USD ($)", value: "USD" },
];

// ── Customer combobox state ───────────────────────────────────────────────────
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

// Called when user clicks "Create: <name>"
const onCreateCustomer = async (name) => {
  const r = await findOrCreateCustomer(name);
  if (r.ok) {
    selectedCustomer.value = r.data;
    customerSearch.value = r.data.name;
    $toast.success($t("customerCreated"));
  } else {
    $toast.error(r.error);
  }
};

// ── Products ──────────────────────────────────────────────────────────────────
const allProducts = ref([]);
const productOptions = computed(() =>
  allProducts.value.map((p) => ({
    label: `${p.name}  ·  ${p.stock} ${p.unit}  ·  ${p.sell_price} ${p.currency}`,
    value: p.id,
  })),
);

// ── Items ─────────────────────────────────────────────────────────────────────
const items = ref([]);

const addItem = () =>
  items.value.push({
    product_id: null,
    product_name: "",
    quantity: 1,
    sell_price_at_sale: 0,
    currency_at_sale: "SP",
    _maxStock: null,
  });

const onProductSelect = (idx, productId) => {
  const p = allProducts.value.find((x) => x.id === productId);
  if (!p) return;
  const item = items.value[idx];
  item.product_name = p.name;
  item.sell_price_at_sale = p.sell_price;
  item.currency_at_sale = p.currency;
  item._maxStock = p.stock;
};

// ── Totals ────────────────────────────────────────────────────────────────────
const lineTotalSP = (item) =>
  toSP(item.sell_price_at_sale * (item.quantity || 1), item.currency_at_sale);

const grandTotalSP = computed(() =>
  items.value.reduce((s, i) => s + lineTotalSP(i), 0),
);

const fmtDisplay = (sp) =>
  reportCurrency.value === "USD"
    ? "$" + (sp / dollarRate.value).toFixed(2)
    : sp.toLocaleString("en-us", { maximumFractionDigits: 0 }) + " ل.س";

// ── Payment ───────────────────────────────────────────────────────────────────
const paidAmount = ref(0);
const displayCurrency = ref("SP");
const orderNotes = ref("");

const remainingSP = computed(() =>
  Math.max(
    0,
    grandTotalSP.value - toSP(paidAmount.value, displayCurrency.value),
  ),
);

const previewStatus = computed(() => {
  const paidSP = toSP(paidAmount.value, displayCurrency.value);
  if (paidSP <= 0) return "pending";
  if (paidSP >= grandTotalSP.value - 0.001) return "paid";
  return "partly_paid";
});

const statusClass = (s) =>
  ({
    pending: "badge-warning",
    partly_paid: "badge-info",
    paid: "badge-success",
  })[s] ?? "";

// ── Save ──────────────────────────────────────────────────────────────────────
const saving = ref(false);

const save = async () => {
  if (!items.value.length) return;

  // If user typed a name but never clicked a suggestion — auto-create
  if (!selectedCustomer.value && customerSearch.value.trim()) {
    await onCreateCustomer(customerSearch.value.trim());
  }

  saving.value = true;
  const r = await saveOrder({
    order: {
      id: isEdit.value ? Number(route.params.id) : undefined,
      customer_id: selectedCustomer.value?.id ?? null,
      order_date: new Date().toISOString(),
      paid_amount: paidAmount.value,
      display_currency: displayCurrency.value,
      notes: orderNotes.value,
    },
    items: items.value.map((i) => ({
      product_id: i.product_id,
      product_name:
        i.product_name || i.product_id
          ? allProducts.value.find((p) => p.id === i.product_id)?.name ||
            "Unknown"
          : "Unknown",
      quantity: i.quantity,
      sell_price_at_sale: i.sell_price_at_sale,
      currency_at_sale: i.currency_at_sale,
    })),
  });
  saving.value = false;

  if (r.ok) {
    $toast.success($t(isEdit.value ? "orderUpdated" : "orderCreated"));
    navigateTo("/dashboard/orders/" + r.id);
  } else {
    $toast.error(r.error);
  }
};

// ── Load for edit ─────────────────────────────────────────────────────────────
const loadEdit = async () => {
  if (!isEdit.value || !route.params.id) return;
  const r = await getOrderById(Number(route.params.id));
  if (!r.ok) return;
  const o = r.data;
  // Restore customer — use both id and name so chip shows correctly
  if (o.customer_id) {
    selectedCustomer.value = { id: o.customer_id, name: o.customer_name ?? "" };
    customerSearch.value = o.customer_name ?? "";
  }
  paidAmount.value = o.paid_amount;
  displayCurrency.value = o.display_currency;
  orderNotes.value = o.notes ?? "";
  items.value = (o.items ?? []).map((i) => ({
    product_id: i.product_id,
    product_name: i.product_name,
    quantity: i.quantity,
    sell_price_at_sale: i.sell_price_at_sale,
    currency_at_sale: i.currency_at_sale,
    _maxStock: i.current_stock ?? null,
  }));
};

onMounted(async () => {
  await loadSettings();
  const r = await getProducts({ limit: 500, activeOnly: true });
  if (r.ok) allProducts.value = r.data;
  await loadEdit();
});
</script>

<style lang="scss" scoped>
// ── Layout grid ───────────────────────────────────────────────────────────────
.order-layout {
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
.order-sidebar {
  position: sticky;
  top: 16px;
}

// ── Card shell ────────────────────────────────────────────────────────────────
.form-card {
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
  h4 {
    font-size: 0.95rem;
    font-weight: 700;
    margin: 0;
    flex: 1;
    color: var(--text-primary);
  }
}
.optional-badge {
  font-size: 0.7rem;
  background: var(--bg-elevated);
  color: var(--text-muted);
  padding: 2px 8px;
  border-radius: 20px;
}

.stock-tag {
  font-size: 0.7rem;
  font-weight: 600;
  color: #10b981;
  &.stock-out {
    color: #ef4444;
  }
}

.del-btn {
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
  transition: background 0.15s;
  &:hover {
    background: rgba(239, 68, 68, 0.18);
  }
}

// Empty state
.items-empty {
  text-align: center;
  padding: 2rem;
  color: var(--text-muted);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

// ── Summary sidebar ───────────────────────────────────────────────────────────
.summary-card {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.totals-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border-color);
}
.total-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.9rem;
  color: var(--text-sub);
  &--grand {
    font-size: 1rem;
    font-weight: 700;
    color: var(--text-primary);
    padding-top: 8px;
    border-top: 1px solid var(--border-color);
  }
}
.grand-val {
  font-size: 1.2rem;
  color: var(--primary);
}

.payment-block {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.status-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.status-key {
  font-size: 0.85rem;
  color: var(--text-muted);
}
.remaining-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: #f59e0b;
  font-weight: 600;
}

.save-btn {
  width: 100%;
}

// ── Badges ────────────────────────────────────────────────────────────────────
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

.items-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.item-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: border-color 0.15s;

  &:hover {
    border-color: var(--primary);
  }
}

// Top row: product select + delete button
.item-top {
  display: flex;
  align-items: flex-start;
  gap: 8px;

  .item-product {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
}

// Bottom row: price, currency, qty, total — all inline, wraps gracefully
.item-bottom {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.item-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 90px; // grows but minimum ~90px
  min-width: 80px;

  &--cur {
    flex: 0 1 100px; // currency is narrower
  }
  &--qty {
    flex: 0 1 80px; // qty is narrowest
  }
}

.item-total {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 0 0 auto;
  text-align: end;

  strong {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--primary);
    white-space: nowrap;
  }
}

.field-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  margin: 0;
}

.stock-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 0.7rem;
  font-weight: 600;
  color: #10b981;
  &.stock-out {
    color: #ef4444;
  }
}

.del-btn {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border: none;
  background: rgba(239, 68, 68, 0.08);
  border-radius: 8px;
  cursor: pointer;
  color: #ef4444;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
  margin-top: 2px;
  &:hover {
    background: rgba(239, 68, 68, 0.18);
  }
}

// Empty state (unchanged)
.items-empty {
  text-align: center;
  padding: 2rem;
  color: var(--text-muted);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
</style>
