<template>
  <div class="visits-page">
    <div class="container-fluid">
      <SharedUiHeaderPage
        :title="$t('sidebar.allVisits')"
        :subtitle="$t('visitsDesc')"
        icon="mdi:format-list-bulleted"
        :actions="[{ key: 'add', label: $t('newVisit'), icon: 'mdi:plus', variant: 'primary' }]"
        @action-click="navigateTo('/dashboard/visits/new')"
      />

      <div class="filters-section mb-4">
        <div class="row g-3 align-items-end">
          <div class="col-md-4">
            <SharedUiFormBaseInput v-model="filters.search" :placeholder="$t('searchVisits')" icon-left="mdi:magnify"
              :clearable="true" @update:model-value="debouncedSearch" @clear="clearSearch" />
          </div>
          <div class="col-md-2">
            <SharedUiFormBaseInput v-model="filters.dateFrom" type="date" :label="$t('from')" @update:model-value="fetchRecords" />
          </div>
          <div class="col-md-2">
            <SharedUiFormBaseInput v-model="filters.dateTo" type="date" :label="$t('to')" @update:model-value="fetchRecords" />
          </div>
          <div class="col-md-2">
            <SharedUiFormBaseSelect v-model="filters.status" :label="$t('status')" :options="statusOptions" @update:model-value="fetchRecords" />
          </div>
          <div class="col-md-2 d-flex justify-content-end gap-2">
            <SharedUiButtonBase variant="outline" icon-left="mdi:refresh" :loading="isRefreshing" @click="refreshData">{{ $t("refresh") }}</SharedUiButtonBase>
          </div>
        </div>
      </div>

      <div class="table-wrapper">
        <SharedUiTableDataTable
          :columns="tableColumns"
          :data="records"
          :loading="isLoading"
          :pagination="pagination"
          :row-clickable="true"
          :actions="tableActions"
          :empty-text="$t('noVisits')"
          empty-icon="mdi:stethoscope"
          @page-change="handlePageChange"
          @page-size-change="handlePageSizeChange"
          @action-click="handleActionClick"
          @row-click="(row) => navigateTo(`/dashboard/visits/${row.id}`)"
        >
          <template #cell-patient="{ row }">
            <div class="patient-cell">
              <div class="mini-avatar">{{ row.patient_name?.charAt(0) ?? "?" }}</div>
              <div>
                <p class="cell-name">{{ row.patient_name }}</p>
                <p class="cell-sub">{{ row.chief_complaint || "—" }}</p>
              </div>
            </div>
          </template>
          <template #cell-status="{ row }">
            <span class="visit-badge" :class="`status-${row.status}`">{{ row.status }}</span>
          </template>
          <template #cell-fee="{ row }">
            <span :class="['fee-val', { unpaid: !row.paid }]">
              {{ row.fee?.toFixed(2) }}
              <Icon :name="row.paid ? 'mdi:check-circle' : 'mdi:clock-outline'" size="13" />
            </span>
          </template>
          <template #cell-date="{ row }">
            <span class="text-muted">{{ fmtDateTime(row.visit_date) }}</span>
          </template>
        </SharedUiTableDataTable>
      </div>
    </div>

    <!-- Delete Modal -->
    <SharedUiDialogAppModal v-model="showDeleteModal" :title="$t('confirmDelete')" max-width="400px">
      <div class="text-center py-2">
        <Icon name="mdi:alert-circle" size="44" class="text-danger mb-2" />
        <p v-if="selectedItem">{{ $t("deleteVisitConfirm", { name: selectedItem.patient_name }) }}</p>
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
const { getVisits, deleteVisit } = useClinic();

const records = ref([]);
const isLoading = ref(false);
const isRefreshing = ref(false);
const isDeleting = ref(false);
const showDeleteModal = ref(false);
const selectedItem = ref(null);
const pagination = ref({ currentPage: 1, pageSize: 15, totalItems: 0, totalPages: 0 });

const filters = ref({ search: "", dateFrom: "", dateTo: "", status: "" });

const statusOptions = computed(() => [
  { value: "", label: t("all") },
  { value: "open", label: t("visitStatus.open") },
  { value: "closed", label: t("visitStatus.closed") },
  { value: "followup", label: t("visitStatus.followup") },
]);

