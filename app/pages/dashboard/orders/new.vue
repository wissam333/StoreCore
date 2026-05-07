<!-- store-app/pages/dashboard/orders/new.vue -->
<template>
  <DashboardOrdersForm />
</template>

<script setup>
definePageMeta({
  searchMeta: {
    label: "New Order",
    labelAr: "طلب جديد",
    icon: "mdi:receipt-text-plus-outline",
    group: "Main",
  },
});

const { can } = useAuth();
onMounted(() => {
  if (!can("orders.add").value) navigateTo("/dashboard/orders");
});
</script>
