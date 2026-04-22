<template>
  <div style="overflow: hidden" :key="locale"></div>
</template>

<script setup>
const { locale } = useI18n();

// SEO Content
const seoData = {
  en: {
    title: "Home",
    description: "",
  },
  ar: {
    title: "الرئيسية",
    description: "",
  },
};

useAppSeo(
  locale.value === "en" ? seoData.en.title : seoData.ar.title,
  locale.value === "en" ? seoData.en.description : seoData.ar.description,
);
</script>

<style lang="scss" scoped></style>
