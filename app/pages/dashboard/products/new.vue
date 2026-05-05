<!-- store-app/pages/dashboard/products/new.vue -->
<!-- Also served at /dashboard/products/:id/edit -->
<template>
  <div>
    <SharedUiHeaderPage
      :title="isEdit ? $t('editProduct') : $t('addProduct')"
      icon="mdi:package-variant-closed"
      show-back
      back-to="/dashboard/products"
      :is-rtl="locale === 'ar'"
    />

    <div class="product-form-grid">
      <!-- LEFT -->
      <div class="form-main">
        <div class="form-card">
          <div class="card-title">{{ $t("basicInfo") }}</div>
          <div class="form-row">
            <SharedUiFormBaseInput
              v-model="form.name"
              :label="$t('productName')"
              required
              :error="!!errors.name"
              :error-message="errors.name"
            />
            <SharedUiFormBaseSelect
              v-model="form.category_id"
              :options="categoryOptions"
              :label="$t('category')"
            />
          </div>
          <SharedUiFormBaseTextarea
            v-model="form.description"
            :label="$t('description')"
            :rows="3"
            class="mb-1"
          />
          <SharedUiScannerBarcodeInput
            v-model="form.barcode"
            :placeholder="$t('barcode')"
            @scan="(code) => $toast.success(`Barcode: ${code}`)"
          />
        </div>

        <div class="form-card">
          <div class="card-title">{{ $t("pricing") }}</div>
          <div class="form-row">
            <SharedUiFormBaseSelect
              v-model="form.currency"
              :options="currencyOptions"
              :label="$t('currency')"
              :hint="$t('currencyHint')"
            />
          </div>
          <div class="form-row">
            <SharedUiFormBaseInput
              v-model.number="form.buy_price"
              type="number"
              min="0"
              step="any"
              :label="`${$t('buyPrice')} (${form.currency})`"
              :hint="$t('buyPriceHint')"
            />
            <SharedUiFormBaseInput
              v-model.number="form.sell_price"
              type="number"
              min="0"
              step="any"
              :label="`${$t('sellPrice')} (${form.currency})`"
              :error="!!errors.sell_price"
              :error-message="errors.sell_price"
            />
          </div>
          <div
            v-if="form.buy_price > 0 && form.sell_price > 0"
            class="margin-preview"
            :class="marginPct >= 0 ? 'positive' : 'negative'"
          >
            <Icon
              :name="marginPct >= 0 ? 'mdi:trending-up' : 'mdi:trending-down'"
              size="16"
            />
            {{ $t("margin") }}: {{ marginPct.toFixed(1) }}%
            <span class="margin-abs">
              ({{ (form.sell_price - form.buy_price).toFixed(2) }}
              {{ form.currency }})
            </span>
          </div>
        </div>

        <div class="form-card">
          <div class="card-title">{{ $t("stockInfo") }}</div>
          <div class="form-row">
            <SharedUiFormBaseInput
              v-model.number="form.stock"
              type="number"
              min="0"
              :label="$t('currentStock')"
            />
            <SharedUiFormBaseInput
              v-model.number="form.min_stock"
              type="number"
              min="0"
              :label="$t('minStock')"
              :hint="$t('minStockHint')"
            />
            <SharedUiFormBaseInput
              v-model="form.unit"
              :label="$t('unit')"
              :placeholder="$t('eg_piece')"
            />
          </div>
        </div>
      </div>

      <!-- RIGHT sidebar -->
      <div class="form-sidebar">
        <!-- ── Image upload ── -->
        <div class="form-card">
          <div class="card-title">{{ $t("productImage") }}</div>

          <!-- Preview -->
          <div
            class="image-drop-zone"
            :class="{ 'has-image': !!imagePreview, dragging: isDragging }"
            @click="triggerFilePicker"
            @dragover.prevent="isDragging = true"
            @dragleave.prevent="isDragging = false"
            @drop.prevent="onDrop"
          >
            <img
              v-if="imagePreview"
              :src="imagePreview"
              class="image-preview"
              alt="product"
            />
            <div v-else class="image-placeholder">
              <Icon name="mdi:image-plus-outline" size="32" />
              <span>{{ $t("clickOrDragImage") }}</span>
              <small>JPG, PNG, WEBP — max 2MB</small>
            </div>

            <!-- Overlay on hover when image exists -->
            <div v-if="imagePreview" class="image-overlay">
              <Icon name="mdi:camera-outline" size="20" />
              <span>{{ $t("changeImage") }}</span>
            </div>
          </div>

          <!-- Hidden file input -->
          <input
            ref="fileInput"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            style="display: none"
            @change="onFileChange"
          />

          <!-- Remove button -->
          <button
            v-if="imagePreview"
            class="remove-image-btn"
            @click.stop="removeImage"
          >
            <Icon name="mdi:trash-can-outline" size="15" />
            {{ $t("removeImage") }}
          </button>
        </div>

        <div class="form-card">
          <div class="card-title">{{ $t("status") }}</div>
          <div class="toggle-row">
            <span class="toggle-label">{{ $t("activeProduct") }}</span>
            <label class="toggle">
              <input type="checkbox" v-model="form.is_active" />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>

        <div v-if="isEdit" class="form-card">
          <div class="card-title">{{ $t("quickAdjust") }}</div>
          <div class="adjust-row">
            <SharedUiButtonBase
              size="sm"
              variant="outline"
              @click="form.stock = Math.max(0, form.stock - 1)"
              >−1</SharedUiButtonBase
            >
            <span class="stock-display">{{ form.stock }}</span>
            <SharedUiButtonBase
              size="sm"
              variant="outline"
              @click="form.stock++"
              >+1</SharedUiButtonBase
            >
          </div>
        </div>

        <SharedUiButtonBase
          class="w-100"
          size="lg"
          icon-left="mdi:content-save-outline"
          :loading="saving"
          @click="save"
        >
          {{ isEdit ? $t("saveChanges") : $t("addProduct") }}
        </SharedUiButtonBase>

        <SharedUiButtonBase
          v-if="isEdit"
          class="w-100"
          variant="error"
          icon-left="mdi:trash-can-outline"
          :loading="deleting"
          @click="showDeleteModal = true"
        >
          {{ $t("deleteProduct") }}
        </SharedUiButtonBase>
      </div>
    </div>

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
    label: "New Product",
    labelAr: "منتج جديد",
    icon: "mdi:package-variant-plus",
    group: "Main",
  },
});

