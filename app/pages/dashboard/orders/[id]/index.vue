<!-- store-app/pages/dashboard/orders/[id]/index.vue -->
<template>
  <DashboardOrdersDetail
    :can-edit="can('orders.edit').value"
    :can-delete="can('orders.delete').value"
  />
</template>

<script setup>
definePageMeta({
  searchMeta: {
    label: "Order Detail",
    labelAr: "تفاصيل الطلب",
    icon: "mdi:receipt-text-outline",
    group: "Main",
  },
});
const { can } = useAuth();
</script>
