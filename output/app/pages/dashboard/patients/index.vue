<template>
  <div class="patients-page">
    <div class="container-fluid">
      <SharedUiHeaderPage
        :title="$t('sidebar.patients')"
        :subtitle="$t('patientsDesc')"
        icon="mdi:account-heart-outline"
        :actions="[{ key: 'add', label: $t('addNew'), icon: 'mdi:plus', variant: 'primary' }]"
        @action-click="openAddModal"
      />

      <!-- Filters -->
      <div class="filters-section mb-4">
        <div class="row g-3 align-items-center">
          <div class="col-md-8">
            <SharedUiFormBaseInput
              v-model="searchQuery"
              :placeholder="$t('searchPatients')"
              icon-left="mdi:magnify"
              :clearable="true"
              @update:model-value="debouncedSearch"
              @clear="clearSearch"
            />
          </div>
          <div class="col-md-4 d-flex justify-content-end gap-2">
            <SharedUiButtonBase variant="outline" icon-left="mdi:refresh" :loading="isRefreshing" @click="refreshData">
              {{ $t("refresh") }}
            </SharedUiButtonBase>
          </div>
        </div>
      </div>

      <!-- Table -->
      <div class="table-wrapper">
        <SharedUiTableDataTable
          :columns="tableColumns"
          :data="records"
          :loading="isLoading"
          :pagination="pagination"
          :row-clickable="true"
          :actions="tableActions"
          :empty-text="$t('noPatients')"
          empty-icon="mdi:account-off-outline"
          @page-change="handlePageChange"
          @page-size-change="handlePageSizeChange"
          @action-click="handleActionClick"
          @row-click="(row) => navigateTo(`/dashboard/patients/${row.id}`)"
        >
          <template #cell-name="{ row }">
            <div class="patient-cell">
              <div class="patient-avatar" :class="`gender-${row.gender}`">
                {{ row.full_name?.charAt(0)?.toUpperCase() ?? "?" }}
              </div>
              <div>
                <p class="patient-name">{{ row.full_name }}</p>
                <p class="patient-sub">{{ row.phone || "—" }}</p>
              </div>
            </div>
          </template>
          <template #cell-gender="{ row }">
            <span class="gender-badge" :class="row.gender">
              <Icon :name="row.gender === 'male' ? 'mdi:gender-male' : row.gender === 'female' ? 'mdi:gender-female' : 'mdi:gender-non-binary'" size="14" />
              {{ $t(`gender.${row.gender}`) }}
            </span>
          </template>
          <template #cell-visits="{ row }">
            <span class="visits-badge">{{ row.visit_count ?? 0 }}</span>
          </template>
          <template #cell-lastVisit="{ row }">
            <span class="text-muted">{{ row.last_visit ? fmtDate(row.last_visit) : "—" }}</span>
          </template>
        </SharedUiTableDataTable>
      </div>
    </div>

    <!-- Add / Edit Dialog -->
    <SharedUiDialogReusableDialog
      v-model="showModal"
      :title="isEditing ? $t('editPatient') : $t('addPatient')"
      max-width="650px"
    >
      <VForm ref="formRef" :validation-schema="formSchema" :initial-values="formValues" @submit="handleSubmit">
        <div class="row g-3">
          <div class="col-md-8">
            <Field name="full_name" v-slot="{ field, errorMessage }">
              <SharedUiFormBaseInput v-bind="field" :model-value="field.value" @update:model-value="field.onChange"
                :label="$t('fullName')" :placeholder="$t('enterFullName')" :error="!!errorMessage" :error-message="errorMessage" :required="true" />
            </Field>
          </div>
          <div class="col-md-4">
            <Field name="gender" v-slot="{ field, errorMessage }">
              <SharedUiFormBaseSelect v-bind="field" :model-value="field.value" @update:model-value="field.onChange"
                :label="$t('gender.label')" :options="genderOptions" :error="!!errorMessage" :error-message="errorMessage" />
            </Field>
          </div>
          <div class="col-md-6">
            <Field name="dob" v-slot="{ field }">
              <SharedUiFormBaseInput v-bind="field" :model-value="field.value" @update:model-value="field.onChange"
                :label="$t('dob')" type="date" />
            </Field>
          </div>
          <div class="col-md-6">
            <Field name="blood_type" v-slot="{ field }">
              <SharedUiFormBaseSelect v-bind="field" :model-value="field.value" @update:model-value="field.onChange"
                :label="$t('bloodType')" :options="bloodTypeOptions" />
            </Field>
          </div>
          <div class="col-md-6">
            <Field name="phone" v-slot="{ field }">
              <SharedUiFormBaseInput v-bind="field" :model-value="field.value" @update:model-value="field.onChange"
                :label="$t('phone')" :placeholder="$t('enterPhone')" icon-left="mdi:phone-outline" />
            </Field>
          </div>
          <div class="col-md-6">
            <Field name="email" v-slot="{ field }">
              <SharedUiFormBaseInput v-bind="field" :model-value="field.value" @update:model-value="field.onChange"
                :label="$t('email')" :placeholder="$t('enterEmail')" icon-left="mdi:email-outline" />
            </Field>
          </div>
          <div class="col-12">
            <Field name="address" v-slot="{ field }">
              <SharedUiFormBaseInput v-bind="field" :model-value="field.value" @update:model-value="field.onChange"
                :label="$t('address')" :placeholder="$t('enterAddress')" icon-left="mdi:map-marker-outline" />
            </Field>
          </div>
          <div class="col-12">
            <Field name="allergies" v-slot="{ field }">
              <SharedUiFormBaseInput v-bind="field" :model-value="field.value" @update:model-value="field.onChange"
                :label="$t('allergies')" :placeholder="$t('enterAllergies')" type="textarea" :rows="2" />
            </Field>
          </div>
          <div class="col-12">
            <Field name="notes" v-slot="{ field }">
              <SharedUiFormBaseInput v-bind="field" :model-value="field.value" @update:model-value="field.onChange"
                :label="$t('notes')" :placeholder="$t('enterNotes')" type="textarea" :rows="2" />
            </Field>
          </div>
        </div>
        <button type="submit" style="display:none" />
      </VForm>
      <template #actions>
        <div class="d-flex gap-2 justify-content-end">
          <SharedUiButtonBase variant="outline" @click="showModal = false">{{ $t("cancel") }}</SharedUiButtonBase>
          <SharedUiButtonBase variant="primary" :loading="isSubmitting" @click="submitForm">{{ $t("save") }}</SharedUiButtonBase>
        </div>
      </template>
    </SharedUiDialogReusableDialog>

    <!-- Delete Modal -->
    <SharedUiDialogAppModal v-model="showDeleteModal" :title="$t('confirmDelete')" max-width="400px">
      <div class="delete-confirmation text-center py-2">
        <Icon name="mdi:alert-circle" size="44" class="text-danger mb-2" />
        <p v-if="selectedItem">{{ $t("deleteConfirmation", { name: selectedItem.full_name }) }}</p>
      </div>
      <template #actions>
        <div class="d-flex gap-2 justify-content-end">
          <SharedUiButtonBase variant="outline" @click="showDeleteModal = false">{{ $t("cancel") }}</SharedUiButtonBase>
          <SharedUiButtonBase variant="error" :loading="isDeleting" @click="confirmDelete">{{ $t("delete") }}</SharedUiButtonBase>
        </div>
      </template>
    </SharedUiDialogAppModal>
  </div>