const route = useRoute();
const { locale } = useI18n();
const { t: $t } = useI18n();
const { $toast } = useNuxtApp();
const { getCategories, getProductById, saveProduct, deleteProduct } =
  useStore();

const isEdit = computed(() => !!route.params.id);

const categories = ref([]);
const saving = ref(false);
const deleting = ref(false);
const showDeleteModal = ref(false);
const errors = ref({});

// ── Image state ──────────────────────────────────────────────────────────────
const fileInput = ref(null);
const imagePreview = ref(""); // base64 or existing URL
const isDragging = ref(false);
const MAX_SIZE = 2 * 1024 * 1024; // 2MB

const triggerFilePicker = () => fileInput.value?.click();

const processFile = (file) => {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    $toast.error($t("invalidImageType"));
    return;
  }
  if (file.size > MAX_SIZE) {
    $toast.error($t("imageTooLarge"));
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    imagePreview.value = e.target.result; // base64 data URL
    form.image_url = e.target.result; // save into form
  };
  reader.readAsDataURL(file);
};

const onFileChange = (e) => processFile(e.target.files?.[0]);
const onDrop = (e) => {
  isDragging.value = false;
  processFile(e.dataTransfer.files?.[0]);
};
const removeImage = () => {
  imagePreview.value = "";
  form.image_url = null;
  if (fileInput.value) fileInput.value.value = "";
};

// ── Form ─────────────────────────────────────────────────────────────────────
const form = reactive({
  name: "",
  description: "",
  category_id: null,
  barcode: "",
  buy_price: 0,
  sell_price: 0,
  currency: "SP",
  stock: 0,
  min_stock: 0,
  unit: "piece",
  is_active: true,
  image_url: null,
});

const categoryOptions = computed(() =>
  categories.value.map((c) => ({ label: c.name, value: c.id })),
);
const currencyOptions = [
  { label: "SP (ل.س)", value: "SP" },
  { label: "USD ($)", value: "USD" },
];
const marginPct = computed(() =>
  form.buy_price > 0
    ? ((form.sell_price - form.buy_price) / form.buy_price) * 100
    : 0,
);

