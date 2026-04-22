<template>
  <div class="appointments-page">
    <div class="container-fluid">
      <SharedUiHeaderPage
        :title="$t('sidebar.appointments')"
        :subtitle="$t('appointmentsDesc')"
        icon="mdi:calendar-clock-outline"
        :actions="[{ key: 'add', label: $t('addNew'), icon: 'mdi:plus', variant: 'primary' }]"
        @action-click="openAddModal"
      />

      <div class="filters-section mb-4">
        <div class="row g-3 align-items-end">
          <div class="col-md-3">
            <SharedUiFormBaseInput v-model="filters.dateFrom" type="date" :label="$t('from')" @update:model-value="fetchRecords" />
          </div>
          <div class="col-md-3">
            <SharedUiFormBaseInput v-model="filters.dateTo" type="date" :label="$t('to')" @update:model-value="fetchRecords" />
          </div>
          <div class="col-md-3">
            <SharedUiFormBaseSelect v-model="filters.status" :label="$t('status')" :options="statusOptions" @update:model-value="fetchRecords" />
          </div>
          <div class="col-md-3 d-flex justify-content-end">
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
          :row-clickable="false"
          :actions="tableActions"
          :empty-text="$t('noAppointments')"
          empty-icon="mdi:calendar-blank-outline"
          @page-change="handlePageChange"
          @page-size-change="handlePageSizeChange"
          @action-click="handleActionClick"
        >
          <template #cell-patient="{ row }">
            <div class="patient-cell">
              <div class="mini-avatar">{{ row.patient_name?.charAt(0) ?? "?" }}</div>
              <div>
                <p class="cell-name">{{ row.patient_name }}</p>
                <p class="cell-sub">{{ row.patient_phone || "—" }}</p>
              </div>
            </div>
          </template>
          <template #cell-dateTime="{ row }">
            <div>
              <p class="dt-date">{{ fmtDate(row.appt_date) }}</p>
              <p class="dt-time">{{ fmtTime(row.appt_date) }}</p>
            </div>
          </template>
          <template #cell-status="{ row }">
            <span class="appt-badge" :class="`appt-${row.status}`">{{ row.status }}</span>
          </template>
        </SharedUiTableDataTable>
      </div>
    </div>

    <!-- Add / Edit Modal -->
    <SharedUiDialogReusableDialog
      v-model="showModal"
      :title="isEditing ? $t('editAppointment') : $t('addAppointment')"
      max-width="600px"
    >
      <div class="row g-3">
        <div class="col-12">
          <SharedUiFormBaseSelect v-model="form.patient_id" :label="$t('patient')" :options="patientOptions"
            :placeholder="$t('selectPatient')" :loading="isLoadingPatients" :required="true" />
        </div>
        <div class="col-md-8">
          <SharedUiFormBaseInput v-model="form.appt_date" :label="$t('dateTime')" type="datetime-local" :required="true" />
        </div>
        <div class="col-md-4">
          <SharedUiFormBaseInput v-model="form.duration_min" :label="$t('durationMin')" type="number" />
        </div>
        <div class="col-md-8">
          <SharedUiFormBaseSelect v-model="form.doctor_id" :label="$t('doctor')" :options="doctorOptions" :loading="isLoadingStaff" />
        </div>
        <div class="col-md-4">
          <SharedUiFormBaseSelect v-model="form.status" :label="$t('status')" :options="statusOptions" />
        </div>
        <div class="col-12">
          <SharedUiFormBaseInput v-model="form.reason" :label="$t('reason')" :placeholder="$t('enterReason')" type="textarea" :rows="2" />
        </div>
        <div class="col-12">
          <SharedUiFormBaseInput v-model="form.notes" :label="$t('notes')" :placeholder="$t('enterNotes')" type="textarea" :rows="2" />
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
        <p v-if="selectedItem">{{ $t("deleteConfirmation", { name: selectedItem.patient_name }) }}</p>
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
definePageMeta({ layout: "default" });

const { t } = useI18n();
const { $toast } = useNuxtApp();
const { getAppointments, saveAppointment, deleteAppointment, getPatients, getStaff } = useClinic();

const records = ref([]);
const isLoading = ref(false);
const isRefreshing = ref(false);
const isSubmitting = ref(false);
const isDeleting = ref(false);
const isLoadingPatients = ref(false);
const isLoadingStaff = ref(false);
const showModal = ref(false);
const showDeleteModal = ref(false);
const selectedItem = ref(null);
const isEditing = ref(false);
const pagination = ref({ currentPage: 1, pageSize: 15, totalItems: 0, totalPages: 0 });
const patients = ref([]);
const staff = ref([]);

const filters = ref({ dateFrom: "", dateTo: "", status: "" });
const form = ref({ patient_id: null, doctor_id: null, appt_date: "", duration_min: 30, reason: "", status: "scheduled", notes: "" });

