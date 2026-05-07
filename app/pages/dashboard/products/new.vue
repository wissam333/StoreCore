<template>
  <DashboardProductsForm :can-edit="can('products.add').value" />
</template>
<script setup>
definePageMeta({
  searchMeta: {
    label: "New Product",
    labelAr: "منتج جديد",
    icon: "mdi:package-variant-plus",
    group: "Main",
  },
});
const { can } = useAuth();
</script>
