<!-- store-app/pages/dashboard/dues/index.vue -->
<template>
  <DashboardDuesList
    :can-add="can('dues.add').value"
    :can-edit="can('dues.edit').value"
    :can-delete="can('dues.delete').value"
  />
</template>

<script setup>
definePageMeta({
  searchMeta: {
    label: "Dues",
    labelAr: "المديونيات",
    icon: "mdi:cash-clock",
    group: "Main",
  },
});

const { can } = useAuth();
</script>
