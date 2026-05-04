// https://nuxt.com/docs/api/configuration/nuxt-config
import { nodePolyfills } from "vite-plugin-node-polyfills";
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  modules: [
    "@nuxt/icon",
    "@nuxt/image",
    "@nuxt/fonts",
    "@nuxtjs/i18n",
    "@vee-validate/nuxt",
  ],

  icon: {
    fallbackToApi: false,
    provider: "client",
    clientBundle: {
      scan: true,
      includeCustomCollections: false,
    },
    serverBundle: {
      collections: ["ph", "bi", "mdi"],
    },
  },

  nitro: {
    publicAssets: [
      {
        baseURL: "/",
        dir: "public",
        maxAge: 0,
      },
    ],
  },
  ssr: false,
  router: {
    options: {
      hashMode: true, // Required for Electron to handle routing correctly
    },
  },
  veeValidate: {
    autoImports: true,
    componentNames: {
      Form: "VeForm",
      Field: "VeField",
      FieldArray: "VeFieldArray",
      ErrorMessage: "VeErrorMessage",
    },
  },
  i18n: {
    strategy: "no_prefix", // بدون تغيير في الرابط
    langDir: "locales/",
    defaultLocale: "ar",
    lazy: false,
    locales: [
      {
        code: "ar",
        iso: "ar-EG",
        name: "العربية",
        file: "ar.json",
        dir: "rtl",
      },
      {
        code: "en",
        iso: "en-US",
        name: "English",
        file: "en.json",
        dir: "ltr",
      },
    ],
    detectBrowserLanguage: {
      useCookie: true, // IMPORTANT: Use cookies, not just browser settings
      cookieKey: "i18n_redirected",
      redirectOn: "root",
    },
  },

  css: ["bootstrap/dist/css/bootstrap.min.css", "@/assets/scss/main.scss"],
  image: {
    provider: "ipx",
    format: ["webp"],
    quality: 80,
  },

  app: {
    baseURL: "./",
    head: {
      title: "Store",
      htmlAttrs: {
        lang: "ar",
      },
      meta: [
        { charset: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { name: "description", content: "Store Management System" },
      ],
      link: [
        {
          rel: "icon",
          href: "/logo/logo.png",
          type: "image/x-icon",
        },
      ],
      script: [
        {
          innerHTML: "var exports = {};",
          type: "text/javascript",
        },
      ],
    },
  },
  vite: {
    build: {
      target: "esnext",
    },
    assetsInclude: ["**/*.wasm"],
    server: {
      headers: {
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Opener-Policy": "same-origin",
      },
    },
    plugins: [
      nodePolyfills({
        protocolImports: true,
      }),
    ],
  },
  runtimeConfig: {},
});
