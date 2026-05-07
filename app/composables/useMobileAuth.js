// store-app/composables/useMobileAuth.js
// Mobile (Capacitor) auth layer — mirrors electron/ipc/auth.js exactly.
// All logic runs client-side against the local SQLite DB.
// Session token is persisted in @capacitor/preferences so the user
// stays logged in across app restarts.
//
// Biometric package: @capgo/capacitor-native-biometric
// Install: npm install @capgo/capacitor-native-biometric

import { getMobileDb } from "./useMobileDb";
import { generateUuid } from "./useUuid";

// ── Crypto helpers ─────────────────────────────────────────────────────────
const bufToHex = (buf) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const sha256 = async (str) => {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return bufToHex(buf);
};

const randomHex = (bytes = 16) => {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return bufToHex(arr);
};

export const hashPassword = async (plain) => {
  const salt = randomHex(16);
  const hash = await sha256(`${salt}:${plain}`);
  return `${salt}:${hash}`;
};

export const verifyPassword = async (plain, stored) => {
  if (!stored) return false;
  if (!stored.includes(":")) return plain === stored; // legacy plain seed
  const [salt, hash] = stored.split(":");
  const attempt = await sha256(`${salt}:${plain}`);
  return attempt === hash;
};

// ── Preferences keys ───────────────────────────────────────────────────────
const PREF_TOKEN = "auth_token";
const PREF_USERNAME = "auth_username"; // saved for biometric re-auth

// ── In-memory sessions ─────────────────────────────────────────────────────
const sessions = new Map();

// ── Preferences helpers ────────────────────────────────────────────────────
const savePrefs = async (token, username) => {
  try {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.set({ key: PREF_TOKEN, value: token });
    await Preferences.set({ key: PREF_USERNAME, value: username });
  } catch {}
};

const loadPrefs = async () => {
  try {
    const { Preferences } = await import("@capacitor/preferences");
    const [t, u] = await Promise.all([
      Preferences.get({ key: PREF_TOKEN }),
      Preferences.get({ key: PREF_USERNAME }),
    ]);
    return { token: t.value ?? null, username: u.value ?? null };
  } catch {
    return { token: null, username: null };
  }
};

const clearPrefs = async () => {
  try {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.remove({ key: PREF_TOKEN });
    await Preferences.remove({ key: PREF_USERNAME });
  } catch {}
};

// ── Biometric helpers ──────────────────────────────────────────────────────
// Returns true if biometric hardware exists and is enrolled on the device.
const isBiometricAvailable = async () => {
  try {
    const { NativeBiometric } = await import(
      "@capgo/capacitor-native-biometric"
    );
    const result = await NativeBiometric.isAvailable();
    return result.isAvailable === true;
  } catch {
    return false;
  }
};

// Triggers the native biometric prompt.
// Resolves if authenticated, throws if cancelled or failed.
const triggerBiometric = async () => {
  const { NativeBiometric } = await import("@capgo/capacitor-native-biometric");
  await NativeBiometric.verifyIdentity({
    reason: "Confirm your identity to log in",
    title: "Biometric Login",
    subtitle: "Use your fingerprint or face to continue",
    cancelTitle: "Use Password",
  });
};

// ── Session builder ────────────────────────────────────────────────────────
const buildSession = (staffRow, permissions) => {
  const token = randomHex(32);
  const session = {
    token,
    id: staffRow.id,
    full_name: staffRow.full_name,
    username: staffRow.username,
    role: staffRow.role,
    role_id: staffRow.role_id,
    permissions,
    created_at: Date.now(),
  };
  sessions.set(token, session);
  return session;
};

// ── Staff + permissions loader ─────────────────────────────────────────────
const loadStaffWithPermissions = async (username) => {
  const db = await getMobileDb();
  const staff = (
    await db.query(
      `SELECT s.*, r.permissions as role_permissions
       FROM staff s
       LEFT JOIN roles r ON s.role_id = r.id
       WHERE s.username = ? AND s._deleted = 0 AND s.is_active = 1
       LIMIT 1`,
      [username.trim().toLowerCase()],
    )
  ).values?.[0];
  if (!staff) return null;

  let permissions = {};
  try {
    permissions = JSON.parse(staff.role_permissions ?? "{}");
  } catch {}

  return { staff, permissions };
};

