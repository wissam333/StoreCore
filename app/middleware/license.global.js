// store-app/middleware/license.global.js
export default defineNuxtRouteMiddleware(async (to) => {
  // Always allow license page
  if (to.path === "/license") return;

  // ── Electron ─────────────────────────────────────────────────────────────
  if (typeof window !== "undefined" && window.license) {
    const key = await window.license.getKey();
    if (!key) return navigateTo("/license", { replace: true });
    return;
  }

  // ── Mobile ───────────────────────────────────────────────────────────────
  if (import.meta.client) {
    try {
      const { verify } = useMobileLicense();
      const result = await verify();
      if (!result.ok) {
        return navigateTo("/license", { replace: true });
      }
    } catch {
      return navigateTo("/license", { replace: true });
    }
  }
});
