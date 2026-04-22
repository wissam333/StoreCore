<template>
  <div class="investigations-page">
    <div class="container-fluid">
      <SharedUiHeaderPage
        :title="$t('sidebar.investigations')"
        :subtitle="$t('investigationsDesc')"
        icon="mdi:test-tube"
        :actions="[{ key: 'add', label: $t('addNew'), icon: 'mdi:plus', variant: 'primary' }]"
        @action-click="openAddModal"
      />

      <!-- Filters -->
      <div class="filters-section mb-4">
        <div class="row g-3 align-items-end">
          <div class="col-md-4">
            <SharedUiFormBaseInput
              v-model="filters.search"
              :placeholder="$t('searchInvestigations')"
              icon-left="mdi:magnify"
              :clearable="true"
              @update:model-value="debouncedSearch"
              @clear="clearSearch"
            />
          </div>
          <div class="col-md-3">
            <SharedUiFormBaseSelect
              v-model="filters.status"
              :label="$t('status')"
              :options="statusOptions"
              @update:model-value="fetchRecords"
            />
          </div>
          <div class="col-md-3">
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

      <!-- Stat chips -->
      <div class="stat-row mb-4">
        <div v-for="s in statusStats" :key="s.key" class="stat-chip" :class="s.color">
          <Icon :name="s.icon" size="15" />
          <span class="chip-num">{{ s.count }}</span>
          <span>{{ s.label }}</span>
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
          :empty-text="$t('noInvestigations')"
          empty-icon="mdi:test-tube-off"
          @page-change="handlePageChange"
          @page-size-change="handlePageSizeChange"
          @action-click="handleActionClick"
        >
          <template #cell-test="{ row }">
            <div class="test-cell">
              <div class="test-icon" :class="`type-${(row.test_type || 'lab').toLowerCase()}`">
                <Icon name="mdi:test-tube" size="15" />
              </div>
              <div>
                <p class="test-name">{{ row.test_name }}</p>
                <p class="test-type">{{ row.test_type || "—" }}</p>
              </div>
            </div>
          </template>
          <template #cell-patient="{ row }">
            <div class="mini-patient">
              <div class="mini-avatar">{{ row.patient_name?.charAt(0) ?? "?" }}</div>
              <span>{{ row.patient_name }}</span>
            </div>
          </template>
          <template #cell-status="{ row }">
            <span class="inv-badge" :class="`inv-${row.status}`">
              <Icon :name="statusIcon(row.status)" size="12" />
              {{ $t(`invStatus.${row.status}`) }}
            </span>
          </template>
          <template #cell-result="{ row }">
            <p v-if="row.result" class="result-snippet">{{ row.result }}</p>
            <span v-else class="text-muted small">—</span>
          </template>
          <template #cell-date="{ row }">
            <span class="text-muted small">{{ fmtDate(row.ordered_at) }}</span>
          </template>
        </SharedUiTableDataTable>
      </div>
    </div>

    <!-- Add / Edit Dialog -->
    <SharedUiDialogReusableDialog
      v-model="showModal"
      :title="isEditing ? $t('editInvestigation') : $t('addInvestigation')"
      max-width="580px"
    >
      <div class="row g-3">
        <div class="col-12">
          <SharedUiFormBaseSelect
            v-model="form.patient_id"
            :label="$t('patient')"
            :options="patientOptionsNoAll"
            :placeholder="$t('selectPatient')"
            :loading="isLoadingPatients"
            :required="true"
          />
        </div>
        <div class="col-md-8">
          <SharedUiFormBaseInput
            v-model="form.test_name"
            :label="$t('testName')"
            :placeholder="$t('enterTestName')"
            icon-left="mdi:test-tube"
            :required="true"
          />
        </div>
        <div class="col-md-4">
          <SharedUiFormBaseInput v-model="form.test_type" :label="$t('testType')" :placeholder="'lab / radiology'" />
        </div>
        <div class="col-md-6">
          <SharedUiFormBaseInput v-model="form.ordered_at" :label="$t('orderedAt')" type="date" />
        </div>
        <div class="col-md-6">
          <SharedUiFormBaseSelect
            v-model="form.status"
            :label="$t('status')"
            :options="statusOptionsNoAll"
          />
        </div>
        <div class="col-md-6">
          <SharedUiFormBaseInput v-model="form.result_at" :label="$t('resultDate')" type="date" />
        </div>
        <div class="col-12">
          <SharedUiFormBaseInput
            v-model="form.result"
            :label="$t('result')"
            :placeholder="$t('enterResult')"
            type="textarea"
            :rows="2"
          />
        </div>
        <div class="col-12">
          <SharedUiFormBaseInput
            v-model="form.notes"
            :label="$t('notes')"
            :placeholder="$t('enterNotes')"
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
        <p v-if="selectedItem">{{ $t("deleteConfirmation", { name: selectedItem.test_name }) }}</p>
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
const { getInvestigations, saveInvestigation, deleteInvestigation, getPatients } = useClinic();

