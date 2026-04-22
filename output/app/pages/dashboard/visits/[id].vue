<template>
  <div class="visit-detail-page">
    <div class="container-fluid">
      <div class="page-top mb-4 d-flex gap-2">
        <SharedUiButtonBase variant="outline" icon-left="mdi:arrow-left" @click="navigateTo('/dashboard/visits')">{{ $t("back") }}</SharedUiButtonBase>
        <SharedUiButtonBase v-if="visit" variant="primary" icon-left="mdi:pencil"
          @click="navigateTo(`/dashboard/visits/new?edit=${visit.id}`)">{{ $t("edit") }}</SharedUiButtonBase>
      </div>

      <div v-if="isLoading" class="loading-state"><Icon name="mdi:loading" size="36" class="spin" /></div>

      <div v-else-if="visit" class="detail-layout">
        <!-- Header card -->
        <div class="surface-card">
          <div class="vh-header">
            <div class="vh-left">
              <span class="visit-badge" :class="`status-${visit.status}`">{{ visit.status }}</span>
              <h2>{{ visit.patient_name }}</h2>
              <p class="vh-meta">
                <Icon name="mdi:calendar" size="14" /> {{ fmtDateTime(visit.visit_date) }}
                <span class="sep">·</span>
                <Icon name="mdi:doctor" size="14" /> {{ visit.doctor_name ?? $t("unassigned") }}
                <span v-if="visit.fee" class="sep">·</span>
                <span v-if="visit.fee" class="fee" :class="{ unpaid: !visit.paid }">
                  {{ visit.fee?.toFixed(2) }}
                  <Icon :name="visit.paid ? 'mdi:check-circle' : 'mdi:clock-outline'" size="13" />
                </span>
              </p>
            </div>
            <span class="id-badge ms-auto">#{{ visit.id }}</span>
          </div>

          <div class="clinical-grid mt-4">
            <div v-if="visit.chief_complaint" class="clinical-item">
              <p class="ci-label"><Icon name="mdi:chat-question-outline" size="13" /> {{ $t("chiefComplaint") }}</p>
              <p class="ci-value">{{ visit.chief_complaint }}</p>
            </div>
            <div v-if="visit.diagnosis" class="clinical-item">
              <p class="ci-label"><Icon name="mdi:stethoscope" size="13" /> {{ $t("diagnosis") }}</p>
              <p class="ci-value">{{ visit.diagnosis }}</p>
            </div>
            <div v-if="visit.treatment" class="clinical-item">
              <p class="ci-label"><Icon name="mdi:medical-bag" size="13" /> {{ $t("treatment") }}</p>
              <p class="ci-value">{{ visit.treatment }}</p>
            </div>
            <div v-if="visit.notes" class="clinical-item">
              <p class="ci-label"><Icon name="mdi:note-text-outline" size="13" /> {{ $t("notes") }}</p>
              <p class="ci-value">{{ visit.notes }}</p>
            </div>
          </div>
        </div>

        <!-- Prescriptions -->
        <div class="surface-card mt-4">
          <div class="section-head">
            <Icon name="mdi:pill" size="17" />
            <h3>{{ $t("sidebar.prescriptions") }}</h3>
            <span class="count-badge">{{ visit.prescriptions?.length ?? 0 }}</span>
            <SharedUiButtonBase variant="primary" size="sm" icon-left="mdi:plus" class="ms-auto" @click="openRxModal()">{{ $t("add") }}</SharedUiButtonBase>
          </div>
          <div v-if="!visit.prescriptions?.length" class="section-empty">{{ $t("noPrescriptions") }}</div>
          <div v-else class="rx-list">
            <div v-for="rx in visit.prescriptions" :key="rx.id" class="rx-row">
              <Icon name="mdi:pill" size="16" class="rx-icon" />
              <div class="rx-info">
                <strong>{{ rx.drug_name }}</strong>
                <span class="rx-detail">{{ [rx.dose, rx.route, rx.frequency, rx.duration].filter(Boolean).join(" · ") }}</span>
              </div>
              <div class="rx-actions">
                <button class="icon-btn" @click="openRxModal(rx)"><Icon name="mdi:pencil" size="14" /></button>
                <button class="icon-btn danger" @click="deleteRx(rx.id)"><Icon name="mdi:delete" size="14" /></button>
              </div>
            </div>
          </div>
        </div>

        <!-- Investigations -->
        <div class="surface-card mt-4">
          <div class="section-head">
            <Icon name="mdi:test-tube" size="17" />
            <h3>{{ $t("sidebar.investigations") }}</h3>
            <span class="count-badge">{{ visit.investigations?.length ?? 0 }}</span>
            <SharedUiButtonBase variant="primary" size="sm" icon-left="mdi:plus" class="ms-auto" @click="openInvModal()">{{ $t("add") }}</SharedUiButtonBase>
          </div>
          <div v-if="!visit.investigations?.length" class="section-empty">{{ $t("noInvestigations") }}</div>
          <div v-else class="inv-list">
            <div v-for="inv in visit.investigations" :key="inv.id" class="inv-row">
              <div class="inv-info">
                <strong>{{ inv.test_name }}</strong>
                <span class="inv-type text-muted">{{ inv.test_type }}</span>
              </div>
              <span class="inv-badge" :class="`inv-${inv.status}`">{{ inv.status }}</span>
              <div v-if="inv.result" class="inv-result">{{ inv.result }}</div>
              <div class="rx-actions">
                <button class="icon-btn" @click="openInvModal(inv)"><Icon name="mdi:pencil" size="14" /></button>
                <button class="icon-btn danger" @click="deleteInv(inv.id)"><Icon name="mdi:delete" size="14" /></button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Rx Modal -->
    <SharedUiDialogReusableDialog v-model="showRxModal" :title="editingRx?.id ? $t('editPrescription') : $t('addPrescription')" max-width="550px">
      <div class="row g-3">
        <div class="col-12">
          <SharedUiFormBaseInput v-model="rxForm.drug_name" :label="$t('drugName')" :placeholder="$t('enterDrugName')" :required="true" />
        </div>
        <div class="col-md-4"><SharedUiFormBaseInput v-model="rxForm.dose"       :label="$t('dose')"       :placeholder="'500mg'" /></div>
        <div class="col-md-4"><SharedUiFormBaseInput v-model="rxForm.route"      :label="$t('route')"      :placeholder="'oral'" /></div>
        <div class="col-md-4"><SharedUiFormBaseInput v-model="rxForm.frequency"  :label="$t('frequency')"  :placeholder="'3x/day'" /></div>
        <div class="col-md-6"><SharedUiFormBaseInput v-model="rxForm.duration"   :label="$t('duration')"   :placeholder="'7 days'" /></div>
        <div class="col-12"><SharedUiFormBaseInput v-model="rxForm.instructions" :label="$t('instructions')" type="textarea" :rows="2" /></div>
      </div>
      <template #actions>
        <div class="d-flex gap-2 justify-content-end">
          <SharedUiButtonBase variant="outline" @click="showRxModal = false">{{ $t("cancel") }}</SharedUiButtonBase>
          <SharedUiButtonBase variant="primary" :loading="isSavingRx" @click="saveRx">{{ $t("save") }}</SharedUiButtonBase>
        </div>
      </template>
    </SharedUiDialogReusableDialog>

    <!-- Investigation Modal -->
    <SharedUiDialogReusableDialog v-model="showInvModal" :title="editingInv?.id ? $t('editInvestigation') : $t('addInvestigation')" max-width="550px">
      <div class="row g-3">
        <div class="col-md-8"><SharedUiFormBaseInput v-model="invForm.test_name" :label="$t('testName')" :placeholder="$t('enterTestName')" :required="true" /></div>
        <div class="col-md-4"><SharedUiFormBaseInput v-model="invForm.test_type" :label="$t('testType')" :placeholder="'lab'" /></div>
        <div class="col-md-6">
          <SharedUiFormBaseSelect v-model="invForm.status" :label="$t('status')" :options="invStatusOptions" />
        </div>
        <div class="col-md-6"><SharedUiFormBaseInput v-model="invForm.result_at" :label="$t('resultDate')" type="date" /></div>
        <div class="col-12"><SharedUiFormBaseInput v-model="invForm.result" :label="$t('result')" type="textarea" :rows="2" /></div>
        <div class="col-12"><SharedUiFormBaseInput v-model="invForm.notes" :label="$t('notes')" type="textarea" :rows="2" /></div>
      </div>
      <template #actions>
        <div class="d-flex gap-2 justify-content-end">
          <SharedUiButtonBase variant="outline" @click="showInvModal = false">{{ $t("cancel") }}</SharedUiButtonBase>
          <SharedUiButtonBase variant="primary" :loading="isSavingInv" @click="saveInv">{{ $t("save") }}</SharedUiButtonBase>
        </div>
      </template>
    </SharedUiDialogReusableDialog>
  </div>
