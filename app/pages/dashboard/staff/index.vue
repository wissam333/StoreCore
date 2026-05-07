<!-- store-app/pages/dashboard/staff/index.vue -->
<template>
  <div>
    <SharedUiHeaderPage
      :title="$t('sidebar.staff')"
      :subtitle="$t('staffSubtitle')"
      icon="mdi:account-group-outline"
      :is-rtl="locale === 'ar'"
      :actions="[
        {
          label: $t('staff.manageRoles'),
          icon: 'mdi:shield-account-outline',
          variant: 'outline',
        },
        {
          label: $t('staff.addStaff'),
          icon: 'mdi:account-plus-outline',
          variant: 'primary',
        },
      ]"
      @action-click="onHeaderAction"
    />

    <div class="filters-row">
      <SharedUiFormBaseInput
        v-model="search"
        :placeholder="$t('staff.searchPlaceholder')"
        icon-left="mdi:magnify"
        clearable
        class="search-input"
      />
    </div>

    <SharedUiTableDataTable
      :columns="cols"
      :data="staffList"
      :loading="loading"
      empty-icon="mdi:account-group-outline"
      empty-text="staff.empty"
      row-clickable
      @row-click="(r) => navigateTo(`/dashboard/staff/${r.id}`)"
    >
      <!-- Full name + username -->
      <template #cell-full_name="{ row }">
        <div class="staff-name-cell">
          <div class="staff-avatar" :data-initials="initials(row.full_name)">
            {{ initials(row.full_name) }}
          </div>
          <div>
            <div class="staff-name">{{ row.full_name }}</div>
            <div class="staff-username">@{{ row.username }}</div>
          </div>
        </div>
      </template>

      <!-- Role badge -->
      <template #cell-role_name="{ row }">
        <span class="role-badge" :class="roleBadgeClass(row.role_name)">
          <Icon name="mdi:shield-outline" size="12" />
          {{ row.role_name ?? $t("staff.noRole") }}
        </span>
      </template>

      <!-- Active status -->
      <template #cell-is_active="{ row }">
        <span
          class="status-badge"
          :class="
            row.is_active ? 'status-badge--active' : 'status-badge--inactive'
          "
        >
          <span class="status-badge__dot" />
          {{ row.is_active ? $t("staff.active") : $t("staff.inactive") }}
        </span>
      </template>

      <!-- Last login -->
      <template #cell-last_login="{ row }">
        <span class="text-muted-sm">
          {{
            row.last_login ? new Date(row.last_login).toLocaleDateString() : "—"
          }}
        </span>
      </template>

      <!-- Row actions -->
      <template #actions="{ row }">
        <div class="action-buttons">
          <button
            class="action-btn"
            :title="
              row.is_active ? $t('staff.deactivate') : $t('staff.activate')
            "
            :disabled="row.id === currentStaff?.id"
            @click.stop="toggleActive(row)"
          >
            <Icon
              :name="
                row.is_active
                  ? 'mdi:account-off-outline'
                  : 'mdi:account-check-outline'
              "
            />
          </button>
          <button
            class="action-btn"
            :title="$t('common.edit')"
            @click.stop="navigateTo(`/dashboard/staff/${row.id}`)"
          >
            <Icon name="mdi:pencil-outline" />
          </button>
          <button
            class="action-btn danger"
            :title="$t('common.delete')"
            :disabled="row.id === currentStaff?.id"
            @click.stop="confirmDelete(row)"
          >
            <Icon name="mdi:trash-can-outline" />
          </button>
        </div>
      </template>
    </SharedUiTableDataTable>

    <!-- Delete modal -->
    <SharedUiDialogAppModal
      v-model="showDeleteModal"
      :title="$t('staff.deleteTitle')"
      max-width="420px"
    >
      <p>{{ $t("staff.deleteConfirm", { name: toDelete?.full_name }) }}</p>
      <template #actions>
        <div class="d-flex gap-2 justify-content-end">
          <SharedUiButtonBase
            variant="outline"
            @click="showDeleteModal = false"
          >
            {{ $t("common.cancel") }}
          </SharedUiButtonBase>
          <SharedUiButtonBase
            variant="error"
            :loading="deleting"
            icon-left="mdi:trash-can-outline"
            @click="doDelete"
          >
            {{ $t("common.delete") }}
          </SharedUiButtonBase>
        </div>
      </template>
    </SharedUiDialogAppModal>
  </div>
</template>

