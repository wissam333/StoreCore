<template>
  <div class="staff-page">
    <div class="container-fluid">
      <SharedUiHeaderPage
        :title="$t('sidebar.staff')"
        :subtitle="$t('staffDesc')"
        icon="mdi:doctor"
        :actions="[{ key: 'add', label: $t('addStaff'), icon: 'mdi:plus', variant: 'primary' }]"
        @action-click="openAddModal"
      />

      <!-- Filters -->
      <div class="filters-section mb-4">
        <div class="row g-3 align-items-center">
          <div class="col-md-6">
            <SharedUiFormBaseInput
              v-model="searchQuery"
              :placeholder="$t('searchStaff')"
              icon-left="mdi:magnify"
              :clearable="true"
              @update:model-value="debouncedSearch"
              @clear="clearSearch"
            />
          </div>
          <div class="col-md-4">
            <SharedUiFormBaseSelect
              v-model="roleFilter"
              :label="$t('filterByRole')"
              :options="roleFilterOptions"
              @update:model-value="fetchRecords"
            />
          </div>
          <div class="col-md-2 d-flex justify-content-end">
            <SharedUiButtonBase variant="outline" icon-left="mdi:refresh" :loading="isRefreshing" @click="refreshData">
              {{ $t("refresh") }}
            </SharedUiButtonBase>
          </div>
        </div>
      </div>

      <!-- Staff Cards Grid -->
      <div v-if="isLoading" class="loading-state">
        <Icon name="mdi:loading" size="36" class="spin" />
      </div>

      <div v-else-if="!filteredRecords.length" class="empty-state">
        <Icon name="mdi:doctor" size="52" />
        <p>{{ $t("noStaff") }}</p>
        <SharedUiButtonBase variant="primary" icon-left="mdi:plus" @click="openAddModal">{{ $t("addFirstStaff") }}</SharedUiButtonBase>
      </div>

      <div v-else class="staff-grid">
        <div v-for="member in filteredRecords" :key="member.id" class="staff-card">
          <div class="sc-header">
            <div class="sc-avatar" :class="`role-${member.role}`">
              {{ member.full_name?.charAt(0)?.toUpperCase() ?? "?" }}
            </div>
            <div class="sc-meta">
              <h3 class="sc-name">{{ member.full_name }}</h3>
              <span class="role-badge" :class="`role-${member.role}`">
                <Icon :name="roleIcon(member.role)" size="12" />
                {{ $t(`role.${member.role}`) }}
              </span>
            </div>
            <span class="active-dot" :class="{ inactive: !member.is_active }" />
          </div>
          <div class="sc-details">
            <div v-if="member.specialty" class="sc-detail-row">
              <Icon name="mdi:stethoscope" size="14" />
              <span>{{ member.specialty }}</span>
            </div>
            <div v-if="member.phone" class="sc-detail-row">
              <Icon name="mdi:phone-outline" size="14" />
              <span>{{ member.phone }}</span>
            </div>
            <div v-if="member.email" class="sc-detail-row">
              <Icon name="mdi:email-outline" size="14" />
              <span>{{ member.email }}</span>
            </div>
            <div class="sc-detail-row">
              <Icon name="mdi:account-outline" size="14" />
              <span class="text-muted">@{{ member.username || "—" }}</span>
            </div>
          </div>
          <div class="sc-actions">
            <SharedUiButtonBase variant="outline" size="sm" icon-left="mdi:pencil" @click="openEditModal(member)">
              {{ $t("edit") }}
            </SharedUiButtonBase>
            <SharedUiButtonBase
              :variant="member.is_active ? 'warning' : 'success'"
              size="sm"
              :icon-left="member.is_active ? 'mdi:account-off' : 'mdi:account-check'"
              @click="toggleActive(member)"
            >
              {{ member.is_active ? $t("deactivate") : $t("activate") }}
            </SharedUiButtonBase>
            <SharedUiButtonBase variant="error" size="sm" icon-left="mdi:delete" @click="openDeleteModal(member)" />
          </div>
        </div>
      </div>
    </div>

    <!-- Add / Edit Dialog -->
    <SharedUiDialogReusableDialog
      v-model="showModal"
      :title="isEditing ? $t('editStaff') : $t('addStaff')"
      max-width="580px"
    >
      <div class="row g-3">
        <div class="col-md-8">
          <SharedUiFormBaseInput
            v-model="form.full_name"
            :label="$t('fullName')"
            :placeholder="$t('enterFullName')"
            icon-left="mdi:account-outline"
            :required="true"
          />
        </div>
        <div class="col-md-4">
          <SharedUiFormBaseSelect
            v-model="form.role"
            :label="$t('role.label')"
            :options="roleOptions"
            :required="true"
          />
        </div>
        <div class="col-md-6">
          <SharedUiFormBaseInput
            v-model="form.username"
            :label="$t('username')"
            :placeholder="$t('enterUsername')"
            icon-left="mdi:at"
          />
        </div>
        <div class="col-md-6">
          <SharedUiFormBaseInput
            v-model="form.password"
            :label="isEditing ? $t('newPasswordOptional') : $t('password')"
            type="password"
            :placeholder="isEditing ? $t('leaveBlankToKeep') : $t('enterPassword')"
            icon-left="mdi:lock-outline"
          />
        </div>
        <div class="col-12">
          <SharedUiFormBaseInput
            v-model="form.specialty"
            :label="$t('specialty')"
            :placeholder="$t('enterSpecialty')"
            icon-left="mdi:stethoscope"
          />
        </div>
        <div class="col-md-6">
          <SharedUiFormBaseInput
            v-model="form.phone"
            :label="$t('phone')"
            :placeholder="$t('enterPhone')"
            icon-left="mdi:phone-outline"
          />
        </div>
        <div class="col-md-6">
          <SharedUiFormBaseInput
            v-model="form.email"
            :label="$t('email')"
            :placeholder="$t('enterEmail')"
            icon-left="mdi:email-outline"
          />
        </div>
        <div class="col-12">
          <label class="active-toggle">
            <input type="checkbox" v-model="form.is_active" :true-value="1" :false-value="0" />
            <span>{{ $t("active") }}</span>
          </label>
        </div>
      </div>
      <template #actions>
        <div class="d-flex gap-2 justify-content-end">
          <SharedUiButtonBase variant="outline" @click="showModal = false">{{ $t("cancel") }}</SharedUiButtonBase>
          <SharedUiButtonBase variant="primary" :loading="isSubmitting" @click="submit">{{ $t("save") }}</SharedUiButtonBase>
        </div>
      </template>
    </SharedUiDialogReusableDialog>

    <!-- Delete Modal -->
    <SharedUiDialogAppModal v-model="showDeleteModal" :title="$t('confirmDelete')" max-width="400px">
      <div class="text-center py-2">
        <Icon name="mdi:alert-circle" size="44" class="text-danger mb-2" />
        <p v-if="selectedItem">{{ $t("deleteConfirmation", { name: selectedItem.full_name }) }}</p>
      </div>
      <template #actions>
        <div class="d-flex gap-2 justify-content-end">
          <SharedUiButtonBase variant="outline" @click="showDeleteModal = false">{{ $t("cancel") }}</SharedUiButtonBase>
          <SharedUiButtonBase variant="error" :loading="isDeleting" @click="confirmDelete">{{ $t("delete") }}</SharedUiButtonBase>
        </div>
      </template>
    </SharedUiDialogAppModal>
  </div>
