<!-- components/Shared/Ui/Scanner/BarcodeInput.vue -->
<!-- Usage: <SharedUiScannerBarcodeInput v-model="form.barcode" @scan="onScan" /> -->
<!--
  PRO SCANNER — ZXing-based multi-format decoder
  Supports: QR, EAN-13, EAN-8, Code128, Code39, Code93, UPC-A, UPC-E,
            ITF, Codabar, PDF417, DataMatrix, Aztec, RSS14, RSS-Expanded
  Works reliably in: Capacitor WebView, Electron, Desktop browsers

  Install: npm install @zxing/library
-->
<template>
  <div class="barcode-input-wrap">
    <!-- Input row -->
    <div class="barcode-field" :class="{ scanning: isHwScanning }">
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

      <span v-else class="hw-badge">
        <Icon name="mdi:usb" size="13" />
        {{ $t("scannerReady") || "Scanner Ready" }}
      </span>
    </div>

    <!-- Camera panel — v-show keeps <video> always in DOM (Capacitor fix) -->
    <div v-show="cameraOpen" class="camera-panel">
      <div class="camera-viewport">
        <video ref="videoEl" class="camera-video" autoplay playsinline muted />

        <!-- Scan overlay UI -->
        <div class="scan-overlay">
          <div class="scan-frame">
            <span class="sf-corner sf-tl" />
            <span class="sf-corner sf-tr" />
            <span class="sf-corner sf-bl" />
            <span class="sf-corner sf-br" />
            <div class="scan-line" />
          </div>
        </div>

        <!-- Warmup overlay -->
        <Transition name="fade">
          <div v-if="cameraWarmup" class="camera-warmup">
            <Icon name="mdi:camera-outline" size="28" />
            <span>{{ $t("startingCamera") || "Starting camera…" }}</span>
          </div>
        </Transition>

        <!-- Last detected format badge -->
        <Transition name="fade">
          <div v-if="detectedFormat" class="format-badge">
            <Icon name="mdi:barcode-scan" size="12" />
            {{ detectedFormat }}
          </div>
        </Transition>
      </div>

      <!-- Error -->
      <p v-if="scanError" class="camera-error">
        <Icon name="mdi:alert-circle-outline" size="14" />
        {{ scanError }}
      </p>

      <!-- Close -->
      <button class="camera-close" @click="closeCamera">
        <Icon name="mdi:close-circle" size="16" />
        {{ $t("cancel") }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from "vue";

const props = defineProps({
  modelValue: { type: String, default: "" },
  placeholder: { type: String, default: "" },
  disabled: { type: Boolean, default: false },
  directMode: { type: Boolean, default: false },
});

const emit = defineEmits(["update:modelValue", "scan"]);

const isElectronEnv = typeof window !== "undefined" && !!window.electronAPI;

// ── State ─────────────────────────────────────────────────────────────────────
const localValue = ref(props.modelValue);
const cameraOpen = ref(false);
const cameraWarmup = ref(false);
const scanLoading = ref(false);
const scanError = ref("");
const isHwScanning = ref(false);
const detectedFormat = ref("");

const inputRef = ref(null);
const videoEl = ref(null); // always in DOM via v-show

let _formatTimer = null;

watch(
  () => props.modelValue,
  (v) => {
    localValue.value = v;
  },
);

// ── Emit helpers ──────────────────────────────────────────────────────────────
const emitScan = (code, format = "") => {
  const clean = (code ?? "").trim();
  if (!clean) return;
  if (!props.directMode) {
    localValue.value = clean;
    emit("update:modelValue", clean);
  }
  // Flash format badge
  if (format) {
    detectedFormat.value = format;
    clearTimeout(_formatTimer);
    _formatTimer = setTimeout(() => {
      detectedFormat.value = "";
    }, 2000);
  }
  emit("scan", clean);
  closeCamera();
};

// ── ZXing loader (lazy CDN) ───────────────────────────────────────────────────
// We load ZXing from CDN so we don't need a bundler step.
// If you have npm installed: `npm install @zxing/library`
// and replace the loader with: import { BrowserMultiFormatReader } from '@zxing/library'
const ZXING_CDN = "https://unpkg.com/@zxing/library@0.21.2/umd/index.min.js";

let _zxingReader = null; // BrowserMultiFormatReader instance
let _zxingLoading = false;
let _zxingResolvers = [];

const _loadZXing = () =>
  new Promise((resolve, reject) => {
    // Already loaded
    if (window.ZXing) {
      resolve(window.ZXing);
      return;
    }
    // Already loading — queue up
    if (_zxingLoading) {
      _zxingResolvers.push({ resolve, reject });
      return;
    }
    // Check if script tag exists (e.g. duplicate mount)
    const existing = document.querySelector(`script[src="${ZXING_CDN}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.ZXing));
      existing.addEventListener("error", reject);
      return;
    }
    _zxingLoading = true;
    _zxingResolvers.push({ resolve, reject });
    const s = document.createElement("script");
    s.src = ZXING_CDN;
    s.onload = () => {
      _zxingLoading = false;
      _zxingResolvers.forEach((r) => r.resolve(window.ZXing));
      _zxingResolvers = [];
    };
    s.onerror = (e) => {
      _zxingLoading = false;
      _zxingResolvers.forEach((r) => r.reject(e));
      _zxingResolvers = [];
    };
    document.head.appendChild(s);
  });

// ── Camera / ZXing scan ───────────────────────────────────────────────────────
let _stream = null;

/**
 * ZXing hints — tell it to try every supported format.
 * This covers: QR, EAN-8/13, UPC-A/E, Code39/93/128, ITF, Codabar,
 *              PDF417, DataMatrix, Aztec, RSS14, RSS-Expanded.
 */
const _buildHints = (ZXing) => {
  const hints = new Map();
  const formats = [
    ZXing.BarcodeFormat.QR_CODE,
    ZXing.BarcodeFormat.EAN_13,
    ZXing.BarcodeFormat.EAN_8,
    ZXing.BarcodeFormat.CODE_128,
    ZXing.BarcodeFormat.CODE_39,
    ZXing.BarcodeFormat.CODE_93,
    ZXing.BarcodeFormat.UPC_A,
    ZXing.BarcodeFormat.UPC_E,
    ZXing.BarcodeFormat.ITF,
    ZXing.BarcodeFormat.CODABAR,
    ZXing.BarcodeFormat.PDF_417,
    ZXing.BarcodeFormat.DATA_MATRIX,
    ZXing.BarcodeFormat.AZTEC,
    ZXing.BarcodeFormat.RSS_14,
    ZXing.BarcodeFormat.RSS_EXPANDED,
  ].filter(Boolean);
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  // ↓ KEY: tells ZXing to also attempt rotated/inverted decoding passes
  hints.set(ZXing.DecodeHintType.ALSO_INVERTED, true);
  return hints;
};

const openCamera = async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    scanError.value = $t("cameraNotAvailable") || "Camera not available.";
    return;
  }
  try {
    scanError.value = "";
    scanLoading.value = true;

    // 1. Request camera stream
    _stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" }, // rear camera on mobile
        width: { ideal: 1280 },
        height: { ideal: 720 },
        // Ask for a high frame rate so ZXing has more chances per second
        frameRate: { ideal: 30, min: 15 },
      },
    });

    // 2. Attach stream — videoEl is always in DOM via v-show, no nextTick needed
    cameraOpen.value = true;
    cameraWarmup.value = true;
    videoEl.value.srcObject = _stream;

    // 3. Wait for actual frames to flow (critical on Capacitor)
    await new Promise((resolve) => {
      const onCanPlay = () => {
        videoEl.value?.removeEventListener("canplay", onCanPlay);
        resolve();
      };
      videoEl.value.addEventListener("canplay", onCanPlay);
      videoEl.value.play().catch(() => {});
      setTimeout(resolve, 3000); // fallback — never hang forever
    });

    cameraWarmup.value = false;
    scanLoading.value = false;

    // 4. Load ZXing
    const ZXing = await _loadZXing();
    const hints = _buildHints(ZXing);

    // 5. Create reader — BrowserMultiFormatReader handles the decode loop
    _zxingReader = new ZXing.BrowserMultiFormatReader(hints, {
      delayBetweenScanAttempts: 120,
    });

    // 6. Start continuous decode from the live <video> element
    // ZXing's decodeFromVideoElementContinuously handles its own rAF loop
    await _zxingReader.decodeFromStream(
      _stream,
      videoEl.value,
      (result, err) => {
        if (!result) return; // err is thrown when no code found — ignore
        const text = result.getText();
        const format = result.getBarcodeFormat?.() ?? "";
        const fmtName = _formatName(ZXing, format);
        if (text) emitScan(text, fmtName);
      },
    );
  } catch (e) {
    _cleanup();
    cameraWarmup.value = false;
    scanLoading.value = false;
    if (e?.name !== "NotFoundException") {
      // NotFoundException is ZXing's "no code in frame" — not a real error
      scanError.value =
        e?.name === "NotAllowedError"
          ? $t("cameraPermissionDenied") || "Camera permission denied."
          : $t("cameraOpenFailed") || "Could not open camera.";
    }
  }
};

/** Map ZXing BarcodeFormat enum to a readable string */
const _formatName = (ZXing, fmt) => {
  const map = {
    [ZXing.BarcodeFormat?.QR_CODE]: "QR Code",
    [ZXing.BarcodeFormat?.EAN_13]: "EAN-13",
    [ZXing.BarcodeFormat?.EAN_8]: "EAN-8",
    [ZXing.BarcodeFormat?.CODE_128]: "Code 128",
    [ZXing.BarcodeFormat?.CODE_39]: "Code 39",
    [ZXing.BarcodeFormat?.CODE_93]: "Code 93",
    [ZXing.BarcodeFormat?.UPC_A]: "UPC-A",
    [ZXing.BarcodeFormat?.UPC_E]: "UPC-E",
    [ZXing.BarcodeFormat?.ITF]: "ITF",
    [ZXing.BarcodeFormat?.CODABAR]: "Codabar",
    [ZXing.BarcodeFormat?.PDF_417]: "PDF 417",
    [ZXing.BarcodeFormat?.DATA_MATRIX]: "Data Matrix",
    [ZXing.BarcodeFormat?.AZTEC]: "Aztec",
    [ZXing.BarcodeFormat?.RSS_14]: "RSS-14",
    [ZXing.BarcodeFormat?.RSS_EXPANDED]: "RSS-Expanded",
  };
  return map[fmt] ?? String(fmt ?? "");
};

const _cleanup = () => {
  if (_zxingReader) {
    try {
      _zxingReader.reset();
    } catch {
      /* ignore */
    }
    _zxingReader = null;
  }
  if (_stream) {
    _stream.getTracks().forEach((t) => t.stop());
    _stream = null;
  }
  if (videoEl.value) videoEl.value.srcObject = null;
};

const closeCamera = () => {
  _cleanup();
  cameraOpen.value = false;
  cameraWarmup.value = false;
  scanLoading.value = false;
  scanError.value = "";
};

const toggleCamera = async () => {
  if (cameraOpen.value) {
    closeCamera();
    return;
  }
  await openCamera();
};

// ── Electron HW scanner ───────────────────────────────────────────────────────
let _hwBuffer = "";
let _hwTimer = null;

const _onHwKey = (e) => {
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return;
  if (["Shift", "Control", "Alt", "Meta", "Tab"].includes(e.key)) return;
  if (e.key === "Enter") {
    const code = _hwBuffer.trim();
    _hwBuffer = "";
    clearTimeout(_hwTimer);
    if (code.length > 2) emitScan(code, "HW Scanner");
    return;
  }
  _hwBuffer += e.key;
  clearTimeout(_hwTimer);
  _hwTimer = setTimeout(() => {
    const code = _hwBuffer.trim();
    _hwBuffer = "";
    if (code.length > 2) emitScan(code, "HW Scanner");
  }, 80);
};

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(() => {
  // Preload ZXing in background so first open is instant
  _loadZXing().catch(() => {});
  if (isElectronEnv) {
    isHwScanning.value = true;
    window.addEventListener("keydown", _onHwKey);
  }
});

onUnmounted(() => {
  closeCamera();
  clearTimeout(_formatTimer);
  if (isElectronEnv) {
    window.removeEventListener("keydown", _onHwKey);
    clearTimeout(_hwTimer);
  }
});
</script>

<style scoped>
.barcode-input-wrap {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ── Input row ── */
.barcode-field {
  display: flex;
  align-items: center;
  background: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  overflow: hidden;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.barcode-field:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-soft);
}
.barcode-field.scanning {
  border-color: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12);
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
}
.barcode-input::placeholder {
  color: var(--text-muted);
  font-family: "Tajawal", sans-serif;
  letter-spacing: 0;
}
.barcode-input:disabled {
  opacity: 0.5;
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
}
.barcode-scan-btn:hover,
.barcode-scan-btn.active {
  background: var(--primary-soft);
  color: var(--primary);
}
.barcode-scan-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
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

/* ── Camera panel ── */
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

/* ── Scan overlay ── */
.scan-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.scan-frame {
  position: relative;
  width: 62%;
  aspect-ratio: 1;
}
/* Dimming outside the frame */
.scan-frame::before {
  content: "";
  position: absolute;
  inset: -9999px;
  box-shadow: inset 0 0 0 9999px rgba(0, 0, 0, 0.42);
  border-radius: 10px;
  pointer-events: none;
}

/* Corner brackets */
.sf-corner {
  position: absolute;
  width: 20px;
  height: 20px;
  border-color: var(--primary, #d32f2f);
  border-style: solid;
}
.sf-tl {
  inset-block-start: 0;
  inset-inline-start: 0;
  border-width: 3px 0 0 3px;
  border-start-start-radius: 4px;
}
.sf-tr {
  inset-block-start: 0;
  inset-inline-end: 0;
  border-width: 3px 3px 0 0;
  border-start-end-radius: 4px;
}
.sf-bl {
  inset-block-end: 0;
  inset-inline-start: 0;
  border-width: 0 0 3px 3px;
  border-end-start-radius: 4px;
}
.sf-br {
  inset-block-end: 0;
  inset-inline-end: 0;
  border-width: 0 3px 3px 0;
  border-end-end-radius: 4px;
}

/* Scanning line */
.scan-line {
  position: absolute;
  inset-inline: 0;
  height: 2px;
  background: linear-gradient(
    90deg,
    transparent,
    var(--primary, #d32f2f),
    transparent
  );
  animation: scanline 2s ease-in-out infinite;
}
@keyframes scanline {
  0%,
  100% {
    top: 4%;
  }
  50% {
    top: 94%;
  }
}

/* ── Warmup overlay ── */
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

/* ── Format badge ── */
.format-badge {
  position: absolute;
  inset-block-end: 10px;
  inset-inline-end: 10px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(16, 185, 129, 0.85);
  color: #fff;
  font-size: 0.68rem;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 20px;
  backdrop-filter: blur(4px);
  pointer-events: none;
}

/* ── Error / Close ── */
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
}
.camera-close:hover {
  color: var(--text-primary);
}

/* ── Transitions ── */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