</template>

<script setup>
definePageMeta({ layout: "default" });

const route = useRoute();
const { t } = useI18n();
const { $toast } = useNuxtApp();
const { getVisitById, savePrescription, deletePrescription, saveInvestigation, deleteInvestigation } = useClinic();

const visit = ref(null);
const isLoading = ref(true);

// Rx
const showRxModal = ref(false);
const editingRx = ref(null);
const isSavingRx = ref(false);
const rxForm = ref({});

// Investigation
const showInvModal = ref(false);
const editingInv = ref(null);
const isSavingInv = ref(false);
const invForm = ref({});

const invStatusOptions = computed(() => [
  { value: "pending", label: t("invStatus.pending") },
  { value: "resulted", label: t("invStatus.resulted") },
  { value: "reviewed", label: t("invStatus.reviewed") },
]);

const load = async () => {
  isLoading.value = true;
  const r = await getVisitById(route.params.id);
  if (r.ok) visit.value = r.data;
  isLoading.value = false;
};

const fmtDateTime = (d) => d ? new Date(d).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";

// Rx
const openRxModal = (rx = null) => {
  editingRx.value = rx;
  rxForm.value = rx ? { ...rx } : { drug_name: "", dose: "", route: "", frequency: "", duration: "", instructions: "" };
  showRxModal.value = true;
};
const saveRx = async () => {
  if (!rxForm.value.drug_name) return $toast.error(t("required"));
  isSavingRx.value = true;
  try {
    const payload = { ...rxForm.value, visit_id: visit.value.id, patient_id: visit.value.patient_id };
    const r = await savePrescription(payload);
    if (r.ok) { $toast.success(t("saveSuccess")); showRxModal.value = false; await load(); }
    else throw new Error(r.error);
  } catch (err) { $toast.error(err.message); }
  finally { isSavingRx.value = false; }
};
const deleteRx = async (id) => {
  const r = await deletePrescription(id);
  if (r.ok) { $toast.success(t("deleteSuccess")); await load(); }
};

