<!-- components/Shared/Ui/Scanner/BarcodeInput.vue -->
<!-- Usage: <SharedUiScannerBarcodeInput v-model="form.barcode" @scan="onScan" /> -->
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

    <!--
      KEY FIX: v-show (not v-if) + NO <Transition> wrapper around the video.
      On Capacitor WebView, <Transition> delays DOM insertion so videoEl.value
      is still null after nextTick. v-show keeps <video> always mounted,
      so srcObject can be attached immediately without waiting.
    -->
    <div v-show="cameraOpen" class="camera-panel">
      <div class="camera-viewport">
        <video ref="videoEl" class="camera-video" autoplay playsinline muted />
        <canvas ref="canvasEl" class="camera-canvas-hidden" />
        <div class="scan-frame">
          <div class="scan-line" />
        </div>
        <div v-if="cameraWarmup" class="camera-warmup">
          <Icon name="mdi:camera-outline" size="28" />
          <span>{{ $t("startingCamera") || "Starting camera…" }}</span>
        </div>
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

const localValue = ref(props.modelValue);
const cameraOpen = ref(false);
const cameraWarmup = ref(false);
const scanLoading = ref(false);
const scanError = ref("");
const isHwScanning = ref(false);

const inputRef = ref(null);
const videoEl = ref(null); // always in DOM via v-show — never null
const canvasEl = ref(null); // always in DOM via v-show — never null

watch(
  () => props.modelValue,
  (v) => {
    localValue.value = v;
  },
);

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

// ── Camera ────────────────────────────────────────────────────────────────────
const JSQR_CDN = "https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.js";
const SCAN_INTERVAL_MS = 200;

let _stream = null;
let _raf = null;
let _active = false;
let _lastFrameTime = 0;
let _barcodeDetector = null;

const _loadJsQr = () =>
  new Promise((resolve, reject) => {
    if (window.jsQR) return resolve();
    const existing = document.querySelector(`script[src="${JSQR_CDN}"]`);
    if (existing) {
      existing.addEventListener("load", resolve);
      existing.addEventListener("error", reject);
      return;
    }
    const s = document.createElement("script");
    s.src = JSQR_CDN;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });

const _scanFrame = async (timestamp) => {
  if (!_active) return;
  if (timestamp - _lastFrameTime < SCAN_INTERVAL_MS) {
    _raf = requestAnimationFrame(_scanFrame);
    return;
  }
  _lastFrameTime = timestamp;

  const video = videoEl.value;
  const canvas = canvasEl.value;
  if (
    !video ||
    !canvas ||
    !_stream ||
    video.readyState < 4 ||
    video.videoWidth === 0
  ) {
    _raf = requestAnimationFrame(_scanFrame);
    return;
  }

  const W = video.videoWidth;
  const H = video.videoHeight;
  const size = Math.min(W, H) * 0.7;
  const sx = (W - size) / 2;
  const sy = (H - size) / 2;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  try {
    ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);

    if (_barcodeDetector) {
      const codes = await _barcodeDetector.detect(canvas);
      if (codes.length > 0) {
        emitScan(codes[0].rawValue);
        return;
      }
    }

    if (window.jsQR) {
      const imageData = ctx.getImageData(0, 0, size, size);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        let g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        g = g < 128 ? g * 0.7 : 128 + (g - 128) * 1.3;
        g = Math.max(0, Math.min(255, g));
        d[i] = d[i + 1] = d[i + 2] = g;
      }
      ctx.putImageData(imageData, 0, 0);
      const code = window.jsQR(
        ctx.getImageData(0, 0, size, size).data,
        size,
        size,
        { inversionAttempts: "attemptBoth" },
      );
      if (code?.data) {
        emitScan(code.data);
        return;
      }
    }
  } catch {
    /* ignore per-frame errors */
  }

  if (_active) _raf = requestAnimationFrame(_scanFrame);
};

const openCamera = async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    scanError.value = $t("cameraNotAvailable") || "Camera not available.";
    return;
  }
  try {
    scanError.value = "";
    scanLoading.value = true;

    _stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });

    // KEY FIX: videoEl is always mounted (v-show), attach stream directly — no nextTick needed
    cameraOpen.value = true;
    cameraWarmup.value = true;
    videoEl.value.srcObject = _stream;

    // Wait for canplay — the real signal frames are flowing on Capacitor
    await new Promise((resolve) => {
      const onCanPlay = () => {
        videoEl.value?.removeEventListener("canplay", onCanPlay);
        resolve();
      };
      videoEl.value.addEventListener("canplay", onCanPlay);
      videoEl.value.play().catch(() => {});
      setTimeout(resolve, 3000); // safety fallback — never hang forever
    });

    cameraWarmup.value = false;
    scanLoading.value = false;

    await _loadJsQr().catch(() => {});

    if ("BarcodeDetector" in window && !_barcodeDetector) {
      try {
        _barcodeDetector = new window.BarcodeDetector({
          formats: [
            "qr_code",
            "ean_13",
            "ean_8",
            "code_128",
            "code_39",
            "upc_a",
            "upc_e",
          ],
        });
      } catch {
        _barcodeDetector = null;
      }
    }

    _active = true;
    _lastFrameTime = 0;
    _raf = requestAnimationFrame(_scanFrame);
  } catch (e) {
    _stream?.getTracks().forEach((t) => t.stop());
    _stream = null;
    cameraOpen.value = false;
    cameraWarmup.value = false;
    scanLoading.value = false;
    scanError.value =
      e.name === "NotAllowedError"
        ? $t("cameraPermissionDenied") || "Camera permission denied."
        : $t("cameraOpenFailed") || "Could not open camera.";
  }
};

const closeCamera = () => {
  _active = false;
  if (_raf) {
    cancelAnimationFrame(_raf);
    _raf = null;
  }
  if (_stream) {
    _stream.getTracks().forEach((t) => t.stop());
    _stream = null;
  }
  if (videoEl.value) videoEl.value.srcObject = null;
  cameraOpen.value = false;
  cameraWarmup.value = false;
  scanLoading.value = false;
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
    if (code.length > 2) emitScan(code);
    return;
  }
  _hwBuffer += e.key;
  clearTimeout(_hwTimer);
  _hwTimer = setTimeout(() => {
    const code = _hwBuffer.trim();
    _hwBuffer = "";
    if (code.length > 2) emitScan(code);
  }, 80);
};

onMounted(() => {
  _loadJsQr().catch(() => {});
  if ("BarcodeDetector" in window) {
    try {
      _barcodeDetector = new window.BarcodeDetector({
        formats: [
          "qr_code",
          "ean_13",
          "ean_8",
          "code_128",
          "code_39",
          "upc_a",
          "upc_e",
        ],
      });
    } catch {
      _barcodeDetector = null;
    }
  }
  if (isElectronEnv) {
    isHwScanning.value = true;
    window.addEventListener("keydown", _onHwKey);
  }
});

onUnmounted(() => {
  closeCamera();
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

.scan-frame {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.scan-frame::before {
  content: "";
  position: absolute;
  width: 60%;
  aspect-ratio: 1;
  border: 2px solid var(--primary);
  border-radius: 10px;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45);
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
</style>
