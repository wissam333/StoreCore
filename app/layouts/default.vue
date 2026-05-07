<!-- store-app/layouts/dashboard.vue -->
<template>
  <div :class="locale === 'ar' ? 'bodyAR' : 'bodyEN'" class="dashboard-root">
    <!-- ── NAVBAR ─────────────────────────────────────────────────────────── -->
    <SharedUiNavigationDashboardNavbar
      :sidebar-collapsed="desktopCollapsed"
      :sidebar-width="260"
      :sidebar-collapsed-width="72"
      brand="StoreOS"
      brand-icon="mdi:store-outline"
      brand-to="/"
      :brand-color="primaryColor"
      show-search
      :search-placeholder="$t('search')"
      :user="navbarUser"
      :is-rtl="locale === 'ar'"
      @open-mobile-sidebar="mobileSidebarOpen = true"
      @action-click="handleNavbarAction"
      @user-click="handleUserClick"
      @search="handleSearch"
      @logout="openLogoutConfirm"
    >
      <!-- Sync indicator in navbar -->
      <template #end>
        <div
          class="sync-pill"
          :class="{ syncing: isSyncing, offline: !isOnline }"
        >
          <Icon
            :name="
              isSyncing
                ? 'mdi:sync'
                : isOnline
                ? 'mdi:cloud-check-outline'
                : 'mdi:cloud-off-outline'
            "
            size="16"
            :class="{ spin: isSyncing }"
          />
          <span class="sync-text">
            <template v-if="isSyncing">{{ $t("syncing") }}</template>
            <template v-else-if="!isOnline">{{ $t("offline") }}</template>
            <template v-else-if="pendingCount > 0"
              >{{ pendingCount }} {{ $t("pending") }}</template
            >
            <template v-else>{{ $t("synced") }}</template>
          </span>
        </div>
      </template>
    </SharedUiNavigationDashboardNavbar>

    <!-- ── BODY ───────────────────────────────────────────────────────────── -->
    <div class="dashboard-body">
      <!-- Desktop sidebar -->
      <SharedUiNavigationSidebar
        v-show="!isMobile"
        v-model:is-collapsed="desktopCollapsed"
        :menu-items="menuItems"
        :is-mobile="false"
        @toggle-collapse="saveCollapsed"
        @item-click="handleMenuItemClick"
        @logout="openLogoutConfirm"
      >
        <template #header>
          <div
            class="sidebar-usercard"
            :class="{ collapsed: desktopCollapsed }"
          >
            <div class="sc-avatar" :style="{ background: primaryColor }">
              {{ currentUser?.full_name?.charAt(0)?.toUpperCase() ?? "A" }}
            </div>
            <Transition name="fade-text">
              <div v-show="!desktopCollapsed" class="sc-info">
                <p class="sc-name">{{ currentUser?.full_name ?? "Admin" }}</p>
                <p class="sc-role">{{ roleLabel(currentUser?.role) }}</p>
              </div>
            </Transition>
          </div>
        </template>
      </SharedUiNavigationSidebar>

      <!-- Main scroll area -->
      <main class="main-area">
        <div
          v-if="showPageHeader && (pageTitle || pageDescription)"
          class="page-head"
        >
          <div class="page-head-left">
            <div v-if="pageIcon" class="page-head-icon">
              <Icon :name="pageIcon" size="22" />
            </div>
            <div>
              <h1 class="page-title">{{ pageTitle }}</h1>
              <p v-if="pageDescription" class="page-desc">
                {{ pageDescription }}
              </p>
            </div>
          </div>
          <div v-if="$slots['header-actions']" class="page-head-actions">
            <slot name="header-actions" />
          </div>
        </div>

        <nav v-if="breadcrumbs?.length" class="breadcrumbs">
          <NuxtLink
            v-for="(crumb, i) in breadcrumbs"
            :key="i"
            :to="crumb.to"
            class="crumb"
            :class="{ last: i === breadcrumbs.length - 1 }"
          >
            {{ $t(crumb.label) }}
            <Icon
              v-if="i < breadcrumbs.length - 1"
              :name="separatorIcon"
              size="14"
              class="crumb-sep"
            />
          </NuxtLink>
        </nav>

        <slot />
      </main>
    </div>

    <!-- Mobile sidebar -->
    <SharedUiNavigationSidebar
      v-if="isMobile"
      v-model:is-open="mobileSidebarOpen"
      :menu-items="menuItems"
      :is-mobile="true"
      @close="mobileSidebarOpen = false"
      @logout="openLogoutConfirm"
    >
      <template #header>
        <div class="sidebar-usercard">
          <div class="sc-avatar" :style="{ background: primaryColor }">
            {{ currentUser?.full_name?.charAt(0)?.toUpperCase() ?? "A" }}
          </div>
          <div class="sc-info">
            <p class="sc-name">{{ currentUser?.full_name ?? "Admin" }}</p>
            <p class="sc-role">{{ roleLabel(currentUser?.role) }}</p>
          </div>
        </div>
      </template>
    </SharedUiNavigationSidebar>

    <!-- ── Logout confirm ─────────────────────────────────────────────────── -->
    <SharedUiDialogAppModal
      v-model="showLogoutModal"
      :title="$t('confirmLogout')"
      max-width="400px"
    >
      <div class="logout-modal-body">
        <div class="logout-icon-wrap">
          <Icon name="mdi:logout" size="32" />
        </div>
        <p>{{ $t("logoutConfirmMessage") }}</p>
      </div>
      <template #actions>
        <div class="d-flex gap-2 justify-content-end">
          <SharedUiButtonBase
            variant="outline"
            @click="showLogoutModal = false"
            >{{ $t("cancel") }}</SharedUiButtonBase
          >
          <SharedUiButtonBase
            variant="error"
            icon-left="mdi:logout"
            :loading="isLoggingOut"
            @click="handleLogout"
          >
            {{ $t("logout") }}
          </SharedUiButtonBase>
        </div>
      </template>
    </SharedUiDialogAppModal>
  </div>
