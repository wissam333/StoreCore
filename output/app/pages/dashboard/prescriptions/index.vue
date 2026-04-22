<template>
  <div class="prescriptions-page">
    <div class="container-fluid">
      <SharedUiHeaderPage
        :title="$t('sidebar.prescriptions')"
        :subtitle="$t('prescriptionsDesc')"
        icon="mdi:pill"
        :actions="[{ key: 'add', label: $t('addNew'), icon: 'mdi:plus', variant: 'primary' }]"
        @action-click="openAddModal"
      />

      <!-- Filters -->
      <div class="filters-section mb-4">
        <div class="row g-3 align-items-end">
          <div class="col-md-6">
            <SharedUiFormBaseInput
              v-model="filters.search"
              :placeholder="$t('searchPrescriptions')"
              icon-left="mdi:magnify"
              :clearable="true"
              @update:model-value="debouncedSearch"
              @clear="clearSearch"
            />
          </div>
          <div class="col-md-4">
            <SharedUiFormBaseSelect
              v-model="filters.patientId"
              :label="$t('filterByPatient')"
              :options="patientOptions"
              :placeholder="$t('allPatients')"
              :loading="isLoadingPatients"
              @update:model-value="fetchRecords"
            />
          </div>
          <div class="col-md-2 d-flex justify-content-end">
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
          :row-clickable="false"
          :actions="tableActions"
          :empty-text="$t('noPrescriptions')"
          empty-icon="mdi:pill-off"
          @page-change="handlePageChange"
          @page-size-change="handlePageSizeChange"
          @action-click="handleActionClick"
        >
          <template #cell-drug="{ row }">
            <div class="drug-cell">
              <div class="drug-icon-wrap">
                <Icon name="mdi:pill" size="16" />
              </div>
              <div>
                <p class="drug-name">{{ row.drug_name }}</p>
                <p class="drug-detail">{{ [row.dose, row.route].filter(Boolean).join(" · ") }}</p>
              </div>
            </div>
          </template>
          <template #cell-patient="{ row }">
            <div class="mini-patient">
              <div class="mini-avatar">{{ row.patient_name?.charAt(0) ?? "?" }}</div>
              <span>{{ row.patient_name }}</span>
            </div>
          </template>
          <template #cell-schedule="{ row }">
            <div class="schedule-cell">
              <span v-if="row.frequency" class="sched-chip">{{ row.frequency }}</span>
              <span v-if="row.duration" class="sched-chip muted">{{ row.duration }}</span>
            </div>
          </template>
          <template #cell-date="{ row }">
            <span class="text-muted small">{{ fmtDate(row.created_at) }}</span>
          </template>
        </SharedUiTableDataTable>
      </div>
    </div>

    <!-- Add / Edit Dialog -->
    <SharedUiDialogReusableDialog
      v-model="showModal"
      :title="isEditing ? $t('editPrescription') : $t('addPrescription')"
      max-width="580px"
    >
      <div class="row g-3">
        <div class="col-12">
          <SharedUiFormBaseSelect
            v-model="form.patient_id"
            :label="$t('patient')"
            :options="patientOptions"
            :placeholder="$t('selectPatient')"
            :loading="isLoadingPatients"
            :required="true"
          />
        </div>
        <div class="col-12">
          <SharedUiFormBaseInput
            v-model="form.drug_name"
            :label="$t('drugName')"
            :placeholder="$t('enterDrugName')"
            icon-left="mdi:pill"
            :required="true"
          />
        </div>
        <div class="col-md-4">
          <SharedUiFormBaseInput v-model="form.dose" :label="$t('dose')" :placeholder="'500mg'" />
        </div>
        <div class="col-md-4">
          <SharedUiFormBaseInput v-model="form.route" :label="$t('route')" :placeholder="'oral'" />
        </div>
        <div class="col-md-4">
          <SharedUiFormBaseInput v-model="form.frequency" :label="$t('frequency')" :placeholder="'3x/day'" />
        </div>
        <div class="col-md-6">
          <SharedUiFormBaseInput v-model="form.duration" :label="$t('duration')" :placeholder="'7 days'" />
        </div>
        <div class="col-12">
          <SharedUiFormBaseInput
            v-model="form.instructions"
            :label="$t('instructions')"
            :placeholder="$t('enterInstructions')"
            type="textarea"
            :rows="2"
          />
        </div>
      </div>
      <template #actions>
        <div class="d-flex gap-2 justify-content-end">
          <SharedUiButtonBase variant="outline" @click="showModal = false">{{ $t("cancel") }}</SharedUiButtonBase>
          <SharedUiButtonBase variant="primary" :loading="isSubmitting" @click="submit">{{ $t("save") }}</SharedUiButtonBase>
        </div>
      </template>
    </SharedUiDialogReusableDialog>

    <!-- Delete Modal -->
    <SharedUiDialogAppModal v-model="showDeleteModal" :title="$t('confirmDelete')" max-width="400px">
      <div class="text-center py-2">
        <Icon name="mdi:alert-circle" size="44" class="text-danger mb-2" />
        <p v-if="selectedItem">{{ $t("deleteConfirmation", { name: selectedItem.drug_name }) }}</p>
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
import { useDebounceFn } from "@vueuse/core";

definePageMeta({ layout: "default" });

const { t } = useI18n();
const { $toast } = useNuxtApp();
const { getPrescriptions, savePrescription, deletePrescription, getPatients } = useClinic();