const tableColumns = computed(() => [
  { key: "patient", label: t("patient"), sortable: false, width: "32%" },
  { key: "status", label: t("status"), sortable: false, width: "12%" },
  { key: "doctor_name", label: t("doctor"), sortable: false, width: "18%" },
  { key: "fee", label: t("fee"), sortable: false, width: "12%" },
  { key: "date", label: t("date"), sortable: false, width: "18%" },
]);

const tableActions = [
  { key: "view", label: "view", icon: "mdi:eye-outline", class: "btn-info" },
  { key: "delete", label: "delete", icon: "mdi:delete", class: "btn-danger" },
];

const fetchRecords = async () => {
  isLoading.value = true;
  try {
    const r = await getVisits({
      search: filters.value.search,
      dateFrom: filters.value.dateFrom || undefined,
      dateTo: filters.value.dateTo || undefined,
      status: filters.value.status || undefined,
      limit: pagination.value.pageSize,
      offset: (pagination.value.currentPage - 1) * pagination.value.pageSize,
    });
    if (r.ok) {
      records.value = r.data;
      pagination.value.totalItems = r.total;
      pagination.value.totalPages = Math.ceil(r.total / pagination.value.pageSize);
    }
  } finally { isLoading.value = false; isRefreshing.value = false; }
};

const debouncedSearch = useDebounceFn(() => { pagination.value.currentPage = 1; fetchRecords(); }, 400);
const clearSearch = () => { filters.value.search = ""; fetchRecords(); };
const refreshData = () => { isRefreshing.value = true; fetchRecords(); };
const handlePageChange = (p) => { pagination.value.currentPage = p; fetchRecords(); };
const handlePageSizeChange = (sz) => { pagination.value.pageSize = sz; pagination.value.currentPage = 1; fetchRecords(); };

const handleActionClick = async ({ action, row, setLoading }) => {
  setLoading(true);
  try {
    if (action.key === "view") navigateTo(`/dashboard/visits/${row.id}`);
    if (action.key === "delete") { selectedItem.value = row; showDeleteModal.value = true; }
  } finally { setLoading(false); }
};

const confirmDelete = async () => {
  if (!selectedItem.value) return;
  isDeleting.value = true;
  try {
    const r = await deleteVisit(selectedItem.value.id);
    if (r.ok) { $toast.success(t("deleteSuccess")); showDeleteModal.value = false; fetchRecords(); }
    else throw new Error(r.error);
  } catch (err) { $toast.error(err.message); }
  finally { isDeleting.value = false; selectedItem.value = null; }
};

const fmtDateTime = (d) => d ? new Date(d).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "—";

onMounted(fetchRecords);
</script>

<style lang="scss" scoped>
.visits-page { padding: 2rem; min-height: 100vh; background: var(--bg-page); }
.filters-section, .table-wrapper {
  background: var(--bg-surface); border-radius: 16px; padding: 1.5rem;
  box-shadow: 0 2px 12px rgba(0,0,0,.05); border: 1px solid var(--border-color);
}
.patient-cell { display: flex; align-items: center; gap: .55rem; }
.mini-avatar {
  width: 32px; height: 32px; border-radius: 50%; background: var(--primary);
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: .8rem; flex-shrink: 0;
}
.cell-name { font-weight: 600; font-size: .86rem; color: var(--text-primary); margin: 0; }
.cell-sub  { font-size: .74rem; color: var(--text-muted); margin: 0; }
.visit-badge {
  padding: .22rem .6rem; border-radius: 20px; font-size: .74rem; font-weight: 700;
  &.status-open     { background: rgba(245,158,11,.1); color: #f59e0b; }
  &.status-closed   { background: rgba(16,185,129,.1); color: #10b981; }
  &.status-followup { background: rgba(59,130,246,.1); color: #3b82f6; }
}
.fee-val {
  font-weight: 700; font-size: .85rem; display: flex; align-items: center; gap: .25rem; color: #10b981;
  &.unpaid { color: #f59e0b; }
}
.text-danger { color: #dc3545 !important; }
@media (max-width: 768px) { .visits-page { padding: 0; } .table-wrapper { padding: 0; } }
</style>
