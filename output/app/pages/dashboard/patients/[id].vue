<template>
  <div class="patient-detail-page">
    <div class="container-fluid">
      <!-- Back + Header -->
      <div class="page-top mb-4">
        <SharedUiButtonBase variant="outline" icon-left="mdi:arrow-left" @click="navigateTo('/dashboard/patients')">
          {{ $t("back") }}
        </SharedUiButtonBase>
      </div>

      <div v-if="isLoading" class="loading-state">
        <Icon name="mdi:loading" size="36" class="spin" />
      </div>

      <div v-else-if="patient" class="detail-layout">
        <!-- Patient card -->
        <div class="patient-card surface-card">
          <div class="patient-header">
            <div class="patient-avatar large" :class="`gender-${patient.gender}`">
              {{ patient.full_name?.charAt(0) ?? "?" }}
            </div>
            <div class="patient-meta">
              <h2 class="patient-name">{{ patient.full_name }}</h2>
              <div class="patient-tags">
                <span class="gender-badge" :class="patient.gender">
                  <Icon :name="patient.gender === 'male' ? 'mdi:gender-male' : 'mdi:gender-female'" size="13" />
                  {{ $t(`gender.${patient.gender}`) }}
                </span>
                <span v-if="patient.blood_type" class="blood-badge">{{ patient.blood_type }}</span>
                <span class="id-badge">#{{ patient.id }}</span>
              </div>
            </div>
            <SharedUiButtonBase variant="primary" icon-left="mdi:pencil" class="ms-auto" @click="openEditModal">
              {{ $t("edit") }}
            </SharedUiButtonBase>
          </div>

          <div class="info-grid mt-4">
            <div class="info-item">
              <span class="info-label"><Icon name="mdi:phone-outline" size="13" /> {{ $t("phone") }}</span>
              <span class="info-value">{{ patient.phone || "—" }}</span>
            </div>
            <div class="info-item">
              <span class="info-label"><Icon name="mdi:email-outline" size="13" /> {{ $t("email") }}</span>
              <span class="info-value">{{ patient.email || "—" }}</span>
            </div>
            <div class="info-item">
              <span class="info-label"><Icon name="mdi:cake-variant-outline" size="13" /> {{ $t("dob") }}</span>
              <span class="info-value">{{ patient.dob ? fmtDate(patient.dob) : "—" }}</span>
            </div>
            <div class="info-item">
              <span class="info-label"><Icon name="mdi:map-marker-outline" size="13" /> {{ $t("address") }}</span>
              <span class="info-value">{{ patient.address || "—" }}</span>
            </div>
            <div v-if="patient.allergies" class="info-item col-span-2">
              <span class="info-label"><Icon name="mdi:alert-circle-outline" size="13" /> {{ $t("allergies") }}</span>
              <span class="info-value allergy">{{ patient.allergies }}</span>
            </div>
            <div v-if="patient.notes" class="info-item col-span-2">
              <span class="info-label"><Icon name="mdi:note-text-outline" size="13" /> {{ $t("notes") }}</span>
              <span class="info-value">{{ patient.notes }}</span>
            </div>
          </div>
        </div>

        <!-- Tabs: visits, prescriptions, investigations, appointments -->
        <div class="surface-card mt-4">
          <SharedUiNavigationTabs
            v-model="activeTab"
            variant="underlined"
            :tabs="[
              { label: 'sidebar.visits',        value: 'visits',         icon: 'mdi:stethoscope',         badge: patient.visits?.length },
              { label: 'sidebar.prescriptions', value: 'prescriptions',  icon: 'mdi:pill',                badge: patient.prescriptions?.length },
              { label: 'sidebar.investigations',value: 'investigations', icon: 'mdi:test-tube',            badge: patient.investigations?.length },
              { label: 'sidebar.appointments',  value: 'appointments',   icon: 'mdi:calendar-clock-outline',badge: patient.appointments?.length },
            ]"
          >
            <template #tab-visits>
              <div class="tab-content">
                <div class="tab-actions mb-3">
                  <SharedUiButtonBase variant="primary" size="sm" icon-left="mdi:plus"
                    @click="navigateTo(`/dashboard/visits/new?patientId=${patient.id}`)">
                    {{ $t("newVisit") }}
                  </SharedUiButtonBase>
                </div>
                <div v-if="!patient.visits?.length" class="tab-empty">
                  <Icon name="mdi:stethoscope" size="32" />
                  <p>{{ $t("noVisits") }}</p>
                </div>
                <div v-else class="timeline">
                  <div v-for="v in patient.visits" :key="v.id" class="timeline-item"
                    @click="navigateTo(`/dashboard/visits/${v.id}`)">
                    <div class="timeline-dot" :class="`status-${v.status}`" />
                    <div class="timeline-body">
                      <div class="d-flex justify-content-between">
                        <strong>{{ v.chief_complaint || $t("noComplaint") }}</strong>
                        <span class="visit-status-badge" :class="`status-${v.status}`">{{ v.status }}</span>
                      </div>
                      <p class="timeline-sub">{{ fmtDateTime(v.visit_date) }} · {{ v.doctor_name ?? $t("unassigned") }}</p>
                      <p v-if="v.diagnosis" class="timeline-diag">{{ v.diagnosis }}</p>
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <template #tab-prescriptions>
              <div class="tab-content">
                <div v-if="!patient.prescriptions?.length" class="tab-empty">
                  <Icon name="mdi:pill" size="32" />
                  <p>{{ $t("noPrescriptions") }}</p>
                </div>
                <div v-else class="rx-list">
                  <div v-for="rx in patient.prescriptions" :key="rx.id" class="rx-card">
                    <Icon name="mdi:pill" size="18" class="rx-icon" />
                    <div class="rx-body">
                      <strong>{{ rx.drug_name }}</strong>
                      <p class="rx-detail">{{ [rx.dose, rx.route, rx.frequency, rx.duration].filter(Boolean).join(" · ") }}</p>
                      <p v-if="rx.instructions" class="rx-note">{{ rx.instructions }}</p>
                    </div>
                    <span class="rx-date text-muted">{{ fmtDate(rx.created_at) }}</span>
                  </div>
                </div>
              </div>
            </template>

            <template #tab-investigations>
              <div class="tab-content">
                <div v-if="!patient.investigations?.length" class="tab-empty">
                  <Icon name="mdi:test-tube" size="32" />
                  <p>{{ $t("noInvestigations") }}</p>
                </div>
                <div v-else class="inv-list">
                  <div v-for="inv in patient.investigations" :key="inv.id" class="inv-row">
                    <div>
                      <strong>{{ inv.test_name }}</strong>
                      <span class="inv-type text-muted ms-2">{{ inv.test_type }}</span>
                    </div>
                    <span class="inv-status-badge" :class="`inv-${inv.status}`">{{ inv.status }}</span>
                    <span class="text-muted small">{{ fmtDate(inv.ordered_at) }}</span>
                    <p v-if="inv.result" class="inv-result">{{ inv.result }}</p>
                  </div>
                </div>
              </div>
            </template>

            <template #tab-appointments>
              <div class="tab-content">
                <div v-if="!patient.appointments?.length" class="tab-empty">
                  <Icon name="mdi:calendar-clock-outline" size="32" />
                  <p>{{ $t("noAppointments") }}</p>
                </div>
                <div v-else class="appt-list">
                  <div v-for="a in patient.appointments" :key="a.id" class="appt-row">
                    <div class="appt-date-col">
                      <Icon name="mdi:calendar-clock-outline" size="16" />
                      <span>{{ fmtDateTime(a.appt_date) }}</span>
                    </div>
                    <div>{{ a.reason || "—" }}</div>
                    <span class="appt-status-badge" :class="`appt-${a.status}`">{{ a.status }}</span>
                    <span class="text-muted small">{{ a.doctor_name ?? $t("unassigned") }}</span>
                  </div>
                </div>
              </div>
            </template>
          </SharedUiNavigationTabs>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
