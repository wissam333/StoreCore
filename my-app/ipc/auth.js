// store-app/electron/ipc/auth.js
// Auth IPC handlers — login, logout, session, permissions, password change.
// Call registerAuthHandlers(db, ipcMain) from main.js after DB is ready.
//
// Security model:
//   - Passwords stored as  sha256(salt + ":" + password)  with the salt prepended:
//       stored value = "<salt>:<hash>"
//   - The plain 'admin' seed value is detected on first login and replaced with a
//     proper hash automatically — it never stays plain after that.
//   - Session lives in-memory (Map) on the main process only.
//     It is never written to disk and is cleared when the app closes.
//   - The session token is a random UUID returned to the renderer and kept in
//     a Pinia store (not localStorage).
import { ADMIN_PERMISSIONS } from "../db/schema.js";
import { createHash, randomBytes } from "crypto";

// ── Crypto helpers ─────────────────────────────────────────────────────────

/**
 * Hash a password with a fresh random salt.
 * Returns the stored string:  "<salt>:<sha256hex>"
 */
const hashPassword = (plain) => {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256")
    .update(salt + ":" + plain)
    .digest("hex");
  return `${salt}:${hash}`;
};

/**
 * Verify a plain password against a stored "<salt>:<hash>" string.
 * Also accepts the legacy plain 'admin' seed value (detected when the stored
 * string contains no ':').
 */
const verifyPassword = (plain, stored) => {
  if (!stored) return false;
  // Legacy plain-text seed (only ever 'admin' on a fresh install)
  if (!stored.includes(":")) return plain === stored;
  const [salt, hash] = stored.split(":");
  const attempt = createHash("sha256")
    .update(salt + ":" + plain)
    .digest("hex");
  return attempt === hash;
};

// ── In-memory session store ────────────────────────────────────────────────
// Map<token: string, session: object>
const sessions = new Map();

const createSession = (staffRow, permissions) => {
  const token = randomBytes(32).toString("hex");
  const session = {
    token,
    id: staffRow.id,
    full_name: staffRow.full_name,
    username: staffRow.username,
    role: staffRow.role,
    role_id: staffRow.role_id,
    permissions, // flat object  { "products.view": true, ... }
    created_at: Date.now(),
  };
  sessions.set(token, session);
  return session;
};

// ── Register handlers ──────────────────────────────────────────────────────

