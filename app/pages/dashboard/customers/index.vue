<!-- store-app/pages/dashboard/customers/index.vue -->
<template>
  <DashboardCustomersList
    :can-add="can('customers.add').value"
    :can-edit="can('customers.edit').value"
    :can-delete="can('customers.delete').value"
  />
</template>

<script setup>
definePageMeta({
  searchMeta: {
    label: "Customers",
    labelAr: "العملاء",
    icon: "mdi:account-group-outline",
    group: "Main",
  },
});

const { can } = useAuth();
</script>