definePageMeta({ layout: "default" });

const route = useRoute();
const { getPatientById } = useClinic();
const patient = ref(null);
const isLoading = ref(true);
const activeTab = ref("visits");

const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : "—";
const fmtDateTime = (d) => d ? new Date(d).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "—";

const loadPatient = async () => {
  isLoading.value = true;
  const r = await getPatientById(route.params.id);
  if (r.ok) patient.value = r.data;
  isLoading.value = false;
};

const openEditModal = () => navigateTo(`/dashboard/patients?edit=${route.params.id}`);

onMounted(loadPatient);
</script>

<style lang="scss" scoped>
.patient-detail-page { padding: 2rem; min-height: 100vh; background: var(--bg-page); }

.surface-card {
  background: var(--bg-surface); border-radius: 16px; padding: 1.75rem;
  border: 1px solid var(--border-color); box-shadow: 0 2px 12px rgba(0,0,0,.05);
}

.loading-state {
  display: flex; justify-content: center; padding: 5rem;
  color: var(--primary);
}

.patient-header { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }

.patient-avatar {
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%; font-weight: 800; color: #fff; flex-shrink: 0;
  &.large { width: 64px; height: 64px; font-size: 1.4rem; }
  &.gender-male   { background: #3b82f6; }
  &.gender-female { background: #ec4899; }
  &.gender-other  { background: #8b5cf6; }
}
.patient-name { font-size: 1.35rem; font-weight: 700; color: var(--text-primary); margin: 0 0 .35rem; }
.patient-tags { display: flex; align-items: center; gap: .4rem; flex-wrap: wrap; }
.gender-badge {
  display: inline-flex; align-items: center; gap: .25rem;
  padding: .22rem .6rem; border-radius: 20px; font-size: .75rem; font-weight: 600;
  &.male   { background: rgba(59,130,246,.1); color: #3b82f6; }
  &.female { background: rgba(236,72,153,.1); color: #ec4899; }
}
.blood-badge {
  padding: .2rem .55rem; border-radius: 8px; background: rgba(220,53,69,.1);
  color: #dc3545; font-size: .78rem; font-weight: 700;
}
.id-badge {
  padding: .2rem .55rem; border-radius: 8px; background: var(--primary-soft);
  color: var(--primary); font-size: .78rem; font-weight: 700;
}

.info-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem;
  .col-span-2 { grid-column: 1/-1; }
}
.info-item { display: flex; flex-direction: column; gap: .2rem; }
.info-label {
  display: flex; align-items: center; gap: .3rem;
  font-size: .72rem; font-weight: 700; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: .04em;
}
.info-value { font-size: .88rem; color: var(--text-primary); font-weight: 500; }
.info-value.allergy { color: #dc3545; font-weight: 600; }

.tab-content { padding: 1rem 0; }
.tab-actions { display: flex; justify-content: flex-end; }
.tab-empty {
  display: flex; flex-direction: column; align-items: center; gap: .5rem;
  padding: 2.5rem; color: var(--text-muted); font-size: .88rem;
}

/* Timeline */
.timeline { display: flex; flex-direction: column; gap: 0; }
.timeline-item {
  display: flex; gap: 1rem; padding: .85rem;
  border-radius: 10px; cursor: pointer; transition: background .15s;
  &:hover { background: var(--bg-elevated); }
}
.timeline-dot {
  width: 10px; height: 10px; border-radius: 50%; margin-top: .35rem; flex-shrink: 0;
  &.status-open     { background: #f59e0b; }
  &.status-closed   { background: #10b981; }
  &.status-followup { background: #3b82f6; }
}
.timeline-body { flex: 1; }
.timeline-sub { font-size: .78rem; color: var(--text-muted); margin: .2rem 0 0; }
.timeline-diag { font-size: .8rem; color: var(--text-sub); margin: .2rem 0 0; font-style: italic; }
.visit-status-badge {
  font-size: .72rem; font-weight: 700; padding: .15rem .5rem; border-radius: 8px;
  &.status-open     { background: rgba(245,158,11,.1); color: #f59e0b; }
  &.status-closed   { background: rgba(16,185,129,.1); color: #10b981; }
  &.status-followup { background: rgba(59,130,246,.1); color: #3b82f6; }
}

/* Prescriptions */
.rx-list { display: flex; flex-direction: column; gap: .65rem; }
.rx-card {
  display: flex; align-items: flex-start; gap: .75rem;
  padding: .85rem; border: 1px solid var(--border-color); border-radius: 10px;
  background: var(--bg-elevated);
}
.rx-icon { color: var(--primary); margin-top: .1rem; flex-shrink: 0; }
.rx-body { flex: 1; }
.rx-detail { font-size: .78rem; color: var(--text-sub); margin: .2rem 0 0; }
.rx-note { font-size: .76rem; color: var(--text-muted); margin: .15rem 0 0; font-style: italic; }
.rx-date { font-size: .75rem; white-space: nowrap; flex-shrink: 0; }

/* Investigations */
.inv-list { display: flex; flex-direction: column; gap: .5rem; }
.inv-row {
  display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
  padding: .7rem 1rem; border-radius: 10px; background: var(--bg-elevated);
  border: 1px solid var(--border-color);
}
.inv-type { font-size: .75rem; }
.inv-status-badge {
  padding: .18rem .5rem; border-radius: 8px; font-size: .72rem; font-weight: 700;
  &.inv-pending  { background: rgba(245,158,11,.1); color: #f59e0b; }
  &.inv-resulted { background: rgba(59,130,246,.1); color: #3b82f6; }
  &.inv-reviewed { background: rgba(16,185,129,.1); color: #10b981; }
}
.inv-result { width: 100%; margin: .3rem 0 0; font-size: .8rem; color: var(--text-primary); }

/* Appointments */
.appt-list { display: flex; flex-direction: column; gap: .5rem; }
.appt-row {
  display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
  padding: .7rem 1rem; border-radius: 10px; background: var(--bg-elevated);
  border: 1px solid var(--border-color);
}
.appt-date-col { display: flex; align-items: center; gap: .35rem; font-weight: 600; font-size: .85rem; }
.appt-status-badge {
  padding: .18rem .5rem; border-radius: 8px; font-size: .72rem; font-weight: 700;
  &.appt-scheduled  { background: rgba(59,130,246,.1); color: #3b82f6; }
  &.appt-completed  { background: rgba(16,185,129,.1); color: #10b981; }
  &.appt-cancelled  { background: rgba(220,53,69,.1); color: #dc3545; }
  &.appt-no_show    { background: rgba(107,114,128,.1); color: #6b7280; }
}

.ms-auto { margin-inline-start: auto !important; }
.ms-2    { margin-inline-start: .5rem !important; }
.spin    { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 768px) {
  .patient-detail-page { padding: 1rem; }
}
</style>
