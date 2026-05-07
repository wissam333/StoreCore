<!-- store-app/pages/dashboard/orders/[id]/edit.vue -->
<template>
  <DashboardOrdersForm />
</template>

<script setup>
definePageMeta({
  searchMeta: {
    label: "Edit Order",
    labelAr: "تعديل طلب",
    icon: "mdi:receipt-text-edit-outline",
    group: "Main",
  },
});

const { can } = useAuth();
onMounted(() => {
  if (!can("orders.edit").value) navigateTo("/dashboard/orders");
});
</script>
