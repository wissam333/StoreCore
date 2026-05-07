<!-- store-app/pages/dashboard/staff/roles.vue -->
<template>
  <div>
    <SharedUiHeaderPage
      :title="$t('staff.manageRoles')"
      :subtitle="$t('staff.rolesSubtitle')"
      icon="mdi:shield-account-outline"
      :is-rtl="locale === 'ar'"
      show-back
      :actions="[
        {
          label: $t('staff.newRole'),
          icon: 'mdi:shield-plus-outline',
          variant: 'primary',
        },
      ]"
      @back="navigateTo('/dashboard/staff')"
      @action-click="openNewRole"
    />

    <div class="roles-layout">
      <!-- Role list sidebar -->
      <div class="roles-sidebar">
        <div v-if="loadingRoles" class="roles-sidebar__loading">
          <span class="spinner" />
        </div>

        <template v-else>
          <div
            v-for="role in roles"
            :key="role.id"
            class="role-item"
            :class="{ 'role-item--active': activeRoleId === role.id }"
            @click="selectRole(role)"
          >
            <div
              class="role-item__icon"
              :class="role.is_system ? 'role-item__icon--system' : ''"
            >
              <Icon
                :name="
                  role.is_system
                    ? 'mdi:shield-star-outline'
                    : 'mdi:shield-outline'
                "
                size="20"
              />
            </div>
            <div class="role-item__body">
              <span class="role-item__name">{{ role.name }}</span>
              <span class="role-item__count">
                {{ permCount(role) }} {{ $t("staff.permissionsEnabled") }}
              </span>
            </div>
            <Icon
              v-if="activeRoleId === role.id"
              name="mdi:chevron-right"
              size="18"
              class="role-item__arrow"
            />
          </div>

          <button class="role-add-btn" @click="openNewRole">
            <Icon name="mdi:plus" size="16" />
            {{ $t("staff.newRole") }}
          </button>
        </template>
      </div>

      <!-- Role editor panel -->
      <div class="role-editor glass-card">
        <!-- Empty state -->
        <div v-if="!editingRole" class="role-editor__empty">
          <Icon
            name="mdi:shield-account-outline"
            size="48"
            class="role-editor__empty-icon"
          />
          <p>{{ $t("staff.selectOrCreateRole") }}</p>
        </div>

        <template v-else>
          <!-- Role header -->
          <div class="role-editor__header">
            <div
              class="role-name-field"
              :class="{ 'role-name-field--error': nameError }"
            >
              <input
                v-model="editingRole.name"
                class="role-name-input"
                :placeholder="$t('staff.roleNamePlaceholder')"
                :disabled="!!editingRole.is_system"
                @input="nameError = ''"
              />
              <span v-if="editingRole.is_system" class="system-badge">
                <Icon name="mdi:lock-outline" size="12" />
                {{ $t("staff.systemRole") }}
              </span>
            </div>

            <div class="role-editor__header-actions">
              <button
                v-if="!editingRole.is_system && editingRole.id"
                class="role-action-btn role-action-btn--danger"
                :title="$t('delete')"
                @click="confirmDeleteRole"
              >
                <Icon name="mdi:trash-can-outline" size="16" />
              </button>
              <SharedUiButtonBase
                variant="primary"
                :loading="saving"
                :disabled="!!editingRole.is_system"
                icon-left="mdi:content-save-outline"
                size="sm"
                @click="saveRole"
              >
                {{ $t("save") }}
              </SharedUiButtonBase>
            </div>
          </div>

          <p v-if="nameError" class="name-error">{{ nameError }}</p>

          <!-- Module toggle: all on/off -->
          <div class="editor-toolbar">
            <span class="editor-toolbar__label">{{
              $t("staff.permissions")
            }}</span>
            <button
              class="toolbar-btn"
              :disabled="!!editingRole.is_system"
              @click="setAll(true)"
            >
              <Icon name="mdi:check-all" size="14" />
              {{ $t("staff.allowAll") }}
            </button>
            <button
              class="toolbar-btn toolbar-btn--danger"
              :disabled="!!editingRole.is_system"
              @click="setAll(false)"
            >
              <Icon name="mdi:close-circle-outline" size="14" />
              {{ $t("staff.denyAll") }}
            </button>
          </div>

          <!-- Permissions by module -->
          <div class="perm-modules">
            <div
              v-for="(actions, module) in PERMISSION_MODULES"
              :key="module"
              class="perm-module-card"
            >
              <div class="perm-module-card__header">
                <Icon
                  :name="MODULE_ICONS[module] || 'mdi:puzzle-outline'"
                  size="16"
                />
                <span class="perm-module-card__name">{{
                  $t(`permModules.${module}`) || module
                }}</span>
                <!-- Module-level toggle -->
                <button
                  class="module-toggle"
                  :class="{
                    'module-toggle--on': isModuleFullyOn(module, actions),
                  }"
                  :disabled="!!editingRole.is_system"
                  :title="$t('staff.toggleModule')"
                  @click="toggleModule(module, actions)"
                >
                  {{
                    isModuleFullyOn(module, actions)
                      ? $t("staff.on")
                      : $t("staff.off")
                  }}
                </button>
              </div>

              <div class="perm-rows">
                <label
                  v-for="action in actions"
                  :key="`${module}.${action}`"
                  class="perm-row"
                  :class="{ 'perm-row--disabled': !!editingRole.is_system }"
                >
                  <div class="perm-row__info">
                    <span class="perm-row__key">{{
                      `${module}.${action}`
                    }}</span>
                    <span class="perm-row__desc">{{
                      $t(`permDesc.${module}.${action}`) || ""
                    }}</span>
                  </div>
                  <button
                    type="button"
                    class="perm-toggle"
                    :class="{
                      'perm-toggle--on':
                        editingRole.permissions[`${module}.${action}`],
                    }"
                    :disabled="!!editingRole.is_system"
                    role="switch"
                    :aria-checked="
                      editingRole.permissions[`${module}.${action}`]
                    "
                    @click="togglePerm(module, action)"
                  >
                    <span class="perm-toggle__knob" />
                  </button>
                </label>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Delete role confirm modal -->
    <SharedUiDialogAppModal
      v-model="showDeleteModal"
      :title="$t('staff.deleteRoleTitle')"
      max-width="420px"
    >
      <p>{{ $t("staff.deleteRoleConfirm", { name: editingRole?.name }) }}</p>
      <p class="modal-warning">
        <Icon name="mdi:alert-outline" size="14" />
        {{ $t("staff.deleteRoleWarning") }}
      </p>
      <template #actions>
        <div class="d-flex gap-2 justify-content-end">
          <SharedUiButtonBase
            variant="outline"
            @click="showDeleteModal = false"
          >
            {{ $t("cancel") }}
          </SharedUiButtonBase>
          <SharedUiButtonBase
            variant="error"
            :loading="deleting"
            icon-left="mdi:trash-can-outline"
            @click="doDeleteRole"
          >
            {{ $t("delete") }}
          </SharedUiButtonBase>
        </div>
      </template>
    </SharedUiDialogAppModal>
  </div>