const records        = ref([]);
const isLoading      = ref(false);
const isRefreshing   = ref(false);
const isSubmitting   = ref(false);
const isDeleting     = ref(false);
const isLoadingPatients = ref(false);
const showModal       = ref(false);
const showDeleteModal  = ref(false);
const selectedItem    = ref(null);
const isEditing       = ref(false);
const patients        = ref([]);
const allRecords      = ref([]); // for stat chips
const pagination      = ref({ currentPage: 1, pageSize: 15, totalItems: 0, totalPages: 0 });

const filters = ref({ search: "", status: "", patientId: "" });

const emptyForm = () => ({
  patient_id: null, test_name: "", test_type: "", ordered_at: new Date().toISOString().slice(0, 10),
  status: "pending", result: "", result_at: "", notes: "",
});
const form = ref(emptyForm());

const statusOptionsNoAll = computed(() => [
  { value: "pending",  label: t("invStatus.pending")  },
  { value: "resulted", label: t("invStatus.resulted") },
  { value: "reviewed", label: t("invStatus.reviewed") },
]);
const statusOptions = computed(() => [
  { value: "", label: t("allStatuses") },
  ...statusOptionsNoAll.value,
]);

const patientOptions = computed(() => [
  { value: "", label: t("allPatients") },
  ...patients.value.map(p => ({ value: p.id, label: p.full_name })),
]);
const patientOptionsNoAll = computed(() => patients.value.map(p => ({ value: p.id, label: p.full_name })));

const statusStats = computed(() => [
  { key: "pending",  icon: "mdi:clock-outline",       count: allRecords.value.filter(r => r.status === "pending").length,  label: t("invStatus.pending"),  color: "chip-yellow" },
  { key: "resulted", icon: "mdi:flask-outline",        count: allRecords.value.filter(r => r.status === "resulted").length, label: t("invStatus.resulted"), color: "chip-blue"   },
  { key: "reviewed", icon: "mdi:check-circle-outline", count: allRecords.value.filter(r => r.status === "reviewed").length, label: t("invStatus.reviewed"), color: "chip-green"  },
]);

const statusIcon = (s) => ({ pending: "mdi:clock-outline", resulted: "mdi:flask-outline", reviewed: "mdi:check-circle-outline" })[s] ?? "mdi:help";

const tableColumns = computed(() => [
  { key: "test",    label: t("test"),    sortable: false, width: "28%" },
  { key: "patient", label: t("patient"), sortable: false, width: "22%" },
  { key: "status",  label: t("status"),  sortable: false, width: "14%" },
  { key: "result",  label: t("result"),  sortable: false, width: "22%" },
  { key: "date",    label: t("date"),    sortable: false, width: "14%" },
]);

const tableActions = [
  { key: "edit",   label: "edit",   icon: "mdi:pencil", class: "btn-success" },
  { key: "delete", label: "delete", icon: "mdi:delete", class: "btn-danger"  },
];

