export const useAppSeo = (title, description, image) => {
  const {
    public: { apiBase },
  } = useRuntimeConfig();
  const route = useRoute();
  const { locale } = useI18n();

  // Clean up the image URL
  const seoImage = image
    ? image.startsWith("http")
      ? image
      : `${apiBase}${image}`
    : "/logo/logo-web.png";

  const canonical = `
https://api.uaehandball.org${route.path}`;

  useSeoMeta({
    title: `${title} | UAE Handball`,
    ogTitle: title,
    description: description,
    ogDescription: description,
    ogImage: seoImage,
    twitterCard: "summary_large_image",
  });

  useHead({
    link: [
      {
        rel: "canonical",
        href: canonical,
      },
    ],
    htmlAttrs: {
      // Dynamically sets lang to 'en' or 'ar' based on your i18n preference
      lang: locale.value,
      dir: locale.value === "ar" ? "rtl" : "ltr",
    },
  });
};
