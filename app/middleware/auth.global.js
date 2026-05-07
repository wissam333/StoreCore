export default defineNuxtRouteMiddleware(async (to) => {
  const PUBLIC = ["/auth/login", "/license", "/"];
  if (PUBLIC.includes(to.path)) return;

  if (!to.path.startsWith("/dashboard")) return;

  const { isLoggedIn, restoreSession } = useAuth();

  if (isLoggedIn.value) return;

  let restored = false;
  try {
    const result = await restoreSession();
    restored = result?.ok === true;
  } catch {
    restored = false;
  }

  if (restored) return;

  return navigateTo(
    {
      path: "/auth/login",
      query: to.path !== "/dashboard" ? { redirect: to.path } : undefined,
    },
    { replace: true },
  );
});
