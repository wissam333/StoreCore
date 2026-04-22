<template>
  <header class="app-header" :class="{ scrolled: isScrolled }">
    <div class="header-inner">
      <!-- Logo -->
      <NuxtLink to="/" class="header-logo">
        <div class="logo-mark">
          <span class="logo-dot" />
        </div>
        <span class="logo-text">KKit</span>
      </NuxtLink>

      <!-- Right controls -->
      <div class="header-controls">
        <!-- Dark/Light toggle -->
        <button
          class="aesthetic-btn-icon theme-toggle"
          :title="isDark ? 'Switch to Light' : 'Switch to Dark'"
          @click="toggleDark"
        >
          <Transition name="icon-swap" mode="out-in">
            <Icon v-if="isDark" key="sun" name="i-ph-sun-bold" size="18" />
            <Icon v-else key="moon" name="i-ph-moon-bold" size="18" />
          </Transition>
        </button>

        <!-- Language toggle -->
        <button
          class="aesthetic-btn-icon lang-btn"
          @click="toggleLang"
          title="Switch Language"
        >
          <Icon name="i-ph-translate-bold" size="18" />
          <span
            class="lang-indicator"
            :class="$i18n.locale === 'ar' ? 'ar' : 'en'"
          >
            {{ $i18n.locale === "ar" ? "EN" : "ع" }}
          </span>
        </button>
      </div>
    </div>
  </header>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from "vue";

const { locale, setLocale } = useI18n();
const { isDark, toggleDark, init } = useTheme();

const isScrolled = ref(false);

const toggleLang = () => {
  setLocale(locale.value === "ar" ? "en" : "ar");
};

const onScroll = () => {
  isScrolled.value = window.scrollY > 12;
};

onMounted(() => {
  init();
  window.addEventListener("scroll", onScroll, { passive: true });
});
onUnmounted(() => window.removeEventListener("scroll", onScroll));
</script>

<style lang="scss" scoped>
.app-header {
  position: fixed;
  top: 0;
  inset-inline: 0;
  z-index: 100;
  background: transparent;
  transition:
    background 0.25s ease,
    box-shadow 0.25s ease,
    backdrop-filter 0.25s ease;

  &.scrolled {
    background: rgba(var(--bg-surface-rgb, 255 255 255), 0.85);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    box-shadow: 0 1px 0 var(--border-color);
  }
}

.header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 20px;
  height: 62px;

  @media (max-width: 480px) {
    padding: 0 14px;
    height: 54px;
  }
}

/* ─── Logo ─────────────────────────────────────────── */
.header-logo {
  display: flex;
  align-items: center;
  gap: 9px;
  text-decoration: none;
}

.logo-mark {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.logo-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.25);
}

.logo-text {
  font-size: 1.05rem;
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

/* ─── Controls row ──────────────────────────────────── */
.header-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* ─── Shared icon button ────────────────────────────── */
.aesthetic-btn-icon {
  position: relative;
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-muted);
  width: 40px;
  height: 40px;
  border-radius: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);

  @media (max-width: 480px) {
    width: 36px;
    height: 36px;
    border-radius: 9px;
  }

  &:hover {
    color: var(--primary);
    border-color: var(--primary);
    background: var(--primary-soft);
  }
}

/* ─── Lang badge ────────────────────────────────────── */
.lang-indicator {
  position: absolute;
  bottom: 3px;
  right: 3px;
  font-size: 0.44rem;
  font-weight: 900;
  line-height: 1;
  background: var(--text-primary);
  color: var(--bg-surface);
  padding: 2px 3px;
  border-radius: 3px;
  pointer-events: none;

  &.en {
    font-family: "Tajawal", sans-serif;
  }
  &.ar {
    font-family: "Tajawal", sans-serif;
  }
}

/* ─── Icon swap transition ─────────────────────────── */
.icon-swap-enter-active,
.icon-swap-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}
.icon-swap-enter-from {
  opacity: 0;
  transform: rotate(-30deg) scale(0.7);
}
.icon-swap-leave-to {
  opacity: 0;
  transform: rotate(30deg) scale(0.7);
}
</style>