</template>

<script setup>
definePageMeta({
  searchMeta: {
    label: "Manage Roles",
    labelAr: "إدارة الأدوار",
    icon: "mdi:shield-account-outline",
    group: "Settings",
  },
});

const { locale, t } = useI18n();
const { $toast } = useNuxtApp();
const {
  getRoles,
  saveRole: saveRoleApi,
  deleteRole: deleteRoleApi,
  can,
} = useAuth();

// Guard
onMounted(() => {
  if (!can("staff.manage").value) navigateTo("/dashboard");
});

// ── Permission structure (single source of truth for the UI) ───────────────
const PERMISSION_MODULES = {
  products: ["view", "add", "edit", "delete"],
  orders: ["view", "add", "edit", "delete"],
  customers: ["view", "add", "edit", "delete"],
  dues: ["view", "add", "edit", "delete"],
  reports: ["view"],
  settings: ["view", "edit"],
  staff: ["view", "manage"],
};

const MODULE_ICONS = {
  products: "mdi:package-variant-outline",
  orders: "mdi:receipt-text-outline",
  customers: "mdi:account-group-outline",
  dues: "mdi:cash-clock",
  reports: "mdi:chart-bar-outline",
  settings: "mdi:cog-outline",
  staff: "mdi:account-multiple-outline",
};

const buildEmptyPermissions = (defaultVal = false) => {
  const out = {};
  for (const [mod, actions] of Object.entries(PERMISSION_MODULES)) {
    for (const a of actions) {
      out[`${mod}.${a}`] = defaultVal;
    }
  }
  return out;
};

// ── State ──────────────────────────────────────────────────────────────────
const roles = ref([]);
const loadingRoles = ref(false);
const activeRoleId = ref(null);
const editingRole = ref(null); // { id?, name, permissions, is_system }
const nameError = ref("");
const saving = ref(false);
const deleting = ref(false);
const showDeleteModal = ref(false);

// ── Load ───────────────────────────────────────────────────────────────────
const load = async () => {
  loadingRoles.value = true;
  try {
    const res = await getRoles();
    if (res.ok) roles.value = res.data;
    else $toast.error(res.error);
  } finally {
    loadingRoles.value = false;
  }
};

onMounted(load);