const validate = () => {
  errors.value = {};
  if (!form.name?.trim()) errors.value.name = $t("required");
  if (form.sell_price < 0) errors.value.sell_price = $t("mustBePositive");
  return !Object.keys(errors.value).length;
};

const save = async () => {
  if (!validate()) return;
  saving.value = true;
  const payload = {
    ...form,
    is_active: form.is_active ? 1 : 0,
  };
  if (isEdit.value) payload.id = route.params.id;
  const r = await saveProduct(payload);
  saving.value = false;
  if (r.ok) {
    $toast.success($t(isEdit.value ? "productUpdated" : "productAdded"));
    navigateTo("/dashboard/products");
  } else {
    $toast.error(r.error);
  }
};

const doDelete = async () => {
  deleting.value = true;
  const r = await deleteProduct(route.params.id);
  deleting.value = false;
  if (r.ok) {
    $toast.success($t("deleted"));
    showDeleteModal.value = false;
    navigateTo("/dashboard/products");
  } else {
    $toast.error(r.error);
  }
};

onMounted(async () => {
  const rc = await getCategories();
  if (rc.ok) categories.value = rc.data;
  if (isEdit.value && route.params.id) {
    const p = await getProductById(route.params.id);
    if (p.ok) {
      Object.assign(form, { ...p.data, is_active: !!p.data.is_active });
      // Restore image preview if product has one
      if (p.data.image_url) imagePreview.value = p.data.image_url;
    }
  }
});
</script>

<style lang="scss" scoped>
.product-form-grid {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 1.5rem;
  align-items: start;
  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
}
.form-main {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.form-sidebar {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.form-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 1.5rem;
}
.card-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 1.25rem;
}
.form-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 1rem;
  margin-bottom: 1rem;
}
.mb-1 {
  margin-bottom: 1rem;
}

// ── Image upload ─────────────────────────────────────────────────────────────
.image-drop-zone {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  border: 2px dashed var(--border-color);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.2s, background 0.2s;
  background: var(--bg-elevated);

  &:hover {
    border-color: var(--primary);
    background: var(--primary-soft);
  }
  &.dragging {
    border-color: var(--primary);
    background: var(--primary-soft);
    transform: scale(1.01);
  }
  &.has-image {
    border-style: solid;
    border-color: var(--border-color);
    &:hover .image-overlay {
      opacity: 1;
    }
  }
}

.image-preview {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.image-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  text-align: center;
  padding: 1rem;

  span {
    font-size: 0.82rem;
    font-weight: 500;
  }
  small {
    font-size: 0.72rem;
    opacity: 0.7;
  }
}

.image-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #fff;
  font-size: 0.8rem;
  font-weight: 600;
  opacity: 0;
  transition: opacity 0.2s;
}

.remove-image-btn {
  margin-top: 8px;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px;
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.05);
  color: #ef4444;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: rgba(239, 68, 68, 0.12);
    border-color: #ef4444;
  }
}

// ── Margin preview ────────────────────────────────────────────────────────────
.margin-preview {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 8px;
  margin-top: 4px;
  &.positive {
    background: rgba(16, 185, 129, 0.08);
    color: #10b981;
  }
  &.negative {
    background: rgba(239, 68, 68, 0.08);
    color: #ef4444;
  }
}
.margin-abs {
  opacity: 0.7;
  margin-inline-start: 4px;
}

// ── Toggle ────────────────────────────────────────────────────────────────────
.toggle-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.toggle-label {
  font-size: 0.875rem;
  color: var(--text-primary);
}
.toggle {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
  cursor: pointer;
}
.toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}
.toggle-slider {
  position: absolute;
  inset: 0;
  background: var(--border-color);
  border-radius: 24px;
  transition: 0.2s;
  &::before {
    content: "";
    position: absolute;
    width: 18px;
    height: 18px;
    inset-block-start: 3px;
    inset-inline-start: 3px;
    background: #fff;
    border-radius: 50%;
    transition: 0.2s;
  }
}
input:checked + .toggle-slider {
  background: var(--primary);
}
input:checked + .toggle-slider::before {
  transform: translateX(20px);
}

// ── Misc ──────────────────────────────────────────────────────────────────────
.adjust-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
}
.stock-display {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  min-width: 48px;
  text-align: center;
}
.w-100 {
  width: 100%;
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
