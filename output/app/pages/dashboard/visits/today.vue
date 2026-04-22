<template>
  <div class="today-visits-page">
    <div class="container-fluid">
      <SharedUiHeaderPage
        :title="$t('sidebar.todayVisits')"
        :subtitle="todayLabel"
        icon="mdi:calendar-today"
        :actions="[{ key: 'add', label: $t('newVisit'), icon: 'mdi:plus', variant: 'primary' }]"
        @action-click="navigateTo('/dashboard/visits/new')"
      />

      <!-- Summary chips -->
      <div class="summary-row mb-4">
        <div v-for="s in summary" :key="s.key" class="summary-chip" :class="s.color">
          <Icon :name="s.icon" size="18" />
          <span class="chip-count">{{ s.count }}</span>
          <span class="chip-label">{{ s.label }}</span>
        </div>
      </div>

      <div v-if="isLoading" class="loading-state">
        <Icon name="mdi:loading" size="36" class="spin" />
      </div>

      <div v-else-if="!records.length" class="empty-day">
        <Icon name="mdi:calendar-check-outline" size="52" />
        <h3>{{ $t("noVisitsToday") }}</h3>
        <SharedUiButtonBase variant="primary" icon-left="mdi:plus" @click="navigateTo('/dashboard/visits/new')">
          {{ $t("addFirstVisit") }}
        </SharedUiButtonBase>
      </div>

      <div v-else class="visits-grid">
        <div
          v-for="v in records"
          :key="v.id"
          class="visit-card"
          :class="`border-${v.status}`"
          @click="navigateTo(`/dashboard/visits/${v.id}`)"
        >
          <div class="vc-header">
            <div class="vc-avatar">{{ v.patient_name?.charAt(0) ?? "?" }}</div>
            <div class="vc-info">
              <p class="vc-name">{{ v.patient_name }}</p>
              <p class="vc-time">{{ fmtTime(v.visit_date) }}</p>
            </div>
            <span class="vc-status" :class="`status-${v.status}`">{{ v.status }}</span>
          </div>
          <div v-if="v.chief_complaint" class="vc-complaint">
            <Icon name="mdi:chat-question-outline" size="14" />
            {{ v.chief_complaint }}
          </div>
          <div v-if="v.diagnosis" class="vc-diagnosis">
            <Icon name="mdi:stethoscope" size="14" />
            {{ v.diagnosis }}
          </div>
          <div class="vc-footer">
            <span class="vc-doctor"><Icon name="mdi:doctor" size="13" /> {{ v.doctor_name ?? $t("unassigned") }}</span>
            <span class="vc-fee" :class="{ unpaid: !v.paid }">
              {{ v.fee?.toFixed(2) }}
              <Icon :name="v.paid ? 'mdi:check-circle' : 'mdi:clock-outline'" size="12" />
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
definePageMeta({ layout: "default" });

const { t } = useI18n();
const { getVisits } = useClinic();
const records = ref([]);
const isLoading = ref(true);

const today = new Date().toISOString().slice(0, 10);
const todayLabel = computed(() => new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }));

const summary = computed(() => [
  { key: "total",    icon: "mdi:format-list-checks", count: records.value.length, label: t("total"), color: "chip-blue" },
  { key: "open",     icon: "mdi:clock-outline",      count: records.value.filter(v => v.status === "open").length, label: t("visitStatus.open"), color: "chip-yellow" },
  { key: "closed",   icon: "mdi:check-circle",        count: records.value.filter(v => v.status === "closed").length, label: t("visitStatus.closed"), color: "chip-green" },
  { key: "followup", icon: "mdi:calendar-arrow-right",count: records.value.filter(v => v.status === "followup").length, label: t("visitStatus.followup"), color: "chip-blue2" },
]);

const fmtTime = (d) => d ? new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";

const load = async () => {
  isLoading.value = true;
  const r = await getVisits({ dateFrom: today, dateTo: today, limit: 200 });
  if (r.ok) records.value = r.data;
  isLoading.value = false;
};

onMounted(load);
</script>

<style lang="scss" scoped>
.today-visits-page { padding: 2rem; min-height: 100vh; background: var(--bg-page); }

.summary-row { display: flex; gap: .75rem; flex-wrap: wrap; }
.summary-chip {
  display: flex; align-items: center; gap: .45rem;
  padding: .55rem 1.1rem; border-radius: 20px; font-size: .85rem; font-weight: 600;
  &.chip-blue   { background: rgba(59,130,246,.1); color: #3b82f6; }
  &.chip-yellow { background: rgba(245,158,11,.1); color: #f59e0b; }
  &.chip-green  { background: rgba(16,185,129,.1); color: #10b981; }
  &.chip-blue2  { background: rgba(99,102,241,.1); color: #6366f1; }
}
.chip-count { font-size: 1.05rem; font-weight: 800; }

.loading-state { display: flex; justify-content: center; padding: 4rem; color: var(--primary); }
.spin { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.empty-day {
  display: flex; flex-direction: column; align-items: center; gap: 1rem;
  padding: 5rem 1rem; color: var(--text-muted);
  h3 { font-size: 1.15rem; font-weight: 600; margin: 0; color: var(--text-primary); }
}

.visits-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1rem;
}

.visit-card {
  background: var(--bg-surface); border-radius: 14px; padding: 1.1rem;
  border: 1.5px solid var(--border-color); cursor: pointer;
  transition: box-shadow .18s, transform .18s;
  &:hover { box-shadow: 0 6px 20px rgba(0,0,0,.09); transform: translateY(-2px); }

  &.border-open     { border-color: rgba(245,158,11,.35); }
  &.border-closed   { border-color: rgba(16,185,129,.35); }
  &.border-followup { border-color: rgba(59,130,246,.35); }
}

.vc-header { display: flex; align-items: center; gap: .65rem; margin-bottom: .65rem; }
.vc-avatar {
  width: 38px; height: 38px; border-radius: 50%; background: var(--primary);
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: .85rem; flex-shrink: 0;
}
.vc-name  { font-weight: 700; font-size: .9rem; color: var(--text-primary); margin: 0; }
.vc-time  { font-size: .75rem; color: var(--text-muted); margin: 0; }
.vc-status {
  margin-inline-start: auto; padding: .18rem .55rem; border-radius: 8px; font-size: .72rem; font-weight: 700;
  &.status-open     { background: rgba(245,158,11,.12); color: #f59e0b; }
  &.status-closed   { background: rgba(16,185,129,.12); color: #10b981; }
  &.status-followup { background: rgba(59,130,246,.12); color: #3b82f6; }
}
.vc-complaint, .vc-diagnosis {
  display: flex; align-items: flex-start; gap: .35rem;
  font-size: .8rem; color: var(--text-sub); margin-bottom: .35rem;
}
.vc-diagnosis { color: var(--text-primary); font-weight: 500; }
.vc-footer {
  display: flex; justify-content: space-between; align-items: center;
  padding-top: .65rem; margin-top: .35rem; border-top: 1px solid var(--border-color);
}
.vc-doctor { font-size: .76rem; color: var(--text-muted); display: flex; align-items: center; gap: .25rem; }
.vc-fee {
  font-size: .82rem; font-weight: 700; display: flex; align-items: center; gap: .2rem; color: #10b981;
  &.unpaid { color: #f59e0b; }
}

@media (max-width: 768px) { .today-visits-page { padding: 1rem; } }
</style>