</template>

<script setup>
import { Form as VForm, Field } from "vee-validate";
import { object, string } from "yup";
import { useDebounceFn } from "@vueuse/core";

definePageMeta({ layout: "default" });

const { t } = useI18n();
const { $toast } = useNuxtApp();
const { getPatients, savePatient, deletePatient } = useClinic();

const records = ref([]);
const isLoading = ref(false);
const isRefreshing = ref(false);
const isSubmitting = ref(false);
const isDeleting = ref(false);
const searchQuery = ref("");
const showModal = ref(false);
const showDeleteModal = ref(false);
const selectedItem = ref(null);
const isEditing = ref(false);
const formRef = ref(null);
const pagination = ref({ currentPage: 1, pageSize: 15, totalItems: 0, totalPages: 0 });

const formSchema = object({
  full_name: string().required(t("required")),
  gender: string().nullable(),
  dob: string().nullable(),
  phone: string().nullable(),
  email: string().email(t("invalidEmail")).nullable(),
  address: string().nullable(),
  blood_type: string().nullable(),
  allergies: string().nullable(),
  notes: string().nullable(),
});

const emptyForm = () => ({ full_name: "", gender: "male", dob: "", phone: "", email: "", address: "", blood_type: "", allergies: "", notes: "" });
const formValues = ref(emptyForm());

const genderOptions = computed(() => [
  { value: "male", label: t("gender.male") },
  { value: "female", label: t("gender.female") },
  { value: "other", label: t("gender.other") },
]);
const bloodTypeOptions = [
  { value: "", label: "—" },
  ...["A+","A-","B+","B-","AB+","AB-","O+","O-"].map(v => ({ value: v, label: v })),
];

const tableColumns = computed(() => [
  { key: "name", label: t("patient"), sortable: false, width: "35%" },
  { key: "gender", label: t("gender.label"), sortable: false, width: "12%" },
  { key: "dob", label: t("dob"), sortable: false, width: "14%" },
  { key: "visits", label: t("visits"), sortable: false, width: "10%" },
  { key: "lastVisit", label: t("lastVisit"), sortable: false, width: "14%" },
]);