export function registerAuthHandlers(db, ipcMain) {
  // ── auth:login ─────────────────────────────────────────────────────────
  // Payload:  { username: string, password: string }
  // Returns:  { ok, token, staff }  |  { ok: false, error }
  ipcMain.handle("auth:login", (_, { username, password }) => {
    try {
      if (!username || !password)
        return { ok: false, error: "Username and password are required" };

      const staff = db
        .prepare(
          `SELECT s.*, r.permissions as role_permissions
           FROM staff s
           LEFT JOIN roles r ON s.role_id = r.id
           WHERE s.username = ? AND s._deleted = 0`,
        )
        .get(username.trim().toLowerCase());

      if (!staff) return { ok: false, error: "Invalid username or password" };

      if (!staff.is_active) return { ok: false, error: "Account is disabled" };

      if (!verifyPassword(password, staff.password))
        return { ok: false, error: "Invalid username or password" };

      // ── Auto-upgrade plain-text seed password on first login ──────────
      if (staff.password && !staff.password.includes(":")) {
        const hashed = hashPassword(password);
        db.prepare(
          `UPDATE staff SET password = ?, updated_at = datetime('now') WHERE id = ?`,
        ).run(hashed, staff.id);
      }

      // ── Update last_login ──────────────────────────────────────────────
      db.prepare(
        `UPDATE staff SET last_login = datetime('now') WHERE id = ?`,
      ).run(staff.id);

      // ── Resolve permissions ────────────────────────────────────────────
      // Administrator role (is_system=1) always gets all permissions true.
      // Other roles use the JSON blob stored on the role.
      let permissions = {};
      if (staff.role_permissions) {
        try {
          permissions = JSON.parse(staff.role_permissions);
        } catch {
          permissions = {};
        }
      }
      const isAdmin =
        staff.role === "admin" ||
        staff.role === "Administrator" ||
        staff.username === "admin";
      const isEmpty = Object.keys(permissions).length === 0;
      if (isAdmin && isEmpty) {
        const adminRole = db
          .prepare(
            `SELECT id FROM roles WHERE name = 'Administrator' AND is_system = 1 LIMIT 1`,
          )
          .get();
        if (adminRole) {
          db.prepare(
            `UPDATE staff SET role_id = ?, role = 'Administrator', updated_at = datetime('now') WHERE id = ?`,
          ).run(adminRole.id, staff.id);
        }
        permissions = ADMIN_PERMISSIONS;
      }

      const session = createSession(staff, permissions);

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
  });

  // ── auth:logout ────────────────────────────────────────────────────────
  // Payload:  { token: string }
  // Returns:  { ok: true }
  ipcMain.handle("auth:logout", (_, { token } = {}) => {
    if (token) sessions.delete(token);
    return { ok: true };
  });

  // ── auth:getSession ────────────────────────────────────────────────────
  // Payload:  { token: string }
  // Returns:  { ok, staff }  |  { ok: false }
  ipcMain.handle("auth:getSession", (_, { token } = {}) => {
    if (!token) return { ok: false };
    const session = sessions.get(token);
    if (!session) return { ok: false };
    return {
      ok: true,
      staff: {
        id: session.id,
        full_name: session.full_name,
        username: session.username,
        role: session.role,
        role_id: session.role_id,
        permissions: session.permissions,
      },
    };
  });

  // ── auth:checkPermission ───────────────────────────────────────────────
  // Payload:  { token: string, permission: string }
  // Returns:  { ok: true, allowed: boolean }
  ipcMain.handle("auth:checkPermission", (_, { token, permission } = {}) => {
    if (!token) return { ok: true, allowed: false };
    const session = sessions.get(token);
    if (!session) return { ok: true, allowed: false };
    return {
      ok: true,
      allowed: session.permissions[permission] === true,
    };
  });

  // ── auth:changePassword ────────────────────────────────────────────────
  // Payload:  { token: string, currentPassword: string, newPassword: string }
  // Returns:  { ok: true }  |  { ok: false, error }
  ipcMain.handle(
    "auth:changePassword",
    (_, { token, currentPassword, newPassword } = {}) => {
      try {
        if (!token) return { ok: false, error: "Not authenticated" };
        const session = sessions.get(token);
        if (!session) return { ok: false, error: "Session expired" };

        if (!newPassword || newPassword.length < 4)
          return {
            ok: false,
            error: "New password must be at least 4 characters",
          };

        const staff = db
          .prepare(`SELECT * FROM staff WHERE id = ? AND _deleted = 0`)
          .get(session.id);
        if (!staff) return { ok: false, error: "Staff not found" };

        if (!verifyPassword(currentPassword, staff.password))
          return { ok: false, error: "Current password is incorrect" };

        const hashed = hashPassword(newPassword);
        db.prepare(
          `UPDATE staff SET password = ?, version = version + 1, updated_at = datetime('now') WHERE id = ?`,
        ).run(hashed, session.id);

        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  );

  // ── auth:resetPassword (admin only) ───────────────────────────────────
  // Allows an admin to set any staff member's password without knowing it.
  // Payload:  { token: string, staffId: string, newPassword: string }
  // Returns:  { ok: true }  |  { ok: false, error }
  ipcMain.handle(
    "auth:resetPassword",
    (_, { token, staffId, newPassword } = {}) => {
      try {
        if (!token) return { ok: false, error: "Not authenticated" };
        const session = sessions.get(token);
        if (!session) return { ok: false, error: "Session expired" };

        if (!session.permissions["staff.manage"])
          return { ok: false, error: "Permission denied" };

        if (!newPassword || newPassword.length < 4)
          return {
            ok: false,
            error: "Password must be at least 4 characters",
          };

        const target = db
          .prepare(`SELECT id FROM staff WHERE id = ? AND _deleted = 0`)
          .get(staffId);
        if (!target) return { ok: false, error: "Staff not found" };

        const hashed = hashPassword(newPassword);
        db.prepare(
          `UPDATE staff SET password = ?, version = version + 1, updated_at = datetime('now') WHERE id = ?`,
        ).run(hashed, staffId);

        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  );

  // ── auth:getRoles ──────────────────────────────────────────────────────
  // Returns all non-deleted roles (for the role picker in staff forms).
  // Payload:  { token: string }
  // Returns:  { ok, data: Role[] }
  ipcMain.handle("auth:getRoles", (_, { token } = {}) => {
    try {
      if (!token) return { ok: false, error: "Not authenticated" };
      const session = sessions.get(token);
      if (!session) return { ok: false, error: "Session expired" };

      const roles = db
        .prepare(
          `SELECT id, name, permissions, is_system FROM roles WHERE _deleted = 0 ORDER BY name`,
        )
        .all()
        .map((r) => ({
          ...r,
          permissions: (() => {
            try {
              return JSON.parse(r.permissions);
            } catch {
              return {};
            }
          })(),
        }));

      return { ok: true, data: roles };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── auth:saveRole ──────────────────────────────────────────────────────
  // Create or update a role. Only staff with staff.manage can do this.
  // Payload:  { token, role: { id?, name, permissions } }
  // Returns:  { ok, id }
  ipcMain.handle("auth:saveRole", (_, { token, role } = {}) => {
    try {
      if (!token) return { ok: false, error: "Not authenticated" };
      const session = sessions.get(token);
      if (!session) return { ok: false, error: "Session expired" };
      if (!session.permissions["staff.manage"])
        return { ok: false, error: "Permission denied" };

      const permJson = JSON.stringify(role.permissions ?? {});
      const uuid = () => crypto.randomUUID();

      if (role.id) {
        // Cannot rename or edit a system role's permissions
        const existing = db
          .prepare(`SELECT is_system FROM roles WHERE id = ?`)
          .get(role.id);
        if (existing?.is_system)
          return { ok: false, error: "System roles cannot be edited" };

        db.prepare(
          `UPDATE roles SET name = ?, permissions = ?, version = version + 1, updated_at = datetime('now') WHERE id = ?`,
        ).run(role.name, permJson, role.id);
        return { ok: true, id: role.id };
      } else {
        const id = uuid();
        db.prepare(
          `INSERT INTO roles (id, name, permissions, is_system) VALUES (?, ?, ?, 0)`,
        ).run(id, role.name, permJson);
        return { ok: true, id };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── auth:deleteRole ────────────────────────────────────────────────────
  // Payload:  { token, roleId }
  // Returns:  { ok }
  ipcMain.handle("auth:deleteRole", (_, { token, roleId } = {}) => {
    try {
      if (!token) return { ok: false, error: "Not authenticated" };
      const session = sessions.get(token);
      if (!session) return { ok: false, error: "Session expired" };
      if (!session.permissions["staff.manage"])
        return { ok: false, error: "Permission denied" };

      const role = db
        .prepare(`SELECT is_system FROM roles WHERE id = ?`)
        .get(roleId);
      if (!role) return { ok: false, error: "Role not found" };
      if (role.is_system)
        return { ok: false, error: "System roles cannot be deleted" };

      // Unassign staff members from this role before deleting
      db.prepare(
        `UPDATE staff SET role_id = NULL, version = version + 1, updated_at = datetime('now') WHERE role_id = ?`,
      ).run(roleId);

      db.prepare(
        `UPDATE roles SET _deleted = 1, version = version + 1, updated_at = datetime('now') WHERE id = ?`,
      ).run(roleId);

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── auth:getStaffWithRoles ─────────────────────────────────────────────
  // Full staff list including role name — used by the staff management page.
  // Payload:  { token, search? }
  // Returns:  { ok, data: StaffRow[] }
  ipcMain.handle("auth:getStaffWithRoles", (_, { token, search = "" } = {}) => {
    try {
      if (!token) return { ok: false, error: "Not authenticated" };
      const session = sessions.get(token);
      if (!session) return { ok: false, error: "Session expired" };
      if (!session.permissions["staff.manage"])
        return { ok: false, error: "Permission denied" };

      const like = `%${search}%`;
      const data = db
        .prepare(
          `SELECT s.id, s.full_name, s.username, s.role, s.role_id,
                    r.name as role_name, s.phone, s.email,
                    s.is_active, s.last_login, s.created_at
             FROM staff s
             LEFT JOIN roles r ON s.role_id = r.id
             WHERE s._deleted = 0
               AND (s.full_name LIKE ? OR s.username LIKE ?)
             ORDER BY s.full_name`,
        )
        .all(like, like);

      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── auth:saveStaff ─────────────────────────────────────────────────────
  // Create or update a staff member. Only staff.manage can do this.
  // Payload: { token, staff: { id?, full_name, username, password?, role_id, phone, email, is_active } }
  // Returns: { ok, id }
  ipcMain.handle("auth:saveStaff", (_, { token, staff: s } = {}) => {
    try {
      if (!token) return { ok: false, error: "Not authenticated" };
      const session = sessions.get(token);
      if (!session) return { ok: false, error: "Session expired" };
      if (!session.permissions["staff.manage"])
        return { ok: false, error: "Permission denied" };

      const uuid = () => crypto.randomUUID();

      // Resolve role label from role_id for the plain-text role column
      const roleName = s.role_id
        ? (db.prepare(`SELECT name FROM roles WHERE id = ?`).get(s.role_id)
            ?.name ?? null)
        : null;

      if (s.id) {
        // Editing existing staff
        if (s.password && s.password.trim()) {
          // New password supplied — hash it
          const hashed = hashPassword(s.password.trim());
          db.prepare(
            `UPDATE staff
             SET full_name = ?, username = ?, password = ?, role_id = ?, role = ?,
                 phone = ?, email = ?, is_active = ?,
                 version = version + 1, updated_at = datetime('now')
             WHERE id = ?`,
          ).run(
            s.full_name,
            s.username?.toLowerCase().trim(),
            hashed,
            s.role_id ?? null,
            roleName,
            s.phone ?? null,
            s.email ?? null,
            s.is_active ? 1 : 0,
            s.id,
          );
        } else {
          db.prepare(
            `UPDATE staff
             SET full_name = ?, username = ?, role_id = ?, role = ?,
                 phone = ?, email = ?, is_active = ?,
                 version = version + 1, updated_at = datetime('now')
             WHERE id = ?`,
          ).run(
            s.full_name,
            s.username?.toLowerCase().trim(),
            s.role_id ?? null,
            roleName,
            s.phone ?? null,
            s.email ?? null,
            s.is_active ? 1 : 0,
            s.id,
          );
        }
        return { ok: true, id: s.id };
      } else {
        // Creating new staff — password required
        if (!s.password || !s.password.trim())
          return { ok: false, error: "Password is required for new staff" };

        const id = uuid();
        const hashed = hashPassword(s.password.trim());
        db.prepare(
          `INSERT INTO staff (id, full_name, username, password, role_id, role, phone, email, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          s.full_name,
          s.username?.toLowerCase().trim(),
          hashed,
          s.role_id ?? null,
          roleName,
          s.phone ?? null,
          s.email ?? null,
          s.is_active !== false ? 1 : 0,
        );
        return { ok: true, id };
      }
    } catch (err) {
      // Unique constraint on username
      if (err.message?.includes("UNIQUE"))
        return { ok: false, error: "Username already exists" };
      return { ok: false, error: err.message };
    }
  });

  // ── auth:deleteStaff ───────────────────────────────────────────────────
  // Soft-delete a staff member. Cannot delete yourself.
  // Payload:  { token, staffId }
  ipcMain.handle("auth:deleteStaff", (_, { token, staffId } = {}) => {
    try {
      if (!token) return { ok: false, error: "Not authenticated" };
      const session = sessions.get(token);
      if (!session) return { ok: false, error: "Session expired" };
      if (!session.permissions["staff.manage"])
        return { ok: false, error: "Permission denied" };
      if (session.id === staffId)
        return { ok: false, error: "You cannot delete your own account" };

      db.prepare(
        `UPDATE staff SET _deleted = 1, is_active = 0, version = version + 1, updated_at = datetime('now') WHERE id = ?`,
      ).run(staffId);

      // Invalidate any live session for this staff member
      for (const [tok, sess] of sessions.entries()) {
        if (sess.id === staffId) sessions.delete(tok);
      }

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}
