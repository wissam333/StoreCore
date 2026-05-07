// store-app/middleware/auth.global.js
// Global middleware — runs automatically on every route in Nuxt 4.
// No need for `middleware: ['auth']` on individual pages.
// Login page opts out with `middleware: false` in definePageMeta.
//
// Hash mode note: navigateTo() works fine with hash routing —
// Nuxt handles the /#/ prefix internally.

export default defineNuxtRouteMiddleware(async (to) => {
  // Public routes — never redirect
  const PUBLIC = ["/auth/login"];
  if (PUBLIC.includes(to.path)) return;

  // Only guard dashboard routes — let everything else through
  if (!to.path.startsWith("/dashboard")) return;

  const { isLoggedIn, restoreSession } = useAuth();

  // Fast path — session already alive in useState
  if (isLoggedIn.value) return;

  // Try to restore (mobile: Preferences; Electron: always false)
  let restored = false;
  try {
    const result = await restoreSession();
    restored = result?.ok === true;
  } catch {
    restored = false;
  }

  if (restored) return;

  // No session — send to login, preserve intended destination
  return navigateTo(
    {
      path: "/auth/login",
      query: to.path !== "/dashboard" ? { redirect: to.path } : undefined,
    },
    { replace: true },
  );
});