const statusOptions = computed(() => [
  { value: "", label: t("all") },
  { value: "scheduled", label: t("apptStatus.scheduled") },
  { value: "completed", label: t("apptStatus.completed") },
  { value: "cancelled", label: t("apptStatus.cancelled") },
  { value: "no_show", label: t("apptStatus.no_show") },
]);

const patientOptions = computed(() => patients.value.map(p => ({ value: p.id, label: p.full_name })));
const doctorOptions = computed(() => [
  { value: null, label: "— " + t("unassigned") },
  ...staff.value.filter(s => s.role === "doctor" || s.role === "admin").map(s => ({ value: s.id, label: s.full_name })),
]);

const tableColumns = computed(() => [
  { key: "patient", label: t("patient"), sortable: false, width: "28%" },
  { key: "dateTime", label: t("dateTime"), sortable: false, width: "20%" },
  { key: "doctor_name", label: t("doctor"), sortable: false, width: "20%" },
  { key: "reason", label: t("reason"), sortable: false, width: "18%" },
  { key: "status", label: t("status"), sortable: false, width: "14%" },
]);

const tableActions = [
  { key: "edit", label: "edit", icon: "mdi:pencil", class: "btn-success" },
  { key: "delete", label: "delete", icon: "mdi:delete", class: "btn-danger" },
];

const fetchRecords = async () => {
  isLoading.value = true;
  try {
    const r = await getAppointments({
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

const refreshData = () => { isRefreshing.value = true; fetchRecords(); };
const handlePageChange = (p) => { pagination.value.currentPage = p; fetchRecords(); };
const handlePageSizeChange = (sz) => { pagination.value.pageSize = sz; pagination.value.currentPage = 1; fetchRecords(); };

const handleActionClick = async ({ action, row, setLoading }) => {
  setLoading(true);
  try {
    if (action.key === "edit") openEditModal(row);
    if (action.key === "delete") { selectedItem.value = row; showDeleteModal.value = true; }
  } finally { setLoading(false); }
};

const openAddModal = () => {
  isEditing.value = false; selectedItem.value = null;
  form.value = { patient_id: null, doctor_id: null, appt_date: new Date().toISOString().slice(0, 16), duration_min: 30, reason: "", status: "scheduled", notes: "" };
  showModal.value = true;
};
const openEditModal = (row) => { isEditing.value = true; selectedItem.value = row; form.value = { ...row }; showModal.value = true; };

const submit = async () => {
  if (!form.value.patient_id || !form.value.appt_date) return $toast.error(t("required"));
  isSubmitting.value = true;
  try {
    const payload = { ...form.value, id: isEditing.value ? selectedItem.value?.id : undefined };
    const r = await saveAppointment(payload);
    if (r.ok) { $toast.success(isEditing.value ? t("updateSuccess") : t("createSuccess")); showModal.value = false; fetchRecords(); }
    else throw new Error(r.error);
  } catch (err) { $toast.error(err.message); }
  finally { isSubmitting.value = false; }
};

const confirmDelete = async () => {
  isDeleting.value = true;
  try {
    const r = await deleteAppointment(selectedItem.value.id);
    if (r.ok) { $toast.success(t("deleteSuccess")); showDeleteModal.value = false; fetchRecords(); }
  } finally { isDeleting.value = false; selectedItem.value = null; }
};

const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : "—";
const fmtTime = (d) => d ? new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";

onMounted(async () => {
  isLoadingPatients.value = true; isLoadingStaff.value = true;
  const [pr, sr] = await Promise.all([getPatients({ limit: 10000 }), getStaff()]);
  if (pr.ok) patients.value = pr.data;
  if (sr.ok) staff.value = sr.data;
  isLoadingPatients.value = false; isLoadingStaff.value = false;
  fetchRecords();
});
</script>

<style lang="scss" scoped>
.appointments-page { padding: 2rem; min-height: 100vh; background: var(--bg-page); }
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
.dt-date { font-weight: 600; font-size: .85rem; margin: 0; color: var(--text-primary); }
.dt-time { font-size: .76rem; color: var(--text-muted); margin: 0; }
.appt-badge {
  padding: .22rem .6rem; border-radius: 20px; font-size: .74rem; font-weight: 700;
  &.appt-scheduled  { background: rgba(59,130,246,.1); color: #3b82f6; }
  &.appt-completed  { background: rgba(16,185,129,.1); color: #10b981; }
  &.appt-cancelled  { background: rgba(220,53,69,.1); color: #dc3545; }
  &.appt-no_show    { background: rgba(107,114,128,.1); color: #6b7280; }
}
.text-danger { color: #dc3545 !important; }
@media (max-width: 768px) { .appointments-page { padding: 0; } .table-wrapper { padding: 0; } }
</style>
