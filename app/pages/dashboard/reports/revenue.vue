<template>
  <DashboardReportsRevenue v-if="can('reports.view').value" />
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
    label: "Revenue Report",
    labelAr: "تقرير الإيرادات",
    icon: "mdi:chart-bar",
    group: "Reports",
  },
});
const { can } = useAuth();
</script>