// ── Select role ────────────────────────────────────────────────────────────
const selectRole = (role) => {
  activeRoleId.value = role.id;
  editingRole.value = {
    id: role.id,
    name: role.name,
    is_system: role.is_system,
    permissions: {
      ...buildEmptyPermissions(false),
      ...(role.permissions ?? {}),
    },
  };
  nameError.value = "";
};

// ── New role ───────────────────────────────────────────────────────────────
const openNewRole = () => {
  activeRoleId.value = null;
  editingRole.value = {
    id: null,
    name: "",
    is_system: 0,
    permissions: buildEmptyPermissions(false),
  };
  nameError.value = "";
};

// ── Permission helpers ─────────────────────────────────────────────────────
const togglePerm = (module, action) => {
  if (editingRole.value?.is_system) return;
  const key = `${module}.${action}`;
  editingRole.value.permissions[key] = !editingRole.value.permissions[key];
};

const isModuleFullyOn = (module, actions) => {
  if (!editingRole.value) return false;
  return actions.every((a) => editingRole.value.permissions[`${module}.${a}`]);
};

const toggleModule = (module, actions) => {
  if (editingRole.value?.is_system) return;
  const allOn = isModuleFullyOn(module, actions);
  for (const a of actions) {
    editingRole.value.permissions[`${module}.${a}`] = !allOn;
  }
};

const setAll = (value) => {
  if (!editingRole.value || editingRole.value.is_system) return;
  for (const key of Object.keys(editingRole.value.permissions)) {
    editingRole.value.permissions[key] = value;
  }
};

// ── Perm count for sidebar ─────────────────────────────────────────────────
const permCount = (role) => {
  const perms = role.permissions ?? {};
  return Object.values(perms).filter(Boolean).length;
};

// ── Save ───────────────────────────────────────────────────────────────────
const saveRole = async () => {
  if (!editingRole.value) return;
  if (!editingRole.value.name.trim()) {
    nameError.value = t("staff.errors.roleNameRequired");
    return;
  }

  saving.value = true;
  try {
    const raw = toRaw(editingRole.value);
    const res = await saveRoleApi({
      id: raw.id ?? undefined,
      name: raw.name.trim(),
      permissions: { ...toRaw(raw.permissions) },
    });

    if (res.ok) {
      $toast.success(t("staff.roleSaved"));
      await load();
      const saved = roles.value.find(
        (r) => r.id === (res.id ?? editingRole.value?.id),
      );
      if (saved) selectRole(saved);
    } else {
      $toast.error(res.error);
    }
  } finally {
    saving.value = false;
  }
};

// ── Delete ─────────────────────────────────────────────────────────────────
const confirmDeleteRole = () => {
  showDeleteModal.value = true;
};

const doDeleteRole = async () => {
  if (!editingRole.value?.id) return;
  deleting.value = true;
  try {
    const res = await deleteRoleApi(editingRole.value.id);
    if (res.ok) {
      $toast.success(t("deleted"));
      showDeleteModal.value = false;
      editingRole.value = null;
      activeRoleId.value = null;
      await load();
    } else {
      $toast.error(res.error);
    }
  } finally {
    deleting.value = false;
  }
};
</script>

<style lang="scss" scoped>
.roles-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 1.25rem;
  align-items: start;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
}

/* Sidebar */
.roles-sidebar {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 0.625rem;
  display: flex;
  flex-direction: column;
  gap: 2px;

  &__loading {
    display: flex;
    justify-content: center;
    padding: 2rem 0;
  }
}

.role-item {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.625rem 0.75rem;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;

  &:hover {
    background: var(--bg-elevated);
  }

  &--active {
    background: var(--primary-soft);
    .role-item__name {
      color: var(--primary);
    }
    .role-item__icon {
      color: var(--primary);
      background: rgba(234, 28, 36, 0.1);
    }
  }

  &__icon {
    width: 34px;
    height: 34px;
    border-radius: 9px;
    background: var(--bg-elevated);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-sub);
    flex-shrink: 0;
    transition: all 0.15s;

    &--system {
      background: rgba(234, 28, 36, 0.08);
      color: var(--primary);
    }
  }

  &__body {
    flex: 1;
    min-width: 0;
  }

  &__name {
    display: block;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__count {
    display: block;
    font-size: 0.72rem;
    color: var(--text-muted);
    margin-top: 1px;
  }

  &__arrow {
    color: var(--primary);
    flex-shrink: 0;
  }
}

.role-add-btn {
  margin-top: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  background: none;
  border: 1.5px dashed var(--border-color);
  border-radius: 10px;
  padding: 0.625rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: var(--primary);
    color: var(--primary);
    background: var(--primary-soft);
  }
}

