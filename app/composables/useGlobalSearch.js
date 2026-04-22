// composables/useGlobalSearch.js
export const useGlobalSearch = () => {
  const router = useRouter();
  const { locale } = useI18n();

  const pages = computed(() => {
    return router
      .getRoutes()
      .filter(
        (r) =>
          r.path.startsWith("/dashboard") &&
          !r.path.includes(":") &&
          r.name &&
          r.meta?.searchMeta,
      )
      .map((r) => ({
        to: r.path,
        label: r.meta.searchMeta.label,
        labelAr: r.meta.searchMeta.labelAr,
        icon: r.meta.searchMeta.icon ?? "mdi:file-outline",
        group: r.meta.searchMeta.group ?? "General",
      }));
  });

  const search = (query) => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return pages.value.filter(
      (p) =>
        p.label.toLowerCase().includes(q) ||
        p.labelAr?.includes(q) ||
        p.group.toLowerCase().includes(q),
    );
  };

  return { search, pages };
};