</template>

<script setup>
const { init, primaryColor } = useTheme();
const { setLocale, locale } = useI18n();
const { logout, can } = useAuth();
onMounted(() => {
  init();
  const saved = localStorage.getItem("locale");
  if (saved === "ar" || saved === "en") {
    setLocale(saved);
  }
});

defineProps({
  pageTitle: { type: String, default: "" },
  pageDescription: { type: String, default: "" },
  pageIcon: { type: String, default: "" },
  breadcrumbs: { type: Array, default: () => [] },
  showPageHeader: { type: Boolean, default: true },
});

const userInfo = useUserInfo();
const { isSyncing, isOnline, pendingCount } = useStoreSyncManager();

const currentUser = computed(
  () => userInfo.value ?? { full_name: "Admin", role: "admin" },
);

const roleLabel = (role) =>
  ({ admin: "مدير", cashier: "كاشير", manager: "مشرف" }[role] ??
  role ??
  "Staff");

const navbarUser = computed(() => ({
  name: currentUser.value?.full_name ?? "Admin",
  role: roleLabel(currentUser.value?.role),
  avatar: null,
  online: true,
}));

const mobileSidebarOpen = ref(false);
const desktopCollapsed = ref(false);
const isMobile = ref(false);
const showLogoutModal = ref(false);
const isLoggingOut = ref(false);

const openLogoutConfirm = () => {
  showLogoutModal.value = true;
};

const handleLogout = async () => {
  isLoggingOut.value = true;
  try {
    console.log("logging out.....");
    await logout(); // clears session + Preferences + navigates to /auth/login
  } finally {
    isLoggingOut.value = false;
    showLogoutModal.value = false;
  }
};

const handleNavbarAction = () => {};
const handleUserClick = () => {};
const handleSearch = () => {};
const handleMenuItemClick = () => {};

const menuItems = computed(() => {
  const items = [];

  // Dashboard — always visible
  items.push({
    key: "dashboard",
    label: "sidebar.dashboard",
    icon: "mdi:view-dashboard-outline",
    to: "/dashboard",
  });

  // Orders
  if (can("orders.view").value) {
    items.push({
      key: "orders",
      label: "sidebar.orders",
      icon: "mdi:receipt-text-outline",
      to: "/dashboard/orders",
    });
  }

  // Products — show parent only if user can view products
  if (can("products.view").value) {
    const productChildren = [
      {
        key: "products-list",
        label: "sidebar.allProducts",
        icon: "mdi:format-list-bulleted",
        to: "/dashboard/products",
      },
    ];

    if (can("products.add").value) {
      productChildren.push({
        key: "products-new",
        label: "sidebar.addProduct",
        icon: "mdi:plus-circle-outline",
        to: "/dashboard/products/new",
      });
    }

    if (can("products.edit").value) {
      productChildren.push({
        key: "products-categories",
        label: "sidebar.categories",
        icon: "mdi:tag-multiple-outline",
        to: "/dashboard/products/categories",
      });
    }

    items.push({
      key: "products",
      label: "sidebar.products",
      icon: "mdi:package-variant-closed",
      children: productChildren,
    });
  }

  // Customers
  if (can("customers.view").value) {
    items.push({
      key: "customers",
      label: "sidebar.customers",
      icon: "mdi:account-group-outline",
      to: "/dashboard/customers",
    });
  }

  // Dues
  if (can("dues.view").value) {
    items.push({
      key: "dues",
      label: "sidebar.dues",
      icon: "mdi:cash-clock",
      to: "/dashboard/dues",
    });
  }

  // Reports — both children need reports.view
  if (can("reports.view").value) {
    items.push({
      key: "reports",
      label: "sidebar.reports",
      icon: "mdi:chart-bar",
      children: [
        {
          key: "reports-revenue",
          label: "sidebar.revenueReport",
          icon: "mdi:cash-multiple",
          to: "/dashboard/reports/revenue",
        },
        {
          key: "reports-dues",
          label: "sidebar.duesReport",
          icon: "mdi:currency-usd-off",
          to: "/dashboard/reports/dues",
        },
      ],
    });
  }

  // Staff
  if (can("staff.view").value) {
    items.push({
      key: "staff",
      label: "sidebar.staff",
      icon: "mdi:doctor",
      to: "/dashboard/staff",
    });
  }

  // Settings
  if (can("settings.view").value) {
    items.push({
      key: "settings",
      label: "sidebar.settings",
      icon: "mdi:cog-outline",
      to: "/dashboard/settings",
    });
  }

  return items;
});