// Investigation
const openInvModal = (inv = null) => {
  editingInv.value = inv;
  invForm.value = inv ? { ...inv } : { test_name: "", test_type: "", status: "pending", result: "", result_at: "", notes: "" };
  showInvModal.value = true;
};
const saveInv = async () => {
  if (!invForm.value.test_name) return $toast.error(t("required"));
  isSavingInv.value = true;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const payload = { ...invForm.value, visit_id: visit.value.id, patient_id: visit.value.patient_id, ordered_at: invForm.value.ordered_at || today };
    const r = await saveInvestigation(payload);
    if (r.ok) { $toast.success(t("saveSuccess")); showInvModal.value = false; await load(); }
    else throw new Error(r.error);
  } catch (err) { $toast.error(err.message); }
  finally { isSavingInv.value = false; }
};
const deleteInv = async (id) => {
  const r = await deleteInvestigation(id);
  if (r.ok) { $toast.success(t("deleteSuccess")); await load(); }
};

onMounted(load);
</script>

<style lang="scss" scoped>
.visit-detail-page { padding: 2rem; min-height: 100vh; background: var(--bg-page); }

.surface-card {
  background: var(--bg-surface); border-radius: 16px; padding: 1.75rem;
  border: 1px solid var(--border-color); box-shadow: 0 2px 12px rgba(0,0,0,.05);
}