/* Editor panel */
.role-editor {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 1.5rem;
  min-height: 480px;

  &__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 360px;
    gap: 0.75rem;
    color: var(--text-muted);
    font-size: 0.875rem;
    text-align: center;
  }

  &__empty-icon {
    opacity: 0.25;
  }

  &__header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border-color);
    flex-wrap: wrap;
  }

  &__header-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-inline-start: auto;
  }
}

/* Role name field */
.role-name-field {
  flex: 1;
  min-width: 180px;

  &--error .role-name-input {
    border-color: #ef4444 !important;
  }
}

.role-name-input {
  width: 100%;
  background: var(--bg-elevated);
  border: 1.5px solid var(--border-color);
  border-radius: 10px;
  color: var(--text-primary);
  font-size: 1rem;
  font-weight: 700;
  font-family: inherit;
  padding: 0.5rem 0.75rem;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;

  &:focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 3px var(--primary-soft);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  &::placeholder {
    color: var(--text-muted);
    font-weight: 400;
  }
}

.system-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--primary);
  background: rgba(234, 28, 36, 0.08);
  border-radius: 20px;
  padding: 2px 8px;
  margin-top: 4px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.name-error {
  font-size: 0.75rem;
  color: #ef4444;
  margin: -0.75rem 0 0.5rem;
}

.role-action-btn {
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 9px;
  background: var(--bg-elevated);
  color: var(--text-sub);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s;

  &--danger:hover {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
  }
}

/* Toolbar */
.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;

  &__label {
    font-size: 0.775rem;
    font-weight: 700;
    color: var(--text-sub);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-inline-end: auto;
  }
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  font-family: inherit;
  padding: 4px 10px;
  border-radius: 8px;
  border: 1.5px solid var(--border-color);
  background: transparent;
  color: var(--text-sub);
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: #10b981;
    color: #10b981;
    background: rgba(16, 185, 129, 0.06);
  }

  &--danger:hover {
    border-color: #ef4444;
    color: #ef4444;
    background: rgba(239, 68, 68, 0.06);
  }

  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
}

/* Permission modules */
.perm-modules {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.perm-module-card {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  overflow: hidden;

  &__header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 0.875rem;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border-color);

    .icon {
      color: var(--primary);
    }
  }

  &__name {
    flex: 1;
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--text-primary);
    text-transform: capitalize;
  }
}

.module-toggle {
  font-size: 0.7rem;
  font-weight: 700;
  font-family: inherit;
  padding: 2px 10px;
  border-radius: 20px;
  border: 1.5px solid var(--border-color);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
  text-transform: uppercase;
  letter-spacing: 0.04em;

  &--on {
    border-color: #10b981;
    color: #10b981;
    background: rgba(16, 185, 129, 0.08);
  }

  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
}

.perm-rows {
  display: flex;
  flex-direction: column;
}

.perm-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.625rem 0.875rem;
  cursor: pointer;
  transition: background 0.12s;
  border-bottom: 1px solid var(--border-color);

  &:last-child {
    border-bottom: none;
  }

  &:hover:not(&--disabled) {
    background: var(--bg-elevated);
  }

  &--disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  &__info {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  &__key {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-primary);
    font-family: "JetBrains Mono", "Fira Code", monospace;
  }

  &__desc {
    font-size: 0.72rem;
    color: var(--text-muted);
  }
}

/* ── Permission toggle ── */
.perm-toggle {
  width: 40px;
  height: 22px;
  border-radius: 999px;
  background: var(--bg-elevated);
  border: 1.5px solid var(--border-color);
  cursor: pointer;
  position: relative;
  transition: background 0.18s, border-color 0.18s;
  flex-shrink: 0;

  &--on {
    background: #10b981;
    border-color: #10b981;
  }

  &:disabled {
    cursor: not-allowed;
  }

  /* Knob — LTR: slides right when on, RTL: slides left when on */
  &__knob {
    position: absolute;
    top: 2px;
    /* LTR default: start at left edge */
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: white;
    transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);

    /* RTL: mirror the knob to start from right edge */
    [dir="rtl"] & {
      left: auto;
      right: 2px;
    }
  }

  /* LTR: slide right */
  &--on &__knob {
    transform: translateX(18px);
  }

  /* RTL: slide left (negative) */
  [dir="rtl"] &--on &__knob {
    transform: translateX(-18px);
  }
}

/* Spinner */
.spinner {
  display: inline-block;
  width: 22px;
  height: 22px;
  border: 2.5px solid var(--border-color);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Modal helpers */
.modal-warning {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: #f59e0b;
  margin-top: 0.5rem;
}

.d-flex {
  display: flex;
}
.gap-2 {
  gap: 8px;
}
.justify-content-end {
  justify-content: flex-end;
}
</style>