</template>

<script setup>
import { useDebounceFn } from "@vueuse/core";

definePageMeta({ layout: "default" });

const { t } = useI18n();
const { $toast } = useNuxtApp();
const { getStaff, saveStaff, deleteStaff } = useClinic();

const records       = ref([]);
const isLoading     = ref(false);
const isRefreshing  = ref(false);
const isSubmitting  = ref(false);
const isDeleting    = ref(false);
const showModal      = ref(false);
const showDeleteModal = ref(false);
const selectedItem   = ref(null);
const isEditing      = ref(false);
const searchQuery    = ref("");
const roleFilter     = ref("");

const emptyForm = () => ({
  full_name: "", username: "", password: "", role: "doctor",
  specialty: "", phone: "", email: "", is_active: 1,
});
const form = ref(emptyForm());

const roleOptions = computed(() => [
  { value: "admin",        label: t("role.admin")        },
  { value: "doctor",       label: t("role.doctor")       },
  { value: "nurse",        label: t("role.nurse")        },
  { value: "receptionist", label: t("role.receptionist") },
]);
const roleFilterOptions = computed(() => [
  { value: "", label: t("allRoles") },
  ...roleOptions.value,
]);

const filteredRecords = computed(() => {
  let r = records.value;
  if (roleFilter.value) r = r.filter(m => m.role === roleFilter.value);
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    r = r.filter(m => m.full_name?.toLowerCase().includes(q) || m.username?.toLowerCase().includes(q));
  }
  return r;
});

const roleIcon = (role) => ({
  admin:        "mdi:shield-crown-outline",
  doctor:       "mdi:doctor",
  nurse:        "mdi:account-heart-outline",
  receptionist: "mdi:headset",
})[role] ?? "mdi:account-outline";

const fetchRecords = async () => {
  isLoading.value = true;
  try {
    const r = await getStaff();
    if (r.ok) records.value = r.data;
  } finally { isLoading.value = false; isRefreshing.value = false; }
};

const debouncedSearch = useDebounceFn(() => {}, 300); // filtering is client-side
const clearSearch     = () => { searchQuery.value = ""; };
const refreshData     = () => { isRefreshing.value = true; fetchRecords(); };

