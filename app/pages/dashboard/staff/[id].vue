<!-- store-app/pages/dashboard/staff/[id].vue -->
<template>
  <div>
    <SharedUiHeaderPage
      :title="isNew ? $t('staff.addStaff') : $t('staff.editStaff')"
      :subtitle="isNew ? $t('staff.addStaffSubtitle') : form.full_name"
      :icon="isNew ? 'mdi:account-plus-outline' : 'mdi:account-edit-outline'"
      :is-rtl="locale === 'ar'"
      show-back
      @back="navigateTo('/dashboard/staff')"
    />

    <div class="staff-form-layout">
      <!-- Left column: identity -->
      <div class="form-card glass-card">
        <div class="form-card__header">
          <Icon name="mdi:account-outline" size="18" />
          <span>{{ $t("staff.identity") }}</span>
        </div>

        <div class="avatar-preview">
          <div class="avatar-preview__circle" :data-initials="initials">
            {{ initials }}
          </div>
          <div class="avatar-preview__info">
            <span class="avatar-preview__name">{{
              form.full_name || $t("staff.namePlaceholder")
            }}</span>
            <span class="avatar-preview__role">{{
              selectedRoleName || $t("staff.noRole")
            }}</span>
          </div>
        </div>

        <div class="fields">
          <SharedUiFormBaseInput
            v-model="form.full_name"
            :label="$t('staff.fullName') + ' *'"
            :placeholder="$t('staff.fullNamePlaceholder')"
            icon-left="mdi:account-outline"
            :error="!!errors.full_name"
            :error-message="errors.full_name"
            size="md"
            @update:model-value="errors.full_name = ''"
          />

          <SharedUiFormBaseInput
            v-model="form.username"
            :label="$t('staff.username') + ' *'"
            :placeholder="$t('staff.usernamePlaceholder')"
            icon-left="mdi:at"
            :error="!!errors.username"
            :error-message="errors.username"
            autocomplete="off"
            autocapitalize="none"
            size="md"
            @update:model-value="errors.username = ''"
          />

          <SharedUiFormBaseInput
            v-model="form.phone"
            :label="$t('staff.phone')"
            :placeholder="$t('staff.phonePlaceholder')"
            icon-left="mdi:phone-outline"
            type="tel"
            size="md"
          />

          <SharedUiFormBaseInput
            v-model="form.email"
            :label="$t('staff.email')"
            :placeholder="$t('staff.emailPlaceholder')"
            icon-left="mdi:email-outline"
            type="email"
            size="md"
          />

          <!-- Active toggle -->
          <div class="field field--inline">
            <div>
              <label class="field__label">{{ $t("staff.status") }}</label>
              <span class="field__hint">{{ $t("staff.activeHint") }}</span>
            </div>
            <button
              type="button"
              class="toggle"
              :class="{ 'toggle--on': form.is_active }"
              :aria-checked="form.is_active"
              role="switch"
              @click="form.is_active = !form.is_active"
            >
              <span class="toggle__knob" />
            </button>
          </div>
        </div>
      </div>

      <!-- Right column: role + password -->
      <div class="right-col">
        <!-- Role card -->
        <div class="form-card glass-card">
          <div class="form-card__header">
            <Icon name="mdi:shield-account-outline" size="18" />
            <span>{{ $t("staff.role") }}</span>
          </div>

          <div class="fields">
            <SharedUiFormBaseSelect
              v-model="form.role_id"
              :label="$t('staff.assignRole')"
              icon-left="mdi:shield-outline"
              :error="!!errors.role_id"
              :error-message="errors.role_id"
              :options="[
                { label: $t('staff.noRole'), value: '' },
                ...roles.map((r) => ({ label: r.name, value: r.id })),
              ]"
              size="md"
              @change="errors.role_id = ''"
            />

            <!-- Permission preview for selected role -->
            <Transition name="fade">
              <div v-if="selectedRole" class="perm-preview">
                <div class="perm-preview__title">
                  <Icon name="mdi:eye-outline" size="14" />
                  {{ $t("staff.permissionsPreview") }}
                </div>
                <div class="perm-grid">
                  <div
                    v-for="(actions, module) in permissionsByModule"
                    :key="module"
                    class="perm-module"
                  >
                    <span class="perm-module__name">{{ module }}</span>
                    <div class="perm-module__actions">
                      <span
                        v-for="action in actions"
                        :key="action.key"
                        class="perm-chip"
                        :class="
                          action.allowed ? 'perm-chip--on' : 'perm-chip--off'
                        "
                      >
                        <Icon
                          :name="action.allowed ? 'mdi:check' : 'mdi:close'"
                          size="10"
                        />
                        {{ action.label }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </Transition>
          </div>
        </div>

        <!-- Password card -->
        <div class="form-card glass-card">
          <div class="form-card__header">
            <Icon name="mdi:lock-outline" size="18" />
            <span>{{
              isNew ? $t("staff.setPassword") : $t("staff.changePassword")
            }}</span>
          </div>
          <p v-if="!isNew" class="form-card__hint">
            {{ $t("staff.passwordLeaveBlank") }}
          </p>

          <div class="fields">
            <SharedUiFormBaseInput
              v-model="form.password"
              :label="$t('auth.password') + (isNew ? ' *' : '')"
              :placeholder="
                isNew
                  ? $t('staff.passwordPlaceholder')
                  : $t('staff.passwordOptional')
              "
              icon-left="mdi:lock-outline"
              type="password"
              :error="!!errors.password"
              :error-message="errors.password"
              autocomplete="new-password"
              size="md"
              @update:model-value="errors.password = ''"
            />

            <SharedUiFormBaseInput
              v-model="form.password_confirm"
              :label="$t('staff.confirmPassword')"
              :placeholder="$t('staff.confirmPasswordPlaceholder')"
              icon-left="mdi:lock-check-outline"
              type="password"
              :error="!!errors.password_confirm"
              :error-message="errors.password_confirm"
              autocomplete="new-password"
              size="md"
              @update:model-value="errors.password_confirm = ''"
            />
          </div>
        </div>

        <!-- Actions -->
        <div class="form-actions">
          <SharedUiButtonBase
            variant="outline"
            @click="navigateTo('/dashboard/staff')"
          >
            {{ $t("cancel") }}
          </SharedUiButtonBase>
          <SharedUiButtonBase
            variant="primary"
            :loading="saving"
            icon-left="mdi:content-save-outline"
            @click="submit"
          >
            {{ isNew ? $t("staff.createStaff") : $t("save") }}
          </SharedUiButtonBase>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
definePageMeta({
  searchMeta: {
    label: "Staff Edit",
    labelAr: "تعديل موظف",
    icon: "mdi:account-edit-outline",
    group: "Settings",
  },
});

const route = useRoute();
const { locale, t } = useI18n();
const { $toast } = useNuxtApp();
const { saveStaff, getRoles, getStaffWithRoles, can } = useAuth();

// Guard
onMounted(() => {
  if (!can("staff.manage").value) navigateTo("/dashboard");
});

const isNew = computed(() => route.params.id === "new");

// ── Form state ─────────────────────────────────────────────────────────────
const form = reactive({
  id: null,
  full_name: "",
  username: "",
  phone: "",
  email: "",
  role_id: "",
  password: "",
  password_confirm: "",
  is_active: true,
});

const errors = reactive({
  full_name: "",
  username: "",
  role_id: "",
  password: "",
  password_confirm: "",
});

const saving = ref(false);
const showPassword = ref(false);
const roles = ref([]);

// ── Load roles ─────────────────────────────────────────────────────────────
onMounted(async () => {
  const res = await getRoles();
  if (res.ok) roles.value = res.data;
});

// ── Load existing staff for edit ───────────────────────────────────────────
onMounted(async () => {
  if (isNew.value) return;
  const res = await getStaffWithRoles("");
  if (res.ok) {
    const found = res.data.find((s) => s.id === route.params.id);
    if (!found) {
      $toast.error(t("staff.notFound"));
      navigateTo("/dashboard/staff");
      return;
    }
    Object.assign(form, {
      id: found.id,
      full_name: found.full_name,
      username: found.username,
      phone: found.phone ?? "",
      email: found.email ?? "",
      role_id: found.role_id ?? "",
      is_active: !!found.is_active,
    });
  }
});

// ── Computed helpers ───────────────────────────────────────────────────────
const initials = computed(
  () =>
    (form.full_name || "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?",
);

const selectedRole = computed(
  () => roles.value.find((r) => r.id === form.role_id) ?? null,
);

const selectedRoleName = computed(() => selectedRole.value?.name ?? "");

const permissionsByModule = computed(() => {
  if (!selectedRole.value) return {};
  const perms = selectedRole.value.permissions ?? {};
  const grouped = {};
  for (const [key, allowed] of Object.entries(perms)) {
    const [module, action] = key.split(".");
    if (!grouped[module]) grouped[module] = [];
    grouped[module].push({ key, action, label: action, allowed });
  }
  return grouped;
});

// ── Validation ─────────────────────────────────────────────────────────────
const validate = () => {
  let ok = true;

  if (!form.full_name.trim()) {
    errors.full_name = t("staff.errors.nameRequired");
    ok = false;
  }
  if (!form.username.trim()) {
    errors.username = t("staff.errors.usernameRequired");
    ok = false;
  }
  if (isNew.value && !form.password.trim()) {
    errors.password = t("staff.errors.passwordRequired");
    ok = false;
  }
  if (form.password && form.password.length < 4) {
    errors.password = t("staff.errors.passwordTooShort");
    ok = false;
  }
  if (form.password && form.password !== form.password_confirm) {
    errors.password_confirm = t("staff.errors.passwordMismatch");
    ok = false;
  }
  return ok;
};

// ── Submit ─────────────────────────────────────────────────────────────────
const submit = async () => {
  if (!validate()) return;
  saving.value = true;

  try {
    const payload = {
      id: form.id ?? undefined,
      full_name: form.full_name.trim(),
      username: form.username.trim().toLowerCase(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      role_id: form.role_id || null,
      is_active: form.is_active,
    };
    if (form.password.trim()) {
      payload.password = form.password.trim();
    }

    const res = await saveStaff(payload);
    if (res.ok) {
      $toast.success(t(isNew.value ? "staff.created" : "staff.updated"));
      navigateTo("/dashboard/staff");
    } else {
      $toast.error(res.error);
    }
  } finally {
    saving.value = false;
  }
};
</script>

<style lang="scss" scoped>
.staff-form-layout {
  display: grid;
  grid-template-columns: 1fr 1.1fr;
  gap: 1.25rem;
  align-items: start;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
}

.right-col {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

/* Card */
.form-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 1.5rem;

  &__header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--text-primary);
    margin-bottom: 1.25rem;
    padding-bottom: 0.875rem;
    border-bottom: 1px solid var(--border-color);

    .icon {
      color: var(--primary);
    }
  }

  &__hint {
    font-size: 0.78rem;
    color: var(--text-muted);
    margin: -0.5rem 0 1rem;
    line-height: 1.5;
  }
}

/* Avatar preview */
.avatar-preview {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  margin-bottom: 1.5rem;
  padding: 0.875rem;
  background: var(--bg-elevated);
  border-radius: 12px;

  &__circle {
    width: 48px;
    height: 48px;
    border-radius: 14px;
    background: var(--primary-soft);
    color: var(--primary);
    font-size: 1rem;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    letter-spacing: 0.02em;
    transition: background 0.2s;
  }

  &__name {
    display: block;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  &__role {
    display: block;
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-top: 1px;
  }
}

/* Fields */
.fields {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;

  &--inline {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    padding: 0.625rem 0;
    border-top: 1px solid var(--border-color);
    margin-top: 0.25rem;
  }

  &--error .field__wrap {
    border-color: #ef4444 !important;
    box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.12) !important;
  }

  &__label {
    font-size: 0.775rem;
    font-weight: 600;
    color: var(--text-sub);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  &__hint {
    display: block;
    font-size: 0.73rem;
    color: var(--text-muted);
    margin-top: 1px;
  }

  /* ── Input wrap ── */
  &__wrap {
    position: relative; /* ensures absolute children are contained */
    display: flex;
    align-items: center;
    background: var(--bg-elevated);
    border: 1.5px solid var(--border-color);
    border-radius: 10px;
    transition: border-color 0.2s, box-shadow 0.2s;

    &:focus-within {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px var(--primary-soft);
    }

    &--select {
      /* chevron positioned absolutely on the end side */
    }
  }

  /* ── Icon — pinned to the start side of the wrap ── */
  &__icon {
    /* Use absolute positioning so the icon floats over the input */
    position: absolute;
    inset-inline-start: 0.75rem;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-muted);
    pointer-events: none;
    flex-shrink: 0;
    line-height: 0; /* prevent extra height from icon component */
    z-index: 1;
  }

  /* ── Input — left pad to clear the icon ── */
  &__input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-size: 0.9rem;
    font-family: inherit;
    /* Always leave start-side room for the icon */
    padding: 0.6875rem 0.75rem 0.6875rem 2.5rem;
    width: 100%;
    min-width: 0;

    &::placeholder {
      color: var(--text-muted);
    }

    /* Select needs end-side room for chevron too */
    &--select {
      appearance: none;
      cursor: pointer;
      padding-inline-end: 2.25rem;
    }

    /* Password with visibility toggle needs end-side room */
    &--with-toggle {
      padding-inline-end: 2.5rem;
    }
  }

  /* ── Password visibility toggle ── */
  &__toggle {
    position: absolute;
    inset-inline-end: 0.5rem;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    padding: 0.2rem;
    display: flex;
    align-items: center;
    border-radius: 4px;
    transition: color 0.15s;
    z-index: 1;

    &:hover {
      color: var(--text-primary);
    }
  }

  /* ── Select chevron ── */
  &__chevron {
    position: absolute;
    inset-inline-end: 0.75rem;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-muted);
    pointer-events: none;
    z-index: 1;
  }

  &__error {
    font-size: 0.75rem;
    color: #ef4444;
    display: flex;
    align-items: center;
    gap: 4px;
  }
}