// ── Public API ─────────────────────────────────────────────────────────────
export const useMobileAuth = () => {
  // ── login ────────────────────────────────────────────────────────────────
  const login = async ({ username, password }) => {
    try {
      if (!username || !password)
        return { ok: false, error: "Username and password are required" };

      const result = await loadStaffWithPermissions(username);
      if (!result) return { ok: false, error: "Invalid username or password" };

      const { staff, permissions } = result;
      const valid = await verifyPassword(password, staff.password);
      if (!valid) return { ok: false, error: "Invalid username or password" };

      // Auto-upgrade plain-text seed password on first login
      if (staff.password && !staff.password.includes(":")) {
        const db = await getMobileDb();
        const hashed = await hashPassword(password);
        await db.run(
          `UPDATE staff SET password = ?, updated_at = datetime('now') WHERE id = ?`,
          [hashed, staff.id],
        );
      }

      // Update last_login
      const db = await getMobileDb();
      await db.run(
        `UPDATE staff SET last_login = datetime('now') WHERE id = ?`,
        [staff.id],
      );

      const session = buildSession(staff, permissions);
      await savePrefs(session.token, staff.username);

      return {
        ok: true,
        token: session.token,
        staff: {
          id: session.id,
          full_name: session.full_name,
          username: session.username,
          role: session.role,
          role_id: session.role_id,
          permissions: session.permissions,
        },
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  // ── loginWithFingerprint ─────────────────────────────────────────────────
  // 1. Load saved username from Preferences
  // 2. Check biometric is available on this device
  // 3. Trigger native biometric prompt
  // 4. On success → create session without password re-check
  const loginWithFingerprint = async () => {
    try {
      const { username } = await loadPrefs();
      if (!username)
        return { ok: false, error: "No saved user for biometric login" };

      // Check hardware availability
      const available = await isBiometricAvailable();
      if (!available)
        return {
          ok: false,
          error: "Biometric authentication not available on this device",
        };

      // Trigger native prompt — throws on cancel/failure
      await triggerBiometric();

      // Biometric passed — load staff and create session
      const result = await loadStaffWithPermissions(username);
      if (!result) return { ok: false, error: "Account not found or disabled" };

      const { staff, permissions } = result;
      const db = await getMobileDb();
      await db.run(
        `UPDATE staff SET last_login = datetime('now') WHERE id = ?`,
        [staff.id],
      );

      const session = buildSession(staff, permissions);
      await savePrefs(session.token, staff.username);

      return {
        ok: true,
        token: session.token,
        staff: {
          id: session.id,
          full_name: session.full_name,
          username: session.username,
          role: session.role,
          role_id: session.role_id,
          permissions: session.permissions,
        },
      };
    } catch (err) {
      // NativeBiometric throws on cancel/failure
      const msg = err.message ?? "";
      return {
        ok: false,
        error: msg.toLowerCase().includes("cancel")
          ? "cancel"
          : msg || "Biometric authentication failed",
      };
    }
  };

  // ── restoreSession ───────────────────────────────────────────────────────
  const restoreSession = async () => {
    try {
      const { token, username } = await loadPrefs();
      if (!token || !username) return { ok: false };

      // Token still alive in this JS session (same WebView — rare after kill)
      if (sessions.has(token)) {
        const s = sessions.get(token);
        return {
          ok: true,
          token,
          staff: {
            id: s.id,
            full_name: s.full_name,
            username: s.username,
            role: s.role,
            role_id: s.role_id,
            permissions: s.permissions,
          },
        };
      }

      // App was killed — token gone from memory.
      // Check if biometric is available so the login page can show the button.
      const canUseBiometric = await isBiometricAvailable();
      const staffExists = !!(await loadStaffWithPermissions(username));

      if (!staffExists) {
        await clearPrefs();
        return { ok: false };
      }

      // Return hint — login page shows fingerprint button pre-filled
      return { ok: false, canUseBiometric, username };
    } catch {
      return { ok: false };
    }
  };

  // ── logout ───────────────────────────────────────────────────────────────
  const logout = async (token) => {
    if (token) sessions.delete(token);
    await clearPrefs();
    return { ok: true };
  };

  // ── getSession ───────────────────────────────────────────────────────────
  const getSession = (token) => {
    if (!token) return { ok: false };
    const s = sessions.get(token);
    if (!s) return { ok: false };
    return {
      ok: true,
      staff: {
        id: s.id,
        full_name: s.full_name,
        username: s.username,
        role: s.role,
        role_id: s.role_id,
        permissions: s.permissions,
      },
    };
  };

  // ── checkPermission ──────────────────────────────────────────────────────
  const checkPermission = (token, permission) => {
    if (!token) return false;
    const s = sessions.get(token);
    if (!s) return false;
    return s.permissions[permission] === true;
  };

  // ── changePassword ───────────────────────────────────────────────────────
  const changePassword = async (token, currentPassword, newPassword) => {
    try {
      if (!token) return { ok: false, error: "Not authenticated" };
      const s = sessions.get(token);
      if (!s) return { ok: false, error: "Session expired" };
      if (!newPassword || newPassword.length < 4)
        return {
          ok: false,
          error: "New password must be at least 4 characters",
        };

      const db = await getMobileDb();
      const staff = (
        await db.query(`SELECT * FROM staff WHERE id = ? AND _deleted = 0`, [
          s.id,
        ])
      ).values?.[0];
      if (!staff) return { ok: false, error: "Staff not found" };

      const valid = await verifyPassword(currentPassword, staff.password);
      if (!valid) return { ok: false, error: "Current password is incorrect" };

      const hashed = await hashPassword(newPassword);
      await db.run(
        `UPDATE staff SET password = ?, version = version + 1, updated_at = datetime('now') WHERE id = ?`,
        [hashed, s.id],
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  // ── resetPassword (admin only) ───────────────────────────────────────────
  const resetPassword = async (token, staffId, newPassword) => {
    try {
      if (!token) return { ok: false, error: "Not authenticated" };
      const s = sessions.get(token);
      if (!s) return { ok: false, error: "Session expired" };
      if (!s.permissions["staff.manage"])
        return { ok: false, error: "Permission denied" };
      if (!newPassword || newPassword.length < 4)
        return { ok: false, error: "Password must be at least 4 characters" };

      const db = await getMobileDb();
      const hashed = await hashPassword(newPassword);
      await db.run(
        `UPDATE staff SET password = ?, version = version + 1, updated_at = datetime('now') WHERE id = ?`,
        [hashed, staffId],
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  // ── getRoles ─────────────────────────────────────────────────────────────
  const getRoles = async (token) => {
    try {
      if (!token) return { ok: false, error: "Not authenticated" };
      const s = sessions.get(token);
      if (!s) return { ok: false, error: "Session expired" };

      const db = await getMobileDb();
      const rows =
        (
          await db.query(
            `SELECT id, name, permissions, is_system FROM roles WHERE _deleted = 0 ORDER BY name`,
          )
        ).values ?? [];

      return {
        ok: true,
        data: rows.map((r) => ({
          ...r,
          permissions: (() => {
            try {
              return JSON.parse(r.permissions);
            } catch {
              return {};
            }
          })(),
        })),
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  // ── saveRole ─────────────────────────────────────────────────────────────
  const saveRole = async (token, role) => {
    try {
      if (!token) return { ok: false, error: "Not authenticated" };
      const s = sessions.get(token);
      if (!s) return { ok: false, error: "Session expired" };
      if (!s.permissions["staff.manage"])
        return { ok: false, error: "Permission denied" };

      const db = await getMobileDb();
      const permJson = JSON.stringify(role.permissions ?? {});

      if (role.id) {
        const existing = (
          await db.query(`SELECT is_system FROM roles WHERE id = ?`, [role.id])
        ).values?.[0];
        if (existing?.is_system)
          return { ok: false, error: "System roles cannot be edited" };

        await db.run(
          `UPDATE roles SET name = ?, permissions = ?, version = version + 1, updated_at = datetime('now') WHERE id = ?`,
          [role.name, permJson, role.id],
        );
        return { ok: true, id: role.id };
      } else {
        const id = generateUuid();
        await db.run(
          `INSERT INTO roles (id, name, permissions, is_system) VALUES (?, ?, ?, 0)`,
          [id, role.name, permJson],
        );
        return { ok: true, id };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  // ── deleteRole ───────────────────────────────────────────────────────────
  const deleteRole = async (token, roleId) => {
    try {
      if (!token) return { ok: false, error: "Not authenticated" };
      const s = sessions.get(token);
      if (!s) return { ok: false, error: "Session expired" };
      if (!s.permissions["staff.manage"])
        return { ok: false, error: "Permission denied" };

      const db = await getMobileDb();
      const role = (
        await db.query(`SELECT is_system FROM roles WHERE id = ?`, [roleId])
      ).values?.[0];
      if (!role) return { ok: false, error: "Role not found" };
      if (role.is_system)
        return { ok: false, error: "System roles cannot be deleted" };

      await db.run(
        `UPDATE staff SET role_id = NULL, version = version + 1, updated_at = datetime('now') WHERE role_id = ?`,
        [roleId],
      );
      await db.run(
        `UPDATE roles SET _deleted = 1, version = version + 1, updated_at = datetime('now') WHERE id = ?`,
        [roleId],
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  // ── getStaffWithRoles ────────────────────────────────────────────────────
  const getStaffWithRoles = async (token, search = "") => {
    try {
      if (!token) return { ok: false, error: "Not authenticated" };
      const s = sessions.get(token);
      if (!s) return { ok: false, error: "Session expired" };
      if (!s.permissions["staff.manage"])
        return { ok: false, error: "Permission denied" };

      const db = await getMobileDb();
      const like = `%${search}%`;
      const data =
        (
          await db.query(
            `SELECT s.id, s.full_name, s.username, s.role, s.role_id,
                  r.name as role_name, s.phone, s.email,
                  s.is_active, s.last_login, s.created_at
           FROM staff s
           LEFT JOIN roles r ON s.role_id = r.id
           WHERE s._deleted = 0
             AND (s.full_name LIKE ? OR s.username LIKE ?)
           ORDER BY s.full_name`,
            [like, like],
          )
        ).values ?? [];

      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  // ── saveStaff ────────────────────────────────────────────────────────────
  const saveStaff = async (token, s) => {
    try {
      if (!token) return { ok: false, error: "Not authenticated" };
      const sess = sessions.get(token);
      if (!sess) return { ok: false, error: "Session expired" };
      if (!sess.permissions["staff.manage"])
        return { ok: false, error: "Permission denied" };

      const db = await getMobileDb();
      const roleName = s.role_id
        ? (await db.query(`SELECT name FROM roles WHERE id = ?`, [s.role_id]))
            .values?.[0]?.name ?? null
        : null;

      if (s.id) {
        if (s.password?.trim()) {
          const hashed = await hashPassword(s.password.trim());
          await db.run(
            `UPDATE staff
             SET full_name = ?, username = ?, password = ?, role_id = ?, role = ?,
                 phone = ?, email = ?, is_active = ?,
                 version = version + 1, updated_at = datetime('now')
             WHERE id = ?`,
            [
              s.full_name,
              s.username?.toLowerCase().trim(),
              hashed,
              s.role_id ?? null,
              roleName,
              s.phone ?? null,
              s.email ?? null,
              s.is_active ? 1 : 0,
              s.id,
            ],
          );
        } else {
          await db.run(
            `UPDATE staff
             SET full_name = ?, username = ?, role_id = ?, role = ?,
                 phone = ?, email = ?, is_active = ?,
                 version = version + 1, updated_at = datetime('now')
             WHERE id = ?`,
            [
              s.full_name,
              s.username?.toLowerCase().trim(),
              s.role_id ?? null,
              roleName,
              s.phone ?? null,
              s.email ?? null,
              s.is_active ? 1 : 0,
              s.id,
            ],
          );
        }
        return { ok: true, id: s.id };
      } else {
        if (!s.password?.trim())
          return { ok: false, error: "Password is required for new staff" };

        const id = generateUuid();
        const hashed = await hashPassword(s.password.trim());
        await db.run(
          `INSERT INTO staff (id, full_name, username, password, role_id, role, phone, email, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            s.full_name,
            s.username?.toLowerCase().trim(),
            hashed,
            s.role_id ?? null,
            roleName,
            s.phone ?? null,
            s.email ?? null,
            s.is_active !== false ? 1 : 0,
          ],
        );
        return { ok: true, id };
      }
    } catch (err) {
      if (err.message?.includes("UNIQUE"))
        return { ok: false, error: "Username already exists" };
      return { ok: false, error: err.message };
    }
  };

  // ── deleteStaff ──────────────────────────────────────────────────────────
  const deleteStaff = async (token, staffId) => {
    try {
      if (!token) return { ok: false, error: "Not authenticated" };
      const s = sessions.get(token);
      if (!s) return { ok: false, error: "Session expired" };
      if (!s.permissions["staff.manage"])
        return { ok: false, error: "Permission denied" };
      if (s.id === staffId)
        return { ok: false, error: "You cannot delete your own account" };

      const db = await getMobileDb();
      await db.run(
        `UPDATE staff SET _deleted = 1, is_active = 0, version = version + 1, updated_at = datetime('now') WHERE id = ?`,
        [staffId],
      );

      // Invalidate any live session for this staff member
      for (const [tok, sess] of sessions.entries()) {
        if (sess.id === staffId) sessions.delete(tok);
      }

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  return {
    login,
    loginWithFingerprint,
    restoreSession,
    logout,
    getSession,
    checkPermission,
    changePassword,
    resetPassword,
    getRoles,
    saveRole,
    deleteRole,
    getStaffWithRoles,
    saveStaff,
    deleteStaff,
  };
};
