<template>
  <DashboardReportsDues v-if="can('reports.view').value" />
  <SharedUiFeedbackEmptyState
    v-else
    icon="mdi:lock-outline"
    title="noPermission"
    description="noPermissionDesc"
    size="md"
  />
</template>
<script setup>
definePageMeta({
  searchMeta: {
    label: "Dues Report",
    labelAr: "تقرير الديون",
    icon: "mdi:cash",
    group: "Reports",
  },
});
const { can } = useAuth();
</script>
