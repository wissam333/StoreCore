<template>
  <DashboardProductsCategories
    :can-add="can('products.add').value"
    :can-edit="can('products.edit').value"
    :can-delete="can('products.delete').value"
  />
</template>
<script setup>
definePageMeta({
  searchMeta: {
    label: "Categories",
    labelAr: "الفئات",
    icon: "mdi:shape-outline",
    group: "Main",
  },
});
const { can } = useAuth();
</script>