const tableActions = [
  { key: "edit", label: "edit", icon: "mdi:pencil", class: "btn-success" },
  { key: "delete", label: "delete", icon: "mdi:delete", class: "btn-danger" },
];

const fetchRecords = async () => {
  isLoading.value = true;
  try {
    const r = await getPatients({
      search: searchQuery.value,
      limit: pagination.value.pageSize,
      offset: (pagination.value.currentPage - 1) * pagination.value.pageSize,
    });
    if (r.ok) {
      records.value = r.data;
      pagination.value.totalItems = r.total;
      pagination.value.totalPages = Math.ceil(r.total / pagination.value.pageSize);
    }
  } catch (err) {
    $toast.error(t("fetchError"));
  } finally {
    isLoading.value = false;
    isRefreshing.value = false;
  }
};

const debouncedSearch = useDebounceFn(() => { pagination.value.currentPage = 1; fetchRecords(); }, 400);
const clearSearch = () => { searchQuery.value = ""; pagination.value.currentPage = 1; fetchRecords(); };
const refreshData = () => { isRefreshing.value = true; fetchRecords(); };
const handlePageChange = (p) => { pagination.value.currentPage = p; fetchRecords(); };
const handlePageSizeChange = (sz) => { pagination.value.pageSize = sz; pagination.value.currentPage = 1; fetchRecords(); };

const handleActionClick = async ({ action, row, setLoading }) => {
  setLoading(true);
  try {
    if (action.key === "edit") openEditModal(row);
    if (action.key === "delete") openDeleteModal(row);
  } finally { setLoading(false); }
};

const openAddModal = () => {
  isEditing.value = false; selectedItem.value = null;
  formValues.value = emptyForm(); showModal.value = true;
};

const openEditModal = (row) => {
  isEditing.value = true; selectedItem.value = row;
  formValues.value = { ...row }; showModal.value = true;
};

const openDeleteModal = (row) => { selectedItem.value = row; showDeleteModal.value = true; };

const submitForm = async () => {
  const { valid } = await formRef.value?.validate();
  if (valid) formRef.value?.$el?.requestSubmit();
};

const handleSubmit = async (values) => {
  isSubmitting.value = true;
  try {
    const payload = { ...values, id: isEditing.value ? selectedItem.value?.id : undefined };
    const r = await savePatient(payload);
    if (r.ok) {
      $toast.success(isEditing.value ? t("updateSuccess") : t("createSuccess"));
      showModal.value = false;
      fetchRecords();
    } else throw new Error(r.error);
  } catch (err) {
    $toast.error(err.message || t("operationFailed"));
  } finally { isSubmitting.value = false; }
};

const confirmDelete = async () => {
  if (!selectedItem.value) return;
  isDeleting.value = true;
  try {
    const r = await deletePatient(selectedItem.value.id);
    if (r.ok) { $toast.success(t("deleteSuccess")); showDeleteModal.value = false; fetchRecords(); }
    else throw new Error(r.error);
  } catch (err) {
    $toast.error(err.message || t("deleteFailed"));
  } finally { isDeleting.value = false; selectedItem.value = null; }
};

const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : "—";

onMounted(fetchRecords);
</script>

<style lang="scss" scoped>
.patients-page { padding: 2rem; min-height: 100vh; background: var(--bg-page); }

.filters-section, .table-wrapper {
  background: var(--bg-surface);
  border-radius: 16px;
  padding: 1.5rem;
  box-shadow: 0 2px 12px rgba(0,0,0,.05);
  border: 1px solid var(--border-color);
}

.patient-cell {
  display: flex; align-items: center; gap: .65rem;
}
.patient-avatar {
  width: 36px; height: 36px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: .85rem; color: #fff; flex-shrink: 0;
  &.gender-male    { background: #3b82f6; }
  &.gender-female  { background: #ec4899; }
  &.gender-other   { background: #8b5cf6; }
}
.patient-name { font-weight: 600; color: var(--text-primary); font-size: .88rem; margin: 0; }
.patient-sub  { font-size: .76rem; color: var(--text-muted); margin: 0; }

.gender-badge {
  display: inline-flex; align-items: center; gap: .25rem;
  padding: .22rem .6rem; border-radius: 20px; font-size: .75rem; font-weight: 600;
  &.male   { background: rgba(59,130,246,.1); color: #3b82f6; }
  &.female { background: rgba(236,72,153,.1); color: #ec4899; }
  &.other  { background: rgba(139,92,246,.1); color: #8b5cf6; }
}

.visits-badge {
  display: inline-block; padding: .2rem .55rem; border-radius: 8px;
  background: var(--primary-soft); color: var(--primary);
  font-size: .8rem; font-weight: 700;
}

.delete-confirmation .text-danger { color: #dc3545 !important; }

@media (max-width: 768px) {
  .patients-page { padding: 0; }
  .table-wrapper { padding: 0; }
}
</style>
