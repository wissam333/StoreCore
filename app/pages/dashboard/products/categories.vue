<!-- store-app/pages/dashboard/products/categories.vue -->
<template>
  <div>
    <SharedUiHeaderPage
      :title="$t('sidebar.categories')"
      :subtitle="$t('categoriesSubtitle')"
      icon="mdi:tag-multiple-outline"
      show-back
      back-to="/dashboard/products"
      :is-rtl="locale === 'ar'"
      :actions="[
        { label: $t('addCategory'), icon: 'mdi:plus', variant: 'primary' },
      ]"
      @action-click="openAdd"
    />

    <SharedUiTableDataTable
      :columns="cols"
      :data="categories"
      :loading="loading"
      empty-icon="mdi:tag-multiple-outline"
      empty-text="noCategories"
      :empty-action="{ label: 'addCategory', handler: openAdd }"
    >
      <template #cell-product_count="{ row }">
        <span class="count-badge">{{ row.product_count ?? 0 }}</span>
      </template>
      <template #actions="{ row }">
        <div class="action-buttons">
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

    <!-- Add / Edit modal -->
    <SharedUiDialogAppModal
      v-model="showModal"
      :title="editTarget ? $t('editCategory') : $t('addCategory')"
      max-width="440px"
    >
      <div class="modal-form">
        <SharedUiFormBaseInput
          v-model="form.name"
          :label="$t('categoryName')"
          required
          :error="!!errors.name"
          :error-message="errors.name"
        />
        <SharedUiFormBaseTextarea
          v-model="form.description"
          :label="$t('description')"
          :rows="2"
        />
      </div>
      <template #actions>
        <div class="d-flex gap-2 justify-content-end">
          <SharedUiButtonBase variant="outline" @click="closeModal">{{
            $t("cancel")
          }}</SharedUiButtonBase>
          <SharedUiButtonBase
            icon-left="mdi:content-save-outline"
            :loading="saving"
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
      :title="$t('deleteCategory')"
      max-width="420px"
    >
      <p>{{ $t("deleteCategoryConfirm") }}</p>
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
    label: "Products Categories",
    labelAr: "فئات المنتجات",
    icon: "mdi:package-variant-closed",
    group: "Main",
  },
});
const { locale } = useI18n();
const { t: $t } = useI18n();
const { $toast } = useNuxtApp();
const { getCategories, saveCategory, deleteCategory, getProducts } = useStore();

const loading = ref(false);
const categories = ref([]);
const showModal = ref(false);
const saving = ref(false);
const showDeleteModal = ref(false);
const deleting = ref(false);
const editTarget = ref(null);
const toDelete = ref(null);
const errors = ref({});

const form = reactive({ name: "", description: "" });

const cols = [
  { key: "name", label: "categoryName" },
  { key: "description", label: "description" },
  { key: "product_count", label: "products" },
];

const load = async () => {
  loading.value = true;
  const [catR, prodR] = await Promise.all([
    getCategories(),
    getProducts({ limit: 500 }),
  ]);
  if (catR.ok) {
    // Annotate with product count
    const counts = {};
    if (prodR.ok) {
      for (const p of prodR.data) {
        if (p.category_id)
          counts[p.category_id] = (counts[p.category_id] ?? 0) + 1;
      }
    }
    categories.value = catR.data.map((c) => ({
      ...c,
      product_count: counts[c.id] ?? 0,
    }));
  }
  loading.value = false;
};

const openAdd = () => {
  editTarget.value = null;
  Object.assign(form, { name: "", description: "" });
  errors.value = {};
  showModal.value = true;
};

const openEdit = (cat) => {
  editTarget.value = cat;
  Object.assign(form, { name: cat.name, description: cat.description ?? "" });
  errors.value = {};
  showModal.value = true;
};

const closeModal = () => {
  showModal.value = false;
  editTarget.value = null;
};

const save = async () => {
  errors.value = {};
  if (!form.name.trim()) {
    errors.value.name = $t("required");
    return;
  }
  saving.value = true;
  const r = await saveCategory({ ...form, id: editTarget.value?.id });
  saving.value = false;
  if (r.ok) {
    $toast.success($t("saved"));
    closeModal();
    load();
  } else $toast.error(r.error);
};

const confirmDelete = (cat) => {
  toDelete.value = cat;
  showDeleteModal.value = true;
};

const doDelete = async () => {
  deleting.value = true;
  const r = await deleteCategory(toDelete.value.id);
  deleting.value = false;
  if (r.ok) {
    $toast.success($t("deleted"));
    showDeleteModal.value = false;
    load();
  } else $toast.error(r.error);
};

onMounted(load);
</script>

<style lang="scss" scoped>
.count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 24px;
  padding: 0 8px;
  background: var(--primary-soft);
  color: var(--primary);
  border-radius: 20px;
  font-size: 0.8rem;
  font-weight: 700;
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
