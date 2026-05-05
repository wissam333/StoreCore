<!-- components/Shared/Ui/Scanner/BarcodeInput.vue -->
<!-- Usage: <SharedUiScannerBarcodeInput v-model="form.barcode" @scan="onScan" /> -->
<template>
  <div class="barcode-input-wrap">
    <!-- Input row -->
    <div
      class="barcode-field"
      :class="{ scanning: isScanning && isElectronEnv }"
    >
      <div class="barcode-icon">
        <Icon name="mdi:barcode-scan" size="18" />
      </div>
      <input
        ref="inputRef"
        v-model="localValue"
        class="barcode-input"
        :placeholder="placeholder || $t('barcode')"
        :disabled="disabled"
        @keydown.enter.prevent="emitScan(localValue)"
        @input="emit('update:modelValue', localValue)"
      />

      <!-- Camera scan button: shown on web + Capacitor mobile, hidden on Electron -->
      <button
        v-if="!isElectronEnv"
        class="barcode-scan-btn"
        :class="{ active: cameraOpen }"
        :disabled="scanLoading"
        @click="toggleCamera"
        :title="$t('scanBarcode')"
      >
        <Icon
          :name="
            scanLoading
              ? 'mdi:loading'
              : cameraOpen
              ? 'mdi:close'
              : 'mdi:camera'
          "
          size="18"
          :class="{ spin: scanLoading }"
        />
      </button>

      <!-- Electron: visual "HW scanner ready" badge -->
      <span v-else class="hw-badge">
        <Icon name="mdi:usb" size="13" />
        {{ $t("scannerReady") || "Scanner Ready" }}
      </span>
    </div>

    <!-- Camera preview panel (web + Capacitor, both use getUserMedia) -->
    <Transition name="camera-slide">
      <div v-if="cameraOpen" class="camera-panel">
        <div class="camera-viewport">
          <video
            ref="videoEl"
            class="camera-video"
            autoplay
            playsinline
            muted
          />
          <!-- Hidden canvas used for frame decoding -->
          <canvas ref="canvasEl" class="camera-canvas-hidden" />
          <!-- Animated scan frame overlay -->
          <div class="scan-frame">
            <div class="scan-line" />
          </div>
          <!-- Loading overlay while camera warms up -->
          <Transition name="fade">
            <div v-if="cameraWarmup" class="camera-warmup">
              <Icon name="mdi:camera-outline" size="28" />
              <span>{{ $t("startingCamera") || "Starting camera…" }}</span>
            </div>
          </Transition>
        </div>

        <p v-if="scanError" class="camera-error">
          <Icon name="mdi:alert-circle-outline" size="14" />
          {{ scanError }}
        </p>

        <button class="camera-close" @click="closeCamera">
          <Icon name="mdi:close-circle" size="16" />
          {{ $t("cancel") }}
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, watch, onUnmounted, nextTick } from "vue";
import { useScanner } from "~/composables/useScanner";

const props = defineProps({
  modelValue: { type: String, default: "" },
  placeholder: { type: String, default: "" },
  disabled: { type: Boolean, default: false },
  /**
   * directMode: if true, a successful scan fires emit('scan') but does NOT
   * populate the text input. Useful on POS for instant product lookup.
   */
  directMode: { type: Boolean, default: false },
});

const emit = defineEmits(["update:modelValue", "scan"]);

const { startScan, stopScan, scanError, isScanning } = useScanner();

// Environment flags — resolved once on mount, not reactive
const isElectronEnv = typeof window !== "undefined" && !!window.electronAPI;

// ── Local state ───────────────────────────────────────────────────────────────
const localValue = ref(props.modelValue);
const cameraOpen = ref(false);
const cameraWarmup = ref(false); // shows "starting camera…" overlay
const scanLoading = ref(false);
const inputRef = ref(null);
const videoEl = ref(null);
const canvasEl = ref(null);

// Keep localValue in sync when parent changes v-model externally
watch(
  () => props.modelValue,
  (v) => {
    localValue.value = v;
  },
);

// ── Scan result handler ───────────────────────────────────────────────────────
const emitScan = (code) => {
  const clean = (code ?? "").trim();
  if (!clean) return;
  if (!props.directMode) {
    localValue.value = clean;
    emit("update:modelValue", clean);
  }
  emit("scan", clean);
  closeCamera();
};