const records       = ref([]);
const isLoading     = ref(false);
const isRefreshing  = ref(false);
const isSubmitting  = ref(false);
const isDeleting    = ref(false);
const isLoadingPatients = ref(false);
const showModal      = ref(false);
const showDeleteModal = ref(false);
const selectedItem   = ref(null);
const isEditing      = ref(false);
const patients       = ref([]);
const pagination     = ref({ currentPage: 1, pageSize: 15, totalItems: 0, totalPages: 0 });

const filters = ref({ search: "", patientId: "" });
const emptyForm = () => ({ patient_id: null, drug_name: "", dose: "", route: "", frequency: "", duration: "", instructions: "" });
const form = ref(emptyForm());

const patientOptions = computed(() => [
  { value: "", label: t("allPatients") },
  ...patients.value.map(p => ({ value: p.id, label: p.full_name })),
]);

const tableColumns = computed(() => [
  { key: "drug",     label: t("drug"),      sortable: false, width: "32%" },
  { key: "patient",  label: t("patient"),   sortable: false, width: "25%" },
  { key: "schedule", label: t("schedule"),  sortable: false, width: "22%" },
  { key: "date",     label: t("date"),      sortable: false, width: "14%" },
]);

const tableActions = [
  { key: "edit",   label: "edit",   icon: "mdi:pencil", class: "btn-success" },
  { key: "delete", label: "delete", icon: "mdi:delete", class: "btn-danger"  },
];

const fetchRecords = async () => {
  isLoading.value = true;
  try {
    const r = await getPrescriptions({
      search:    filters.value.search,
      patientId: filters.value.patientId || undefined,
      limit:     pagination.value.pageSize,
      offset:    (pagination.value.currentPage - 1) * pagination.value.pageSize,
    });
    if (r.ok) {
      records.value = r.data;
      pagination.value.totalItems  = r.total;
      pagination.value.totalPages  = Math.ceil(r.total / pagination.value.pageSize);
    }
  } finally { isLoading.value = false; isRefreshing.value = false; }
};

const debouncedSearch = useDebounceFn(() => { pagination.value.currentPage = 1; fetchRecords(); }, 400);
const clearSearch     = () => { filters.value.search = ""; fetchRecords(); };
const refreshData     = () => { isRefreshing.value = true; fetchRecords(); };
const handlePageChange    = (p)  => { pagination.value.currentPage = p;  fetchRecords(); };
const handlePageSizeChange = (sz) => { pagination.value.pageSize = sz; pagination.value.currentPage = 1; fetchRecords(); };

const handleActionClick = async ({ action, row, setLoading }) => {
  setLoading(true);
  try {
    if (action.key === "edit")   openEditModal(row);
    if (action.key === "delete") { selectedItem.value = row; showDeleteModal.value = true; }
  } finally { setLoading(false); }
};

const openAddModal  = () => { isEditing.value = false; selectedItem.value = null; form.value = emptyForm(); showModal.value = true; };
const openEditModal = (row) => { isEditing.value = true; selectedItem.value = row; form.value = { ...row }; showModal.value = true; };

const submit = async () => {
  if (!form.value.patient_id || !form.value.drug_name) return $toast.error(t("required"));
  isSubmitting.value = true;
  try {
    const payload = { ...form.value, id: isEditing.value ? selectedItem.value?.id : undefined };
    const r = await savePrescription(payload);
    if (r.ok) { $toast.success(isEditing.value ? t("updateSuccess") : t("createSuccess")); showModal.value = false; fetchRecords(); }
    else throw new Error(r.error);
  } catch (err) { $toast.error(err.message); }
  finally { isSubmitting.value = false; }
};

const confirmDelete = async () => {
  isDeleting.value = true;
  try {
    const r = await deletePrescription(selectedItem.value.id);
    if (r.ok) { $toast.success(t("deleteSuccess")); showDeleteModal.value = false; fetchRecords(); }
  } finally { isDeleting.value = false; selectedItem.value = null; }
};

const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : "—";

onMounted(async () => {
  isLoadingPatients.value = true;
  const pr = await getPatients({ limit: 10000 });
  if (pr.ok) patients.value = pr.data;
  isLoadingPatients.value = false;
  fetchRecords();
});
</script>

<style lang="scss" scoped>
.prescriptions-page { padding: 2rem; min-height: 100vh; background: var(--bg-page); }

.filters-section, .table-wrapper {
  background: var(--bg-surface); border-radius: 16px; padding: 1.5rem;
  box-shadow: 0 2px 12px rgba(0,0,0,.05); border: 1px solid var(--border-color);
}

.drug-cell { display: flex; align-items: center; gap: .65rem; }
.drug-icon-wrap {
  width: 34px; height: 34px; border-radius: 9px;
  background: var(--primary-soft); color: var(--primary);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.drug-name   { font-weight: 700; font-size: .88rem; color: var(--text-primary); margin: 0; }
.drug-detail { font-size: .74rem; color: var(--text-muted); margin: 0; }

.mini-patient { display: flex; align-items: center; gap: .45rem; font-size: .85rem; font-weight: 500; }
.mini-avatar {
  width: 28px; height: 28px; border-radius: 50%; background: var(--primary);
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: .72rem; flex-shrink: 0;
}

.schedule-cell { display: flex; flex-wrap: wrap; gap: .3rem; }
.sched-chip {
  display: inline-block; padding: .18rem .55rem; border-radius: 20px;
  font-size: .74rem; font-weight: 600;
  background: var(--primary-soft); color: var(--primary);
  &.muted { background: var(--bg-elevated); color: var(--text-sub); }
}

.text-danger { color: #dc3545 !important; }
@media (max-width: 768px) { .prescriptions-page { padding: 0; } .table-wrapper { padding: 0; } }
</style>
