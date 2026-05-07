<!-- store-app/pages/dashboard/settings.vue -->
<template>
  <DashboardSettingsMain :can-edit="can('settings.edit').value" />
</template>

<script setup>
definePageMeta({
  searchMeta: {
    label: "Settings",
    labelAr: "الإعدادات",
    icon: "mdi:cog-outline",
    group: "Main",
  },
});

const { can, session } = useAuth();

// Redirect entirely if no view permission
onMounted(() => {
  if (!can("settings.view").value) navigateTo("/dashboard");
});
</script>
