<template>
  <DashboardProductsList
    :can-add="can('products.add').value"
    :can-edit="can('products.edit').value"
    :can-delete="can('products.delete').value"
  />
</template>
<script setup>
definePageMeta({
  searchMeta: {
    label: "Products",
    labelAr: "المنتجات",
    icon: "mdi:package-variant-closed",
    group: "Main",
  },
});
const { can } = useAuth();
</script>
