// store-app/composables/useAuth.js
// Unified auth composable — works on both Electron (IPC) and Capacitor (mobile).
//
// IMPORTANT: Session is stored on globalThis so it survives Vite module
// re-evaluation (which resets module-level vars to their initial value).
// This is the correct pattern for a truly singleton ref in Nuxt 4 + Vite.

if (!globalThis.__authSession__) {
  globalThis.__authSession__ = ref(null);
}
const _session = globalThis.__authSession__;

export const useAuth = () => {
  const isMobile = () => typeof window !== "undefined" && !window.__ELECTRON__;

  const getMobileAuth = async () => {
    const { useMobileAuth } = await import("./useMobileAuth");
    return useMobileAuth();
  };

  // ── login ─────────────────────────────────────────────────────────────────
  const login = async (credentials) => {
    let result;
    if (isMobile()) {
      const auth = await getMobileAuth();
      result = await auth.login(credentials);
    } else {
      result = await window.auth.login(credentials);
    }
    if (result.ok) {
      _session.value = { token: result.token, ...result.staff };
    }
    return result;
  };

  // ── restoreSession ────────────────────────────────────────────────────────
  const restoreSession = async () => {
    if (_session.value) return { ok: true };

    if (isMobile()) {
      const auth = await getMobileAuth();
      const result = await auth.restoreSession();
      if (result.ok && result.staff) {
        _session.value = { token: result.token, ...result.staff };
      }
      return result;
    }

    // Electron: no persistent session — always requires login
    return { ok: false };
  };

  // ── logout ────────────────────────────────────────────────────────────────
  // Clears everything: in-memory session, Preferences token, and any cached
  // state. Then navigates to login. This is a real logout.
  const logout = async () => {
    const token = _session.value?.token;
    _session.value = null;

    try {
      if (isMobile()) {
        const auth = await getMobileAuth();
        await auth.logout(token);
      } else {
        // Electron IPC handler expects { token }, not a bare string
        await window.auth.logout({ token });
      }
    } catch (e) {
      console.warn("[auth] logout error:", e?.message);
    }

    await navigateTo("/auth/login", { replace: true });
  };

  // ── Permission helpers ────────────────────────────────────────────────────
  const can = (permission) =>
    computed(() => _session.value?.permissions?.[permission] === true);

  const requirePermission = (permission) => {
    if (!_session.value) {
      navigateTo("/auth/login");
      return false;
    }
    if (!_session.value.permissions?.[permission]) {
      navigateTo("/dashboard");
      return false;
    }
    return true;
  };

  const isLoggedIn = computed(() => !!_session.value);
  const staff = computed(() => _session.value ?? null);

  // ── Role & staff management ───────────────────────────────────────────────
  const getRoles = async () => {
    const token = _session.value?.token;
    if (isMobile()) {
      const auth = await getMobileAuth();
      return auth.getRoles(token);
    }
    return window.auth.getRoles(token);
  };

  const saveRole = async (role) => {
    const token = _session.value?.token;
    if (isMobile()) {
      const auth = await getMobileAuth();
      return auth.saveRole(token, role);
    }
    return window.auth.saveRole(token, role);
  };

  const deleteRole = async (roleId) => {
    const token = _session.value?.token;
    if (isMobile()) {
      const auth = await getMobileAuth();
      return auth.deleteRole(token, roleId);
    }
    return window.auth.deleteRole(token, roleId);
  };

  const getStaffWithRoles = async (search = "") => {
    const token = _session.value?.token;
    if (isMobile()) {
      const auth = await getMobileAuth();
      return auth.getStaffWithRoles(token, search);
    }
    return window.auth.getStaffWithRoles(token, search);
  };

  const saveStaff = async (staffData) => {
    const token = _session.value?.token;
    if (isMobile()) {
      const auth = await getMobileAuth();
      return auth.saveStaff(token, staffData);
    }
    return window.auth.saveStaff(token, staffData);
  };

  const deleteStaff = async (staffId) => {
    const token = _session.value?.token;
    if (isMobile()) {
      const auth = await getMobileAuth();
      return auth.deleteStaff(token, staffId);
    }
    return window.auth.deleteStaff(token, staffId);
  };

  const changePassword = async (currentPassword, newPassword) => {
    const token = _session.value?.token;
    if (isMobile()) {
      const auth = await getMobileAuth();
      return auth.changePassword(token, currentPassword, newPassword);
    }
    return window.auth.changePassword(token, currentPassword, newPassword);
  };

  const resetPassword = async (staffId, newPassword) => {
    const token = _session.value?.token;
    if (isMobile()) {
      const auth = await getMobileAuth();
      return auth.resetPassword(token, staffId, newPassword);
    }
    return window.auth.resetPassword(token, staffId, newPassword);
  };

  return {
    session: _session,
    staff,
    isLoggedIn,
    login,
    restoreSession,
    logout,
    can,
    requirePermission,
    getRoles,
    saveRole,
    deleteRole,
    getStaffWithRoles,
    saveStaff,
    deleteStaff,
    changePassword,
    resetPassword,
  };
};
