<!-- store-app/pages/dashboard/customers/[id]/index.vue -->
<template>
  <DashboardCustomersDetails
    :can-edit="can('customers.edit').value"
    :can-delete="can('customers.delete').value"
  />
</template>

<script setup>
definePageMeta({
  searchMeta: {
    label: "Customer Detail",
    labelAr: "تفاصيل العميل",
    icon: "mdi:account-outline",
    group: "Main",
  },
});

const { can } = useAuth();
</script>