const openAddModal  = () => { isEditing.value = false; selectedItem.value = null; form.value = emptyForm(); showModal.value = true; };
const openEditModal = (row) => {
  isEditing.value = true; selectedItem.value = row;
  form.value = { ...row, password: "" }; showModal.value = true;
};
const openDeleteModal = (row) => { selectedItem.value = row; showDeleteModal.value = true; };

const submit = async () => {
  if (!form.value.full_name || !form.value.role) return $toast.error(t("required"));
  isSubmitting.value = true;
  try {
    const payload = {
      ...form.value,
      id: isEditing.value ? selectedItem.value?.id : undefined,
      // Don't send empty password on edit
      password: form.value.password || (isEditing.value ? undefined : ""),
    };
    const r = await saveStaff(payload);
    if (r.ok) { $toast.success(isEditing.value ? t("updateSuccess") : t("createSuccess")); showModal.value = false; fetchRecords(); }
    else throw new Error(r.error);
  } catch (err) { $toast.error(err.message); }
  finally { isSubmitting.value = false; }
};

const toggleActive = async (member) => {
  const r = await saveStaff({ ...member, is_active: member.is_active ? 0 : 1 });
  if (r.ok) { $toast.success(t("updateSuccess")); fetchRecords(); }
};

const confirmDelete = async () => {
  isDeleting.value = true;
  try {
    const r = await deleteStaff(selectedItem.value.id);
    if (r.ok) { $toast.success(t("deleteSuccess")); showDeleteModal.value = false; fetchRecords(); }
  } finally { isDeleting.value = false; selectedItem.value = null; }
};

onMounted(fetchRecords);
</script>

<style lang="scss" scoped>
.staff-page { padding: 2rem; min-height: 100vh; background: var(--bg-page); }

.filters-section {
  background: var(--bg-surface); border-radius: 16px; padding: 1.5rem;
  box-shadow: 0 2px 12px rgba(0,0,0,.05); border: 1px solid var(--border-color);
}

.loading-state, .empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 1rem; padding: 5rem 1rem; color: var(--text-muted);
  p { font-size: .95rem; margin: 0; }
}

.staff-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1.1rem;
}

.staff-card {
  background: var(--bg-surface); border-radius: 16px; padding: 1.25rem;
  border: 1px solid var(--border-color); box-shadow: 0 2px 8px rgba(0,0,0,.04);
  display: flex; flex-direction: column; gap: 1rem;
  transition: box-shadow .18s, transform .18s;
  &:hover { box-shadow: 0 6px 20px rgba(0,0,0,.09); transform: translateY(-2px); }
}

.sc-header { display: flex; align-items: center; gap: .75rem; }
.sc-avatar {
  width: 48px; height: 48px; border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  font-weight: 800; font-size: 1.05rem; color: #fff; flex-shrink: 0;
  &.role-admin        { background: linear-gradient(135deg, #6366f1, #8b5cf6); }
  &.role-doctor       { background: linear-gradient(135deg, #3b82f6, #60a5fa); }
  &.role-nurse        { background: linear-gradient(135deg, #ec4899, #f472b6); }
  &.role-receptionist { background: linear-gradient(135deg, #10b981, #34d399); }
}
.sc-meta { flex: 1; min-width: 0; }
.sc-name { font-size: .95rem; font-weight: 700; color: var(--text-primary); margin: 0 0 .3rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.role-badge {
  display: inline-flex; align-items: center; gap: .25rem;
  padding: .18rem .55rem; border-radius: 20px; font-size: .72rem; font-weight: 700;
  &.role-admin        { background: rgba(99,102,241,.12); color: #6366f1; }
  &.role-doctor       { background: rgba(59,130,246,.12); color: #3b82f6; }
  &.role-nurse        { background: rgba(236,72,153,.12); color: #ec4899; }
  &.role-receptionist { background: rgba(16,185,129,.12); color: #10b981; }
}

.active-dot {
  width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
  background: #10b981; box-shadow: 0 0 0 2px rgba(16,185,129,.25);
  &.inactive { background: #94a3b8; box-shadow: none; }
}

.sc-details { display: flex; flex-direction: column; gap: .3rem; }
.sc-detail-row {
  display: flex; align-items: center; gap: .4rem;
  font-size: .8rem; color: var(--text-sub);
  .iconify { color: var(--text-muted); flex-shrink: 0; }
}

.sc-actions { display: flex; gap: .4rem; flex-wrap: wrap; padding-top: .5rem; border-top: 1px solid var(--border-color); }

.active-toggle {
  display: flex; align-items: center; gap: .5rem; cursor: pointer;
  font-weight: 600; color: var(--text-primary); font-size: .88rem;
  input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--primary); cursor: pointer; }
}

.text-danger { color: #dc3545 !important; }
.text-muted  { color: var(--text-muted) !important; }
.spin { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 768px) {
  .staff-page { padding: 1rem; }
  .staff-grid { grid-template-columns: 1fr; }
}
</style>