// ── Electron / HW scanner ─────────────────────────────────────────────────────
// On Electron the HW scanner is always-on: we start listening immediately
// and keep it alive for the lifetime of this component instance.
if (isElectronEnv) {
  startScan({ onScan: emitScan });
  onUnmounted(() => stopScan());
}

// ── Camera (web browser + Capacitor WebView) ──────────────────────────────────
// Both environments use getUserMedia — no Capacitor plugin needed.
const toggleCamera = async () => {
  if (cameraOpen.value) {
    await closeCamera();
    return;
  }
  await openCamera();
};

const openCamera = async () => {
  scanLoading.value = true;
  cameraOpen.value = true; // show panel immediately so the <video> mounts
  cameraWarmup.value = true;

  // Wait for the DOM to paint the video element before handing refs to useScanner
  await nextTick();

  await startScan({
    onScan: emitScan,
    videoEl: videoEl.value,
    canvasEl: canvasEl.value,
  });

  scanLoading.value = false;

  // Hide warmup overlay after the 1500ms stabilisation inside useScanner
  // We add a small extra buffer so the transition feels smooth
  setTimeout(() => {
    cameraWarmup.value = false;
  }, 1600);
};

const closeCamera = async () => {
  cameraOpen.value = false;
  cameraWarmup.value = false;
  scanLoading.value = false;
  await stopScan();
};

// Ensure camera is released if the component is torn down while open
onUnmounted(() => {
  if (!isElectronEnv) stopScan();
});
</script>

<style scoped>
.barcode-input-wrap {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ── Input row ────────────────────────────────────────────────────────────── */
.barcode-field {
  display: flex;
  align-items: center;
  background: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  overflow: hidden;
  transition: border-color 0.15s, box-shadow 0.15s;

  &:focus-within {
    border-color: var(--primary);
    box-shadow: 0 0 0 3px var(--primary-soft);
  }

  /* Pulse border while HW scanner is active on Electron */
  &.scanning {
    border-color: #10b981;
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12);
  }
}

.barcode-icon {
  padding: 0 10px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.barcode-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  padding: 10px 8px;
  font-size: 0.9rem;
  color: var(--text-primary);
  font-family: monospace;
  letter-spacing: 0.05em;

  &::placeholder {
    color: var(--text-muted);
    font-family: "Tajawal", sans-serif;
    letter-spacing: 0;
  }

  &:disabled {
    opacity: 0.5;
  }
}

.barcode-scan-btn {
  background: none;
  border: none;
  border-inline-start: 1px solid var(--border-color);
  padding: 0 12px;
  height: 40px;
  cursor: pointer;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  transition: color 0.15s, background 0.15s;
  flex-shrink: 0;

  &:hover,
  &.active {
    background: var(--primary-soft);
    color: var(--primary);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.hw-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.68rem;
  font-weight: 600;
  padding: 3px 10px;
  margin-inline-end: 8px;
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  border-radius: 20px;
  white-space: nowrap;
}

/* ── Camera panel ─────────────────────────────────────────────────────────── */
.camera-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.camera-viewport {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  background: #000;
  aspect-ratio: 4 / 3;
  max-height: 300px;
}

.camera-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.camera-canvas-hidden {
  display: none;
}

/* Animated scan frame */
.scan-frame {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;

  &::before {
    content: "";
    position: absolute;
    width: 60%;
    aspect-ratio: 1;
    border: 2px solid var(--primary);
    border-radius: 10px;
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45);
  }
}

.scan-line {
  position: absolute;
  width: 55%;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--primary), transparent);
  animation: scanline 2s ease-in-out infinite;
}

@keyframes scanline {
  0%,
  100% {
    top: 20%;
  }
  50% {
    top: 78%;
  }
}

/* Warmup overlay */
.camera-warmup {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 0.82rem;
}

/* Error message */
.camera-error {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  color: #ef4444;
  background: rgba(239, 68, 68, 0.07);
  border-radius: 8px;
  padding: 7px 12px;
  margin: 0;
}

/* Close button */
.camera-close {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 8px;
  font-size: 0.82rem;
  color: var(--text-muted);
  cursor: pointer;
  transition: color 0.15s;

  &:hover {
    color: var(--text-primary);
  }
}

/* ── Transitions ──────────────────────────────────────────────────────────── */
.camera-slide-enter-active,
.camera-slide-leave-active {
  transition: all 0.22s ease;
}
.camera-slide-enter-from,
.camera-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
