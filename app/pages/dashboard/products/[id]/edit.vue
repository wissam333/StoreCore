<template>
  <DashboardProductsForm
    :can-edit="can('products.edit').value"
    :can-delete="can('products.delete').value"
  />
</template>
<script setup>
definePageMeta({
  searchMeta: {
    label: "Edit Product",
    labelAr: "تعديل منتج",
    icon: "mdi:package-variant",
    group: "Main",
  },
});
const { can } = useAuth();
</script>
