<!-- store-app/pages/dashboard/products/index.vue -->
<template>
  <div>
    <SharedUiHeaderPage
      :title="$t('sidebar.products')"
      :subtitle="$t('productsSubtitle')"
      icon="mdi:package-variant-closed"
      :is-rtl="locale === 'ar'"
      :actions="[
        { label: $t('addProduct'), icon: 'mdi:plus', variant: 'primary' },
      ]"
      @action-click="navigateTo('/dashboard/products/new')"
    />

    <div class="filters-row">
      <SharedUiFormBaseInput
        v-model="search"
        :placeholder="$t('searchProducts')"
        icon-left="mdi:magnify"
        clearable
        class="search-input"
      />
      <SharedUiFormBaseSelect
        v-model="filterCategory"
        :options="categoryOptions"
        :placeholder="$t('allCategories')"
        clearable
        class="filter-select"
      />
      <SharedUiFormBaseSelect
        v-model="filterCurrency"
        :options="currencyOptions"
        :placeholder="$t('allCurrencies')"
        clearable
        class="filter-select"
      />
    </div>

    <SharedUiTableDataTable
      :columns="cols"
      :data="products"
      :loading="loading"
      :pagination="{ currentPage: page, pageSize: 20, totalItems: total }"
      empty-icon="mdi:package-variant-closed"
      empty-text="noProducts"
      row-clickable
      @row-click="(r) => navigateTo('/dashboard/products/' + r.id + '/edit')"
      @page-change="
        (p) => {
          page = p;
          load();
        }
      "
    >
      <!-- Image + name combined cell -->
      <template #cell-name="{ row }">
        <div class="product-name-cell">
          <div class="product-thumb" :class="{ 'has-img': !!row.image_url }">
            <img
              v-if="row.image_url"
              :src="row.image_url"
              :alt="row.name"
              class="thumb-img"
            />
            <Icon
              v-else
              name="mdi:package-variant-closed"
              size="16"
              class="thumb-icon"
            />
          </div>
          <span class="product-name-text">{{ row.name }}</span>
        </div>
      </template>

      <template #cell-prices="{ row }">
        <div class="price-cell">
          <span class="price-buy"
            >{{ $t("buy") }}: {{ row.buy_price }} {{ row.currency }}</span
          >
          <span class="price-sell"
            >{{ $t("sell") }}: {{ row.sell_price }} {{ row.currency }}</span
          >
        </div>
      </template>

      <template #cell-stock="{ row }">
        <span class="stock-badge" :class="stockClass(row)">
          {{ row.stock }} {{ row.unit }}
        </span>
      </template>

      <template #cell-is_active="{ row }">
        <span
          class="badge"
          :class="row.is_active ? 'badge-success' : 'badge-secondary'"
        >
          {{ row.is_active ? $t("active") : $t("inactive") }}
        </span>
      </template>

      <template #actions="{ row }">
        <div class="action-buttons">
          <button
            class="action-btn"
            :title="$t('edit')"
            @click.stop="navigateTo('/dashboard/products/' + row.id + '/edit')"
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

    <!-- Delete confirm -->
    <SharedUiDialogAppModal
      v-model="showDeleteModal"
      :title="$t('deleteProduct')"
      max-width="420px"
    >
      <p>{{ $t("deleteProductConfirm") }}</p>
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
    label: "Products",
    labelAr: "المنتجات",
    icon: "mdi:package-variant-closed",
    group: "Main",
  },
});

const { getProducts, getCategories, deleteProduct } = useStore();
import { watchDebounced } from "@vueuse/core";
const { locale, t: $t } = useI18n();
const { $toast } = useNuxtApp();
const currency = useCurrency();

const search = ref("");
const filterCategory = ref("");
const filterCurrency = ref("");
const page = ref(1);
const loading = ref(false);
const products = ref([]);
const total = ref(0);
const categories = ref([]);
const showDeleteModal = ref(false);
const deleting = ref(false);
const toDelete = ref(null);

const categoryOptions = computed(() =>
  categories.value.map((c) => ({ label: c.name, value: c.id })),
);
const currencyOptions = [
  { label: "SP", value: "SP" },
  { label: "USD", value: "USD" },
];

const cols = [
  { key: "name", label: "product" },
  { key: "category_name", label: "category" },
  { key: "prices", label: "prices" },
  { key: "stock", label: "stock" },
  { key: "is_active", label: "status" },
];

const stockClass = (p) => {
  if (p.stock === 0) return "stock-out";
  if (p.min_stock > 0 && p.stock <= p.min_stock) return "stock-low";
  return "stock-ok";
};

const load = async () => {
  loading.value = true;
  const r = await getProducts({
    search: search.value,
    categoryId: filterCategory.value || undefined,
    limit: 20,
    offset: (page.value - 1) * 20,
  });
  if (r.ok) {
    products.value = r.data;
    total.value = r.total;
  }
  loading.value = false;
};

const confirmDelete = (row) => {
  toDelete.value = row;
  showDeleteModal.value = true;
};

const doDelete = async () => {
  deleting.value = true;
  const r = await deleteProduct(toDelete.value.id);
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
  [search, filterCategory, filterCurrency],
  () => {
    page.value = 1;
    load();
  },
  { debounce: 300 },
);

onMounted(async () => {
  await currency.loadSettings();
  const r = await getCategories();
  if (r.ok) categories.value = r.data;
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
.filter-select {
  width: 160px;
}

// ── Product name + thumb ──────────────────────────────────────────────────────
.product-name-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}
.product-thumb {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;

  &.has-img {
    border-color: transparent;
    background: none;
  }
}
.thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.thumb-icon {
  color: var(--text-muted);
}
.product-name-text {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-primary);
}

// ── Prices ────────────────────────────────────────────────────────────────────
.price-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.price-buy {
  font-size: 0.75rem;
  color: var(--text-muted);
}
.price-sell {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
}

// ── Stock badge ───────────────────────────────────────────────────────────────
.stock-badge {
  padding: 3px 8px;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
}
.stock-ok {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
}
.stock-low {
  background: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
}
.stock-out {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

// ── Status badge ──────────────────────────────────────────────────────────────
.badge {
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
}
.badge-success {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
}
.badge-secondary {
  background: var(--bg-elevated);
  color: var(--text-muted);
}

// ── Actions ───────────────────────────────────────────────────────────────────
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
