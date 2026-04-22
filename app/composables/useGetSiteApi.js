import { unref } from "vue";

export const useGetSiteApi = () => {
  const {
    public: { apiBase, cachedTime },
  } = useRuntimeConfig();
  const nuxtApp = useNuxtApp();

  const handleCachingDataTime = (key) => {
    const data = nuxtApp.payload.data[key] ?? nuxtApp.static.data[key];

    if (!data) return undefined;

    if (!data.fetchedAt) return data;

    const fetchedAt = Number(data.fetchedAt);
    if (isNaN(fetchedAt)) return data;

    const expirationDate = fetchedAt + Number(cachedTime ?? 0);

    if (expirationDate < Date.now()) return undefined;

    return data;
  };

  const _fetch = (url, options = {}) => {
    const { isServer = true, isLazy = false, ...extraOptions } = options;

    const urlString = typeof url === "function" ? url() : unref(url);
    const keyRaw = options.key != null ? unref(options.key) : urlString;
    const fetchKey = typeof keyRaw === "string" ? keyRaw : String(keyRaw);

    return useFetch(url, {
      key: fetchKey,
      baseURL: apiBase ?? "https://api.uaehandball.org/",
      server: isServer,
      lazy: isLazy,
      headers: {
        "Accept-Language": "en-US",
        ...(useMainToken().value
          ? { Authorization: `Bearer ${useMainToken().value}` }
          : {}),
        ...extraOptions.headers,
      },
      transform(input) {
        return { ...input, fetchedAt: Date.now() };
      },
      getCachedData(key) {
        return handleCachingDataTime(key);
      },
      ...extraOptions,
    });
  };

  return {
    GetAll: (endpoint, options = {}) => _fetch(endpoint, options),
    GetById: (endpointWithoutId, id, options = {}) =>
      _fetch(() => `${endpointWithoutId}${unref(id)}`, options),
  };
};