<script setup>
definePageMeta({
  searchMeta: {
    label: "Staff",
    labelAr: "الموظفون",
    icon: "mdi:account-group-outline",
    group: "Settings",
  },
});

import { watchDebounced } from "@vueuse/core";

const { locale } = useI18n();
const { $toast } = useNuxtApp();
const { getStaffWithRoles, saveStaff, deleteStaff, session, can } = useAuth();

// Guard
const currentStaff = computed(() => session.value);
onMounted(() => {
  if (!can("staff.manage").value) navigateTo("/dashboard");
});

// ── State ─────────────────────────────────────────────────────────────────
const search = ref("");
const loading = ref(false);
const staffList = ref([]);
const showDeleteModal = ref(false);
const deleting = ref(false);
const toDelete = ref(null);

const cols = [
  { key: "full_name", label: "staff.name" },
  { key: "role_name", label: "staff.role" },
  { key: "is_active", label: "staff.status" },
  { key: "last_login", label: "staff.lastLogin" },
];

// ── Load ──────────────────────────────────────────────────────────────────
const load = async () => {
  loading.value = true;
  try {
    const res = await getStaffWithRoles(search.value);
    if (res.ok) staffList.value = res.data;
    else $toast.error(res.error);
  } finally {
    loading.value = false;
  }
};

watchDebounced(search, () => load(), { debounce: 300 });
onMounted(load);

// ── Header action dispatcher ───────────────────────────────────────────────
const onHeaderAction = (action) => {
  if (action.label === useNuxtApp().$i18n.t("staff.manageRoles")) {
    navigateTo("/dashboard/staff/roles");
  } else {
    navigateTo("/dashboard/staff/new");
  }
};

// ── Toggle active ─────────────────────────────────────────────────────────
const toggleActive = async (member) => {
  const res = await saveStaff({
    ...member,
    is_active: member.is_active ? 0 : 1,
  });
  if (res.ok) {
    $toast.success(
      useNuxtApp().$i18n.t(
        member.is_active ? "staff.deactivated" : "staff.activated",
      ),
    );
    load();
  } else {
    $toast.error(res.error);
  }
};

// ── Delete ────────────────────────────────────────────────────────────────
const confirmDelete = (row) => {
  toDelete.value = row;
  showDeleteModal.value = true;
};

const doDelete = async () => {
  deleting.value = true;
  const res = await deleteStaff(toDelete.value.id);
  if (res.ok) {
    $toast.success(useNuxtApp().$i18n.t("deleted"));
    showDeleteModal.value = false;
    load();
  } else {
    $toast.error(res.error);
  }
  deleting.value = false;
};

// ── Helpers ───────────────────────────────────────────────────────────────
const initials = (name = "") =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

const roleBadgeClass = (role) => {
  const map = {
    Administrator: "role-badge--admin",
    Cashier: "role-badge--cashier",
  };
  return map[role] ?? "role-badge--default";
};
</script>

<style lang="scss" scoped>
.filters-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: flex-end;
  margin-bottom: 1rem;
}
.search-input {
  flex: 1;
  min-width: 200px;
}

/* Staff name cell */
.staff-name-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}
.staff-avatar {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 0.75rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  letter-spacing: 0.03em;
}
.staff-name {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-primary);
}
.staff-username {
  font-size: 0.75rem;
  color: var(--text-muted);
}

/* Role badge */
.role-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 20px;
  font-size: 0.72rem;
  font-weight: 600;
  &--admin {
    background: rgba(234, 28, 36, 0.09);
    color: var(--primary);
  }
  &--cashier {
    background: rgba(6, 182, 212, 0.1);
    color: #06b6d4;
  }
  &--default {
    background: var(--bg-elevated);
    color: var(--text-muted);
  }
}

/* Status badge */
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  &__dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  &--active {
    color: #10b981;
    .status-badge__dot {
      background: #10b981;
    }
  }
  &--inactive {
    color: var(--text-muted);
    .status-badge__dot {
      background: var(--text-muted);
    }
  }
}

.text-muted-sm {
  font-size: 0.8rem;
  color: var(--text-muted);
}

/* Action buttons */
.action-buttons {
  display: flex;
  gap: 6px;
}
.action-btn {
  width: 30px;
  height: 30px;
  border: none;
  background: var(--bg-elevated);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--text-sub);
  transition: all 0.15s;
  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  &:hover:not(:disabled) {
    background: var(--primary-soft);
    color: var(--primary);
  }
  &.danger:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
  }
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