const fetchRecords = async () => {
  isLoading.value = true;
  try {
    const r = await getInvestigations({
      search:    filters.value.search,
      status:    filters.value.status    || undefined,
      patientId: filters.value.patientId || undefined,
      limit:     pagination.value.pageSize,
      offset:    (pagination.value.currentPage - 1) * pagination.value.pageSize,
    });
    if (r.ok) {
      records.value = r.data;
      pagination.value.totalItems = r.total;
      pagination.value.totalPages = Math.ceil(r.total / pagination.value.pageSize);
    }
    // Load all for stat chips (small overhead, stats are useful)
    const all = await getInvestigations({ limit: 10000 });
    if (all.ok) allRecords.value = all.data;
  } finally { isLoading.value = false; isRefreshing.value = false; }
};

const debouncedSearch  = useDebounceFn(() => { pagination.value.currentPage = 1; fetchRecords(); }, 400);
const clearSearch      = () => { filters.value.search = ""; fetchRecords(); };
const refreshData      = () => { isRefreshing.value = true; fetchRecords(); };
const handlePageChange     = (p)  => { pagination.value.currentPage = p;  fetchRecords(); };
const handlePageSizeChange  = (sz) => { pagination.value.pageSize = sz; pagination.value.currentPage = 1; fetchRecords(); };

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
  if (!form.value.patient_id || !form.value.test_name) return $toast.error(t("required"));
  isSubmitting.value = true;
  try {
    const payload = { ...form.value, id: isEditing.value ? selectedItem.value?.id : undefined };
    const r = await saveInvestigation(payload);
    if (r.ok) { $toast.success(isEditing.value ? t("updateSuccess") : t("createSuccess")); showModal.value = false; fetchRecords(); }
    else throw new Error(r.error);
  } catch (err) { $toast.error(err.message); }
  finally { isSubmitting.value = false; }
};

const confirmDelete = async () => {
  isDeleting.value = true;
  try {
    const r = await deleteInvestigation(selectedItem.value.id);
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
.investigations-page { padding: 2rem; min-height: 100vh; background: var(--bg-page); }

.filters-section, .table-wrapper {
  background: var(--bg-surface); border-radius: 16px; padding: 1.5rem;
  box-shadow: 0 2px 12px rgba(0,0,0,.05); border: 1px solid var(--border-color);
}

.stat-row { display: flex; gap: .65rem; flex-wrap: wrap; }
.stat-chip {
  display: flex; align-items: center; gap: .4rem;
  padding: .45rem 1rem; border-radius: 20px; font-size: .82rem; font-weight: 600;
  &.chip-yellow { background: rgba(245,158,11,.1); color: #f59e0b; }
  &.chip-blue   { background: rgba(59,130,246,.1); color: #3b82f6; }
  &.chip-green  { background: rgba(16,185,129,.1); color: #10b981; }
}
.chip-num { font-size: .95rem; font-weight: 800; }

.test-cell { display: flex; align-items: center; gap: .65rem; }
.test-icon {
  width: 34px; height: 34px; border-radius: 9px;
  background: rgba(59,130,246,.1); color: #3b82f6;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  &.type-radiology { background: rgba(139,92,246,.1); color: #8b5cf6; }
  &.type-lab       { background: rgba(16,185,129,.1); color: #10b981; }
}
.test-name { font-weight: 700; font-size: .88rem; color: var(--text-primary); margin: 0; }
.test-type { font-size: .74rem; color: var(--text-muted); margin: 0; }

.mini-patient { display: flex; align-items: center; gap: .45rem; font-size: .85rem; font-weight: 500; }
.mini-avatar {
  width: 28px; height: 28px; border-radius: 50%; background: var(--primary);
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: .72rem; flex-shrink: 0;
}

.inv-badge {
  display: inline-flex; align-items: center; gap: .25rem;
  padding: .2rem .6rem; border-radius: 20px; font-size: .74rem; font-weight: 700;
  &.inv-pending  { background: rgba(245,158,11,.1); color: #f59e0b; }
  &.inv-resulted { background: rgba(59,130,246,.1); color: #3b82f6; }
  &.inv-reviewed { background: rgba(16,185,129,.1); color: #10b981; }
}

.result-snippet {
  font-size: .8rem; color: var(--text-primary); margin: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;
}

.text-danger { color: #dc3545 !important; }
@media (max-width: 768px) { .investigations-page { padding: 0; } .table-wrapper { padding: 0; } }
</style>
