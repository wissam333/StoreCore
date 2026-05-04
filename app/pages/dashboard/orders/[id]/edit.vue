<!-- store-app/pages/dashboard/orders/[id]/edit.vue -->
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
            <span v-else class="selected-badge">
              <Icon name="mdi:check-circle" size="12" />
              {{ selectedCustomer.name }}
            </span>
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

        <!-- Items — empty state -->
        <div v-if="!items.length" class="items-empty">
          <div class="empty-icon-wrap">
            <Icon name="mdi:cart-outline" size="40" />
          </div>
          <p>{{ $t("noItemsYet") }}</p>
          <SharedUiButtonBase
            size="sm"
            variant="primary"
            icon-left="mdi:plus"
            @click="addItem"
          >
            {{ $t("addFirstItem") }}
          </SharedUiButtonBase>
        </div>

        <!-- Items list -->
        <div v-else class="items-list">
          <TransitionGroup name="item-anim">
            <div
              v-for="(item, idx) in items"
              :key="item._key"
              class="item-card"
            >
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
                  <div class="item-tags">
                    <span
                      v-if="item._maxStock !== null"
                      class="stock-tag"
                      :class="
                        item._maxStock === 0
                          ? 'stock-out'
                          : item._maxStock <= 5
                          ? 'stock-low'
                          : ''
                      "
                    >
                      <Icon
                        :name="
                          item._maxStock === 0
                            ? 'mdi:close-circle'
                            : 'mdi:cube-outline'
                        "
                        size="11"
                      />
                      {{
                        item._maxStock === 0
                          ? $t("outOfStock")
                          : `${$t("inStock")}: ${item._maxStock}`
                      }}
                    </span>
                    <span v-if="item._maxStock === 0" class="error-tag">
                      {{ $t("cannotAddOutOfStock") }}
                    </span>
                    <span
                      v-if="
                        item.quantity > item._maxStock &&
                        item._maxStock !== null &&
                        item._maxStock > 0
                      "
                      class="warn-tag"
                    >
                      <Icon name="mdi:alert" size="11" />
                      {{ $t("exceedsStock") }}
                    </span>
                  </div>
                </div>
                <button class="del-btn" @click="removeItem(idx)">
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
                    :class="{ 'input-error': item.sell_price_at_sale <= 0 }"
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
                  <div class="qty-control">
                    <button
                      class="qty-btn"
                      :disabled="item.quantity <= 1"
                      @click="
                        item.quantity = Math.max(1, (item.quantity || 1) - 1)
                      "
                    >
                      <Icon name="mdi:minus" size="14" />
                    </button>
                    <SharedUiFormBaseInput
                      v-model.number="item.quantity"
                      type="number"
                      min="1"
                      :max="item._maxStock > 0 ? item._maxStock : undefined"
                      class="qty-input"
                      @blur="clampQty(idx)"
                    />
                    <button
                      class="qty-btn"
                      :disabled="
                        item._maxStock !== null &&
                        item.quantity >= item._maxStock
                      "
                      @click="
                        item.quantity = Math.min(
                          item._maxStock > 0 ? item._maxStock : 9999,
                          (item.quantity || 1) + 1,
                        )
                      "
                    >
                      <Icon name="mdi:plus" size="14" />
                    </button>
                  </div>
                </div>

                <div class="item-total">
                  <label class="field-label">{{ $t("lineTotal") }}</label>
                  <strong>{{ lineTotalDisplay(item) }}</strong>
                </div>
              </div>
            </div>
          </TransitionGroup>

          <!-- Add more button inside list -->
          <button class="add-item-btn" @click="addItem">
            <Icon name="mdi:plus" size="16" />
            {{ $t("addItem") }}
          </button>
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

          <!-- Item count -->
          <div v-if="items.length" class="summary-items-count">
            <Icon name="mdi:cart-outline" size="14" />
            {{ items.length }} {{ $t("items") }} · {{ totalQty }}
            {{ $t("units") }}
          </div>

          <!-- Totals -->
          <div class="totals-block">
            <div
              v-for="item in items"
              :key="item._key"
              class="line-item-summary"
            >
              <span class="lis-name">{{
                item.product_name || $t("product")
              }}</span>
              <span class="lis-val">{{ lineTotalDisplay(item) }}</span>
            </div>
            <div class="total-line total-line--grand">
              <span>{{ $t("total") }}</span>
              <strong class="grand-val">{{ fmtSP(grandTotalSP) }}</strong>
            </div>
          </div>

          <!-- Info box: payment happens after -->
          <div class="payment-info-box">
            <Icon name="mdi:information-outline" size="16" />
            <div class="payment-info-text">
              <strong>{{ $t("paymentAfterCreate") }}</strong>
              <span>{{ $t("paymentAfterCreateDesc") }}</span>
            </div>
          </div>

          <!-- Validation errors -->
          <div v-if="validationErrors.length" class="validation-errors">
            <div v-for="err in validationErrors" :key="err" class="val-error">
              <Icon name="mdi:alert-circle-outline" size="13" />
              {{ err }}
            </div>
          </div>

          <SharedUiButtonBase
            class="save-btn"
            size="lg"
            icon-left="mdi:content-save-outline"
            :loading="saving"
            :disabled="!canSave"
            @click="save"
          >
            {{ isEdit ? $t("saveChanges") : $t("createOrder") }}
          </SharedUiButtonBase>

          <div v-if="!items.length" class="save-hint">
            {{ $t("addItemsFirst") }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
definePageMeta({
  searchMeta: {
    label: "Edit Order",
    labelAr: "تعديل طلب",
    icon: "mdi:receipt-text-edit-outline",
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
const { fmtSP, fmtTx, toSP, dollarRate, reportCurrency, loadSettings } =
  useCurrency();

const isEdit = computed(
  () => !!route.params.id && route.path.includes("/edit"),
);

// ── Currency ──────────────────────────────────────────────────────────────────
const currencyOpts = [
  { label: "SP (ل.س)", value: "SP" },
  { label: "USD ($)", value: "USD" },
];

// ── Customer ──────────────────────────────────────────────────────────────────
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
let _keyCounter = 0;
const items = ref([]);

const addItem = () =>
  items.value.push({
    _key: ++_keyCounter,
    product_id: null,
    product_name: "",
    quantity: 1,
    sell_price_at_sale: 0,
    currency_at_sale: "SP",
    _maxStock: null,
  });

const removeItem = (idx) => items.value.splice(idx, 1);

const onProductSelect = (idx, productId) => {
  const p = allProducts.value.find((x) => x.id === productId);
  if (!p) return;
  const item = items.value[idx];
  item.product_name = p.name;
  item.sell_price_at_sale = p.sell_price;
  item.currency_at_sale = p.currency;
  item._maxStock = p.stock;
  item.quantity = p.stock > 0 ? 1 : 0;
};

const clampQty = (idx) => {
  const item = items.value[idx];
  const max = item._maxStock;
  item.quantity = Math.max(
    1,
    Math.min(item.quantity || 1, max > 0 ? max : 9999),
  );
};

// ── Totals ────────────────────────────────────────────────────────────────────
const lineTotalSP = (item) =>
  toSP(item.sell_price_at_sale * (item.quantity || 1), item.currency_at_sale);

const lineTotalDisplay = (item) =>
  fmtTx(
    item.sell_price_at_sale * (item.quantity || 1),
    item.currency_at_sale,
    lineTotalSP(item),
  );

const grandTotalSP = computed(() =>
  items.value.reduce((s, i) => s + lineTotalSP(i), 0),
);

const totalQty = computed(() =>
  items.value.reduce((s, i) => s + (i.quantity || 0), 0),
);

// ── Validation ────────────────────────────────────────────────────────────────
const validationErrors = computed(() => {
  const errs = [];
  if (!items.value.length) return errs;
  if (items.value.some((i) => !i.product_id))
    errs.push($t("selectProductForAllItems"));
  if (items.value.some((i) => !i.quantity || i.quantity < 1))
    errs.push($t("qtyMustBeAtLeastOne"));
  if (items.value.some((i) => i._maxStock !== null && i._maxStock === 0))
    errs.push($t("removeOutOfStockItems"));
  if (
    items.value.some(
      (i) =>
        i._maxStock !== null && i._maxStock > 0 && i.quantity > i._maxStock,
    )
  )
    errs.push($t("someItemsExceedStock"));
  if (items.value.some((i) => i.product_id && i.sell_price_at_sale <= 0))
    errs.push($t("priceCannotBeZero"));
  return errs;
});

const canSave = computed(
  () => items.value.length > 0 && validationErrors.value.length === 0,
);

// ── Original order data (preserved for edit) ──────────────────────────────────
// We keep the original order_date and display_currency so editing items
// never accidentally resets them.
const originalOrder = ref(null);

// ── Save ──────────────────────────────────────────────────────────────────────
const saving = ref(false);
const orderNotes = ref("");

const save = async () => {
  if (!canSave.value) return;

  if (!selectedCustomer.value && customerSearch.value.trim()) {
    await onCreateCustomer(customerSearch.value.trim());
  }

  saving.value = true;

  // For edits: preserve the original order_date and display_currency.
  // Never reset paid_amount here — saveOrder in store.js recalculates
  // it correctly from existing payments in order_payments table.
  const orderDate = isEdit.value
    ? originalOrder.value?.order_date ?? new Date().toISOString()
    : new Date().toISOString();

  // display_currency: on edit keep the original; on create derive from items
  const displayCurrency = isEdit.value
    ? originalOrder.value?.display_currency ?? "SP"
    : items.value.every((i) => i.currency_at_sale === "USD")
    ? "USD"
    : "SP";

  const r = await saveOrder({
    order: {
      id: isEdit.value ? route.params.id : undefined,
      customer_id: selectedCustomer.value?.id ?? null,
      order_date: orderDate,
      display_currency: displayCurrency,
      notes: orderNotes.value,
    },
    items: items.value.map((i) => ({
      product_id: i.product_id,
      product_name:
        i.product_name ||
        allProducts.value.find((p) => p.id === i.product_id)?.name ||
        "Unknown",
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
  const r = await getOrderById(route.params.id);
  if (!r.ok) return;
  const o = r.data;

  // Store original order fields so save() can preserve them
  originalOrder.value = {
    order_date: o.order_date,
    display_currency: o.display_currency,
  };

  if (o.customer_id) {
    selectedCustomer.value = { id: o.customer_id, name: o.customer_name ?? "" };
    customerSearch.value = o.customer_name ?? "";
  }
  orderNotes.value = o.notes ?? "";
  items.value = (o.items ?? []).map((i) => ({
    _key: ++_keyCounter,
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
// ── Layout ────────────────────────────────────────────────────────────────────
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
  color: var(--text-sub);

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

.selected-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.7rem;
  font-weight: 600;
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  padding: 2px 8px;
  border-radius: 20px;
}

// ── Empty state ───────────────────────────────────────────────────────────────
.items-empty {
  background: var(--bg-surface);
  border: 2px dashed var(--border-color);
  border-radius: 16px;
  text-align: center;
  padding: 2.5rem 2rem;
  color: var(--text-muted);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  transition: border-color 0.2s;

  &:hover {
    border-color: var(--primary);
  }

  p {
    margin: 0;
    font-size: 0.9rem;
  }
}

.empty-icon-wrap {
  width: 72px;
  height: 72px;
  border-radius: 20px;
  background: var(--bg-elevated);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}

// ── Items list ────────────────────────────────────────────────────────────────
.items-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.item-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: border-color 0.15s, box-shadow 0.15s;

  &:hover {
    border-color: var(--primary);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  }
}

// Top row
.item-top {
  display: flex;
  align-items: flex-start;
  gap: 8px;

  .item-product {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
}

.item-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.stock-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 0.68rem;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 20px;
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;

  &.stock-out {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
  }
  &.stock-low {
    background: rgba(245, 158, 11, 0.1);
    color: #f59e0b;
  }
}

.error-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 0.68rem;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 20px;
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.warn-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 0.68rem;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 20px;
  background: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
}

// Bottom row
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
  flex: 1 1 90px;
  min-width: 80px;

  &--cur {
    flex: 0 1 105px;
  }
  &--qty {
    flex: 0 1 130px;
  }
}

.field-label {
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  margin: 0;
}

// Qty stepper
.qty-control {
  display: flex;
  align-items: center;
  gap: 0;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-elevated);
}

.qty-btn {
  width: 32px;
  height: 34px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--text-sub);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;

  &:hover:not(:disabled) {
    background: var(--primary-soft);
    color: var(--primary);
  }

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
}

.qty-input {
  flex: 1;
  text-align: center;
  border: none !important;
  border-radius: 0 !important;
  background: transparent !important;
  min-width: 0;
}

.item-total {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 0 0 auto;
  text-align: end;
  min-width: 80px;

  strong {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--primary);
    white-space: nowrap;
  }
}

.input-error {
  border-color: #ef4444 !important;
}

// Add more button
.add-item-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border: 1.5px dashed var(--border-color);
  border-radius: 12px;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  width: 100%;
  justify-content: center;
  transition: all 0.18s;

  &:hover {
    border-color: var(--primary);
    color: var(--primary);
    background: var(--primary-soft);
  }
}

// Delete button
.del-btn {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border: none;
  background: rgba(239, 68, 68, 0.07);
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

// ── Summary sidebar ───────────────────────────────────────────────────────────
.summary-card {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.summary-items-count {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  color: var(--text-muted);
  padding: 6px 10px;
  background: var(--bg-elevated);
  border-radius: 8px;
}

.totals-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border-color);
}

.line-item-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.8rem;
  color: var(--text-sub);
  gap: 8px;
}

.lis-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: 0.78rem;
}

.lis-val {
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  font-size: 0.8rem;
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
    margin-top: 4px;
  }
}

.grand-val {
  font-size: 1.25rem;
  color: var(--primary);
  font-weight: 800;
}

// ── Payment info box ──────────────────────────────────────────────────────────
.payment-info-box {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px 14px;
  background: rgba(6, 182, 212, 0.06);
  border: 1px solid rgba(6, 182, 212, 0.2);
  border-radius: 10px;
  color: #06b6d4;
  font-size: 0.78rem;
  flex-shrink: 0;
}

.payment-info-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  line-height: 1.4;

  strong {
    font-size: 0.8rem;
    display: block;
  }

  span {
    color: var(--text-muted);
    font-size: 0.73rem;
  }
}

// ── Validation errors ─────────────────────────────────────────────────────────
.validation-errors {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px 12px;
  background: rgba(239, 68, 68, 0.06);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 10px;
}

.val-error {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: #ef4444;
  font-weight: 500;
}

// ── Save ──────────────────────────────────────────────────────────────────────
.save-btn {
  width: 100%;
}

.save-hint {
  text-align: center;
  font-size: 0.72rem;
  color: var(--text-muted);
  margin-top: -4px;
}

// ── Transition ────────────────────────────────────────────────────────────────
.item-anim-enter-active {
  transition: all 0.25s ease;
}
.item-anim-leave-active {
  transition: all 0.2s ease;
}
.item-anim-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}
.item-anim-leave-to {
  opacity: 0;
  transform: translateX(12px);
}
</style>
