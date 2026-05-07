<!-- store-app/pages/dashboard/orders/index.vue -->
<template>
  <DashboardOrdersList
    :can-add="can('orders.add').value"
    :can-delete="can('orders.delete').value"
  />
</template>

<script setup>
definePageMeta({
  searchMeta: {
    label: "Orders",
    labelAr: "الطلبات",
    icon: "mdi:receipt-text-outline",
    group: "Main",
  },
});
const { can } = useAuth();
</script>