/* ── Active / status toggle switch ── */
.toggle {
  width: 44px;
  height: 24px;
  border-radius: 999px;
  background: var(--bg-elevated);
  border: 1.5px solid var(--border-color);
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
  position: relative;
  flex-shrink: 0;

  &--on {
    background: var(--primary);
    border-color: var(--primary);
  }

  /* Knob */
  &__knob {
    position: absolute;
    top: 2px;
    /* LTR: start from left */
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: white;
    transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);

    /* RTL: mirror — start from right */
    [dir="rtl"] & {
      left: auto;
      right: 2px;
    }
  }

  /* LTR on: slide right */
  &--on &__knob {
    transform: translateX(20px);
  }

  /* RTL on: slide left */
  [dir="rtl"] &--on &__knob {
    transform: translateX(-20px);
  }
}

/* Permission preview */
.perm-preview {
  background: var(--bg-elevated);
  border-radius: 10px;
  padding: 0.875rem;
  border: 1px solid var(--border-color);

  &__title {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.75rem;
  }
}

.perm-grid {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.perm-module {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  flex-wrap: wrap;

  &__name {
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--text-sub);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    min-width: 68px;
    padding-top: 2px;
    flex-shrink: 0;
  }

  &__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    flex: 1;
  }
}

.perm-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 0.68rem;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 20px;
  letter-spacing: 0.02em;

  &--on {
    background: rgba(16, 185, 129, 0.1);
    color: #10b981;
  }

  &--off {
    background: var(--bg-surface);
    color: var(--text-muted);
    opacity: 0.7;
  }
}

/* Actions row */
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding-top: 0.25rem;
}

/* Transition */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