.loading-state { display: flex; justify-content: center; padding: 5rem; color: var(--primary); }
.spin { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.vh-header { display: flex; align-items: flex-start; gap: .75rem; flex-wrap: wrap; }
.vh-left { flex: 1; }
.vh-left h2 { margin: .35rem 0 .3rem; font-size: 1.25rem; font-weight: 700; color: var(--text-primary); }
.vh-meta { font-size: .82rem; color: var(--text-muted); display: flex; align-items: center; gap: .35rem; flex-wrap: wrap; margin: 0; }
.sep { color: var(--border-color); }
.fee { font-weight: 700; color: #10b981; display: inline-flex; align-items: center; gap: .2rem; &.unpaid { color: #f59e0b; } }

.visit-badge {
  display: inline-block; padding: .22rem .65rem; border-radius: 20px; font-size: .75rem; font-weight: 700;
  &.status-open     { background: rgba(245,158,11,.1); color: #f59e0b; }
  &.status-closed   { background: rgba(16,185,129,.1); color: #10b981; }
  &.status-followup { background: rgba(59,130,246,.1); color: #3b82f6; }
}
.id-badge { padding: .2rem .55rem; border-radius: 8px; background: var(--primary-soft); color: var(--primary); font-size: .8rem; font-weight: 700; }

.clinical-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1.1rem;
}
.clinical-item { display: flex; flex-direction: column; gap: .3rem; }
.ci-label {
  display: flex; align-items: center; gap: .3rem;
  font-size: .72rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; margin: 0;
}
.ci-value { font-size: .88rem; color: var(--text-primary); line-height: 1.5; margin: 0; }

.section-head {
  display: flex; align-items: center; gap: .5rem; margin-bottom: 1rem;
  h3 { margin: 0; font-size: .95rem; font-weight: 700; color: var(--text-primary); }
}
.count-badge {
  padding: .15rem .5rem; border-radius: 8px; background: var(--primary-soft);
  color: var(--primary); font-size: .75rem; font-weight: 700;
}
.section-empty { font-size: .85rem; color: var(--text-muted); padding: .5rem 0; }

.rx-list, .inv-list { display: flex; flex-direction: column; gap: .5rem; }
.rx-row, .inv-row {
  display: flex; align-items: center; gap: .75rem;
  padding: .7rem .85rem; border-radius: 10px; background: var(--bg-elevated);
  border: 1px solid var(--border-color);
}
.rx-icon { color: var(--primary); flex-shrink: 0; }
.rx-info { flex: 1; display: flex; flex-direction: column; gap: .15rem; }
.rx-detail { font-size: .76rem; color: var(--text-sub); }
.rx-actions { display: flex; gap: .3rem; }

.inv-info { flex: 1; display: flex; flex-direction: column; gap: .1rem; }
.inv-type { font-size: .76rem; }
.inv-badge {
  padding: .18rem .5rem; border-radius: 8px; font-size: .72rem; font-weight: 700;
  &.inv-pending  { background: rgba(245,158,11,.1); color: #f59e0b; }
  &.inv-resulted { background: rgba(59,130,246,.1); color: #3b82f6; }
  &.inv-reviewed { background: rgba(16,185,129,.1); color: #10b981; }
}
.inv-result { font-size: .8rem; font-weight: 500; color: var(--text-primary); }

.icon-btn {
  width: 28px; height: 28px; border-radius: 7px; border: 1px solid var(--border-color);
  background: var(--bg-surface); color: var(--text-muted); display: flex; align-items: center;
  justify-content: center; cursor: pointer; transition: all .15s;
  &:hover { border-color: var(--primary); color: var(--primary); background: var(--primary-soft); }
  &.danger:hover { border-color: #dc3545; color: #dc3545; background: rgba(220,53,69,.08); }
}

.ms-auto { margin-inline-start: auto !important; }
@media (max-width: 768px) { .visit-detail-page { padding: 1rem; } }
</style>