const separatorIcon = computed(() =>
  locale.value === "ar" ? "mdi:chevron-left" : "mdi:chevron-right",
);

const checkMobile = () => {
  if (!import.meta.client) return;
  isMobile.value = window.innerWidth <= 991;
  if (!isMobile.value) mobileSidebarOpen.value = false;
};

const saveCollapsed = (val) => {
  desktopCollapsed.value = val;
  if (import.meta.client)
    localStorage.setItem("sidebarCollapsed", JSON.stringify(val));
};

onMounted(() => {
  checkMobile();
  window.addEventListener("resize", checkMobile);
  const saved = localStorage.getItem("sidebarCollapsed");
  if (saved !== null) desktopCollapsed.value = JSON.parse(saved);
});
onUnmounted(() => window.removeEventListener("resize", checkMobile));
</script>

<style lang="scss" scoped>
.dashboard-root {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-page);
}

.dashboard-body {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
  @media (max-width: 991px) {
    padding-top: 12px;
  }
}

// ── Sync pill ─────────────────────────────────────────────────────────────────
.sync-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
  background: var(--bg-elevated);
  border: 1px solid var(--border-color);
  color: var(--text-sub);
  transition: all 0.2s;

  &.syncing {
    border-color: var(--primary);
    color: var(--primary);
  }
  &.offline {
    border-color: #ef4444;
    color: #ef4444;
  }
}

.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

// ── Sidebar usercard ──────────────────────────────────────────────────────────
.sidebar-usercard {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px;
  overflow: hidden;
  &.collapsed .sc-info {
    opacity: 0;
    width: 0;
    overflow: hidden;
  }
}
.sc-avatar {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  color: #fff;
  font-weight: 700;
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.sc-info {
  overflow: hidden;
  flex: 1;
}
.sc-name {
  font-size: 0.825rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0;
  color: var(--text-primary);
}
.sc-role {
  font-size: 0.71rem;
  color: var(--text-muted);
  margin: 0;
  white-space: nowrap;
}

// ── Main area ─────────────────────────────────────────────────────────────────
.main-area {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 24px;
  @media (max-width: 991px) {
    padding: 16px;
  }
}

// ── Page header ───────────────────────────────────────────────────────────────
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}
.page-head-left {
  display: flex;
  align-items: center;
  gap: 14px;
}
.page-head-icon {
  width: 48px;
  height: 48px;
  background: var(--primary-soft);
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--primary);
  flex-shrink: 0;
}
.page-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 3px;
}
.page-desc {
  font-size: 0.875rem;
  color: var(--text-sub);
  margin: 0;
}
.page-head-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

// ── Breadcrumbs ───────────────────────────────────────────────────────────────
.breadcrumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  flex-shrink: 0;
}
.crumb {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.82rem;
  color: var(--text-sub);
  text-decoration: none;
  transition: color 0.15s;
  &:hover {
    color: var(--text-primary);
  }
  &.last {
    color: var(--text-primary);
    font-weight: 500;
    pointer-events: none;
  }
}
.crumb-sep {
  color: var(--border-color);
}

// ── Logout modal ──────────────────────────────────────────────────────────────
.logout-modal-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 1rem;
  padding: 0.5rem 0 1rem;
  .logout-icon-wrap {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: rgba(239, 68, 68, 0.08);
    color: #ef4444;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  p {
    font-size: 0.95rem;
    color: var(--text-sub);
    margin: 0;
    max-width: 260px;
  }
}

.fade-text-enter-active,
.fade-text-leave-active {
  transition: opacity 0.2s ease;
}
.fade-text-enter-from,
.fade-text-leave-to {
  opacity: 0;
}
</style>

<style lang="scss">
.page-enter-active,
.page-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.page-enter-from {
  opacity: 0;
  transform: scale(0.98);
}
.page-leave-to {
  opacity: 0;
  transform: scale(1.02);
}
</style>
