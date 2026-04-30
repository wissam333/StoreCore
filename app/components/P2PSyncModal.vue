<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="modelValue"
        class="p2p-overlay"
        @click.self="tryClose"
        :dir="$i18n.locale === 'ar' ? 'rtl' : 'ltr'"
      >
        <div class="p2p-modal">
          <!-- Header -->
          <div class="p2p-header">
            <div class="p2p-header-icon">
              <Icon name="i-ph-wifi-high" size="20" />
            </div>
            <div class="p2p-header-text">
              <h2 class="p2p-title">{{ $t("p2p.title") }}</h2>
              <p class="p2p-subtitle">{{ $t("p2p.subtitle") }}</p>
            </div>
            <button class="p2p-close" @click="tryClose">
              <Icon name="i-ph-x" size="18" />
            </button>
          </div>

          <!-- Body -->
          <div class="p2p-body">
            <!-- ── Mode picker ─────────────────────────────────────────── -->
            <div v-if="mode === 'pick'" class="p2p-pick">
              <p class="p2p-pick-label">{{ $t("p2p.pick.question") }}</p>
              <div class="p2p-pick-grid">
                <button class="p2p-pick-btn" @click="chooseMode('host')">
                  <div class="p2p-pick-icon">
                    <Icon name="i-ph-monitor-play" size="22" />
                  </div>
                  <span class="p2p-pick-name">{{
                    $t("p2p.pick.host.name")
                  }}</span>
                  <span class="p2p-pick-desc">{{
                    $t("p2p.pick.host.desc")
                  }}</span>
                </button>
                <button class="p2p-pick-btn" @click="chooseMode('guest')">
                  <div class="p2p-pick-icon">
                    <Icon name="i-ph-device-mobile-camera" size="22" />
                  </div>
                  <span class="p2p-pick-name">{{
                    $t("p2p.pick.guest.name")
                  }}</span>
                  <span class="p2p-pick-desc">{{
                    $t("p2p.pick.guest.desc")
                  }}</span>
                </button>
              </div>
            </div>

            <!-- ── HOST VIEW ───────────────────────────────────────────── -->
            <div v-else-if="mode === 'host'" class="p2p-host">
              <div
                v-if="status === 'loading' || status === 'connecting'"
                class="p2p-waiting"
              >
                <div class="p2p-spinner"></div>
                <p>{{ statusMsg || $t("p2p.status.preparing") }}</p>
              </div>
              <div v-else-if="status === 'ready'" class="p2p-qr-wrap">
                <p class="p2p-qr-label">{{ $t("p2p.host.qrLabel") }}</p>
                <div class="p2p-qr-box">
                  <div ref="qrEl" class="p2p-qr-inner"></div>
                  <div class="p2p-qr-corner p2p-qr-corner--tl"></div>
                  <div class="p2p-qr-corner p2p-qr-corner--tr"></div>
                  <div class="p2p-qr-corner p2p-qr-corner--bl"></div>
                  <div class="p2p-qr-corner p2p-qr-corner--br"></div>
                </div>
                <p class="p2p-peer-id">
                  {{ $t("p2p.host.idLabel") }}: <code>{{ peerId }}</code>
                </p>
                <p class="p2p-hint">{{ $t("p2p.host.hint") }}</p>
              </div>
              <div v-else-if="status === 'syncing'" class="p2p-syncing">
                <div class="p2p-sync-anim">
                  <div class="p2p-sync-ring"></div>
                  <Icon
                    class="p2p-sync-icon"
                    name="i-ph-arrows-clockwise"
                    size="28"
                  />
                </div>
                <p class="p2p-sync-msg">{{ statusMsg }}</p>
                <div v-if="progress.total > 0" class="p2p-progress">
                  <div
                    class="p2p-progress-bar"
                    :style="{ width: progressPct + '%' }"
                  ></div>
                </div>
                <p v-if="progress.total > 0" class="p2p-progress-label">
                  {{ progress.current }} / {{ progress.total }}
                  {{ $t("p2p.status.rows") }}
                </p>
              </div>
              <div v-else-if="status === 'done'" class="p2p-done">
                <div class="p2p-done-icon">✓</div>
                <p class="p2p-done-msg">{{ $t("p2p.status.done") }}</p>
                <p class="p2p-done-sub">{{ $t("p2p.status.doneSub") }}</p>
              </div>
              <div v-else-if="status === 'error'" class="p2p-error">
                <div class="p2p-error-icon">!</div>
                <p class="p2p-error-msg">
                  {{ error || $t("p2p.status.error") }}
                </p>
              </div>
            </div>

            <!-- ── GUEST VIEW ──────────────────────────────────────────── -->
            <div v-else-if="mode === 'guest'" class="p2p-guest">
              <!-- Step: enter ID or scan -->
              <div v-if="guestStep === 'enter'" class="p2p-enter">
                <p class="p2p-enter-label">{{ $t("p2p.guest.enterLabel") }}</p>

                <div class="p2p-input-wrap">
                  <input
                    v-model="manualId"
                    class="p2p-input"
                    :placeholder="$t('p2p.guest.inputPlaceholder')"
                    @keydown.enter="connectManual"
                  />
                  <button
                    class="p2p-input-btn"
                    @click="connectManual"
                    :disabled="!manualId.trim()"
                  >
                    {{ $t("p2p.guest.connect") }}
                  </button>
                </div>

                <div class="p2p-divider">
                  <span>{{ $t("p2p.guest.or") }}</span>
                </div>

                <!--
                  ════════════════════════════════════════════════════════════
                  NEW APPROACH — @capacitor-mlkit/barcode-scanning
                  ════════════════════════════════════════════════════════════

                  ALL previous approaches failed because Capacitor 8 on Android
                  13-15 blocks WebView file pickers triggered from JS and
                  getUserMedia in the WebView context is unreliable across OEMs.

                  This plugin opens a real native Android camera Activity,
                  completely bypassing the WebView. MLKit QR detection runs
                  natively — no jsQR, no canvas, no file input hacks.

                  Compatible with: Capacitor 8.x, AGP 8.7.x, Android 8+
                  Install:
                    npm install @capacitor-mlkit/barcode-scanning
                    npx cap sync android

                  On Electron / browser → falls back to getUserMedia + jsQR
                  so desktop still works without any changes.
                  ════════════════════════════════════════════════════════════
                -->
                <button
                  class="p2p-scan-btn"
                  @click="startScan"
                  :disabled="scanLoading"
                >
                  <Icon
                    name="i-ph-qr-code"
                    size="18"
                    style="color: var(--p2p-accent)"
                  />
                  <span v-if="scanLoading">{{
                    $t("p2p.guest.scanLoading") || "Opening scanner..."
                  }}</span>
                  <span v-else>{{ $t("p2p.guest.openCamera") }}</span>
                </button>

                <p v-if="scanError" class="p2p-scan-error">{{ scanError }}</p>
              </div>

              <!-- Step: web fallback live camera (desktop/browser only) -->
              <div v-else-if="guestStep === 'scan'" class="p2p-scan">
                <p class="p2p-scan-label">{{ $t("p2p.guest.scanLabel") }}</p>
                <div class="p2p-video-wrap">
                  <video
                    ref="videoEl"
                    class="p2p-video"
                    autoplay
                    playsinline
                    muted
                  ></video>
                  <div class="p2p-scan-overlay">
                    <div class="p2p-scan-frame">
                      <div class="p2p-scan-line"></div>
                    </div>
                  </div>
                  <canvas ref="canvasEl" class="p2p-canvas-hidden"></canvas>
                </div>
                <button class="p2p-cancel-scan" @click="stopWebScan">
                  {{ $t("p2p.guest.cancelScan") }}
                </button>
              </div>

              <!-- Step: syncing / done / error -->
              <div v-else-if="guestStep === 'sync'">
                <div
                  v-if="status === 'loading' || status === 'connecting'"
                  class="p2p-waiting"
                >
                  <div class="p2p-spinner"></div>
                  <p>{{ statusMsg || $t("p2p.status.connecting") }}</p>
                </div>
                <div v-else-if="status === 'syncing'" class="p2p-syncing">
                  <div class="p2p-sync-anim">
                    <div class="p2p-sync-ring"></div>
                    <Icon
                      class="p2p-sync-icon"
                      name="i-ph-arrows-clockwise"
                      size="28"
                    />
                  </div>
                  <p class="p2p-sync-msg">{{ statusMsg }}</p>
                  <div v-if="progress.total > 0" class="p2p-progress">
                    <div
                      class="p2p-progress-bar"
                      :style="{ width: progressPct + '%' }"
                    ></div>
                  </div>
                  <p v-if="progress.total > 0" class="p2p-progress-label">
                    {{ progress.current }} / {{ progress.total }}
                    {{ $t("p2p.status.rows") }}
                  </p>
                </div>
                <div v-else-if="status === 'done'" class="p2p-done">
                  <div class="p2p-done-icon">✓</div>
                  <p class="p2p-done-msg">{{ $t("p2p.status.done") }}</p>
                  <p class="p2p-done-sub">{{ $t("p2p.status.doneSub") }}</p>
                </div>
                <div v-else-if="status === 'error'" class="p2p-error">
                  <div class="p2p-error-icon">!</div>
                  <p class="p2p-error-msg">
                    {{ error || $t("p2p.status.connectionFailed") }}
                  </p>
                  <button class="p2p-retry" @click="guestStep = 'enter'">
                    {{ $t("p2p.guest.tryAgain") }}
                  </button>
                </div>

                <div v-if="debugLogs.length" class="p2p-debug">
                  <div class="p2p-debug-title">Debug log</div>
                  <div
                    v-for="(line, i) in debugLogs"
                    :key="i"
                    class="p2p-debug-line"
                    :class="line.type"
                  >
                    {{ line.text }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="p2p-footer">
            <button v-if="mode !== 'pick'" class="p2p-back" @click="goBack">
              ← {{ $t("p2p.nav.back") }}
            </button>
            <button
              v-if="status === 'done'"
              class="p2p-close-btn"
              @click="handleClose"
            >
              {{ $t("p2p.nav.close") }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { useP2PSync } from "~/composables/useP2PSync";

const props = defineProps({ modelValue: Boolean });
const emit = defineEmits(["update:modelValue", "synced"]);

const {
  status,
  statusMsg,
  peerId,
  progress,
  error,
  startHost,
  connectToHost,
  reset,
  loadQrLib,
} = useP2PSync();

// ── UI state ──────────────────────────────────────────────────────────────────
const mode = ref("pick");
const guestStep = ref("enter");
const manualId = ref("");
const scanLoading = ref(false);
const scanError = ref("");

// ── Template refs ─────────────────────────────────────────────────────────────
const qrEl = ref(null);
const videoEl = ref(null);
const canvasEl = ref(null);

// ── Debug log ─────────────────────────────────────────────────────────────────
const debugLogs = ref([]);
const MAX_LOGS = 12;

let _origLog = null,
  _origError = null;
const hookConsole = () => {
  _origLog = console.log.bind(console);
  _origError = console.error.bind(console);
  console.log = (...a) => {
    _origLog(...a);
    const m = a.join(" ");
    if (m.includes("[P2P]")) {
      debugLogs.value.push({ text: m, type: "info" });
      if (debugLogs.value.length > MAX_LOGS)
        debugLogs.value.splice(0, debugLogs.value.length - MAX_LOGS);
    }
  };
  console.error = (...a) => {
    _origError(...a);
    const m = a.join(" ");
    if (m.includes("[P2P]")) {
      debugLogs.value.push({ text: m, type: "error" });
      if (debugLogs.value.length > MAX_LOGS)
        debugLogs.value.splice(0, debugLogs.value.length - MAX_LOGS);
    }
  };
};
const unhookConsole = () => {
  if (_origLog) {
    console.log = _origLog;
    _origLog = null;
  }
  if (_origError) {
    console.error = _origError;
    _origError = null;
  }
};

// ── Scan internals ────────────────────────────────────────────────────────────
let _qrInstance = null;
let _videoStream = null;
let _scanRaf = null;
let _scanActive = false;
let _lastScanTime = 0;
let _barcodeDetector = null;
const SCAN_INTERVAL_MS = 200;

const progressPct = computed(() =>
  progress.value.total > 0
    ? Math.round((progress.value.current / progress.value.total) * 100)
    : 0,
);

// ── jsQR loader ───────────────────────────────────────────────────────────────
const JSQR_CDN = "https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.js";
const loadScript = (src) =>
  new Promise((resolve, reject) => {
    if (window.jsQR && src === JSQR_CDN) return resolve();
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (window.jsQR) return resolve();
      existing.addEventListener("load", resolve);
      existing.addEventListener("error", reject);
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });

onMounted(() => {
  // Pre-load jsQR and init BarcodeDetector if available
  loadScript(JSQR_CDN).catch(() => {});
  if ("BarcodeDetector" in window) {
    try {
      _barcodeDetector = new window.BarcodeDetector({ formats: ["qr_code"] });
    } catch {}
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HOST — generate QR code
// ─────────────────────────────────────────────────────────────────────────────
const chooseMode = async (m) => {
  mode.value = m;
  if (m === "host") await startHost();
};

watch([() => status.value, qrEl], async ([s, el]) => {
  if (s !== "ready" || !el) return;
  await nextTick();
  try {
    await loadQrLib();
    if (_qrInstance) {
      _qrInstance.clear();
      _qrInstance = null;
    }
    await new Promise((r) => setTimeout(r, 100));
    if (!qrEl.value) return;
    _qrInstance = new window.QRCode(qrEl.value, {
      text: peerId.value,
      width: 220,
      height: 220,
      colorDark: "#0f172a",
      colorLight: "#f8fafc",
      correctLevel: window.QRCode.CorrectLevel.H,
    });
  } catch (e) {
    console.warn("[P2P] QR generation failed:", e);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GUEST — manual connect
// ─────────────────────────────────────────────────────────────────────────────
const connectManual = () => {
  const id = manualId.value.trim();
  if (!id) return;
  debugLogs.value = [];
  hookConsole();
  guestStep.value = "sync";
  connectToHost(id);
};

// ─────────────────────────────────────────────────────────────────────────────
// GUEST — startScan() — always uses WebView camera (works on Android + desktop)
// ─────────────────────────────────────────────────────────────────────────────
const startScan = async () => {
  if (scanLoading.value) return;
  scanError.value = "";
  scanLoading.value = true;
  await startWebScan();
  scanLoading.value = false;
};

const startWebScan = async () => {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      scanError.value = "Camera not available. Please type the ID manually.";
      return;
    }

    // Request highest possible resolution for better QR detection
    _videoStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      },
    });

    guestStep.value = "scan";
    await nextTick();

    if (videoEl.value) {
      videoEl.value.srcObject = _videoStream;
      await videoEl.value.play().catch(() => {});
    }

    // Make sure jsQR is loaded as fallback
    await loadScript(JSQR_CDN).catch(() => {});

    _scanActive = true;
    scheduleScan();
  } catch (e) {
    console.warn("[P2P] Web scan error:", e);
    if (e.name === "NotAllowedError") {
      scanError.value =
        "Camera permission denied. Please allow camera access and try again.";
    } else {
      scanError.value = "Could not open camera. Please type the ID manually.";
    }
  }
};

const stopWebScan = () => {
  _scanActive = false;
  if (_scanRaf) {
    cancelAnimationFrame(_scanRaf);
    _scanRaf = null;
  }
  if (_videoStream) {
    _videoStream.getTracks().forEach((t) => t.stop());
    _videoStream = null;
  }
  if (guestStep.value === "scan") guestStep.value = "enter";
};

const scheduleScan = () => {
  if (_scanActive) _scanRaf = requestAnimationFrame(scanFrame);
};

const scanFrame = async (timestamp) => {
  if (!_scanActive) return;
  if (timestamp - _lastScanTime < SCAN_INTERVAL_MS) {
    scheduleScan();
    return;
  }
  _lastScanTime = timestamp;

  const video = videoEl.value;
  const canvas = canvasEl.value;
  if (
    !video ||
    !canvas ||
    !_videoStream ||
    video.readyState < 2 ||
    video.videoWidth === 0
  ) {
    scheduleScan();
    return;
  }

  const W = video.videoWidth;
  const H = video.videoHeight;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  try {
    // ── Strategy 1: BarcodeDetector ──
    if (_barcodeDetector) {
      const codes = await _barcodeDetector.detect(video);
      console.log("[SCAN] BarcodeDetector found:", codes.length, "codes");
      if (codes.length > 0) {
        handleScannedId(codes[0].rawValue);
        return;
      }
    } else {
      console.log("[SCAN] BarcodeDetector not available, using jsQR");
    }

    // ── Strategy 2: jsQR ──
    if (window.jsQR) {
      ctx.drawImage(video, 0, 0, W, H);
      const imageData = ctx.getImageData(0, 0, W, H);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        let g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        g = g < 128 ? g * 0.7 : 128 + (g - 128) * 1.3;
        g = Math.max(0, Math.min(255, g));
        d[i] = d[i + 1] = d[i + 2] = g;
      }
      ctx.putImageData(imageData, 0, 0);
      const code = window.jsQR(ctx.getImageData(0, 0, W, H).data, W, H, {
        inversionAttempts: "attemptBoth",
      });
      console.log(
        "[SCAN] jsQR result:",
        code?.data ?? "null",
        "frame size:",
        W,
        "x",
        H,
      );
      if (code?.data) {
        handleScannedId(code.data);
        return;
      }
    } else {
      console.log("[SCAN] jsQR not loaded");
    }
  } catch (e) {
    console.log("[SCAN] error:", e.message);
  }

  scheduleScan();
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared: handle a scanned or entered peer ID
// ─────────────────────────────────────────────────────────────────────────────
const handleScannedId = (id) => {
  if (!id?.trim()) return;
  stopWebScan();
  manualId.value = id.trim();
  debugLogs.value = [];
  hookConsole();
  guestStep.value = "sync";
  connectToHost(id.trim());
};

// ─────────────────────────────────────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────────────────────────────────────
const goBack = async () => {
  stopWebScan();
  unhookConsole();
  reset();
  mode.value = "pick";
  guestStep.value = "enter";
  manualId.value = "";
  scanError.value = "";
  debugLogs.value = [];
  _qrInstance = null;
};

const tryClose = () => {
  if (status.value === "syncing") return;
  handleClose();
};

const handleClose = async () => {
  if (status.value === "done") emit("synced");
  stopWebScan();
  unhookConsole();
  reset();
  mode.value = "pick";
  guestStep.value = "enter";
  manualId.value = "";
  scanLoading.value = false;
  scanError.value = "";
  debugLogs.value = [];
  _qrInstance = null;
  emit("update:modelValue", false);
};

onUnmounted(() => {
  stopWebScan();
  unhookConsole();
  reset();
});
</script>

<style scoped>
.p2p-overlay {
  --p2p-bg: var(--bg-page);
  --p2p-surface: var(--bg-surface);
  --p2p-surface2: var(--bg-elevated);
  --p2p-border: var(--border-color);
  --p2p-accent: var(--primary);
  --p2p-accent-dim: var(--primary-soft);
  --p2p-accent-mid: var(--primary-mid);
  --p2p-text: var(--text-primary);
  --p2p-muted: var(--text-muted);
  --p2p-success: #34d399;
  --p2p-error: #f87171;
  --p2p-radius: 16px;

  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 16px;
  font-family: "Tajawal", sans-serif;
}

.p2p-modal {
  background: var(--p2p-surface);
  border: 1px solid var(--p2p-border);
  border-radius: var(--p2p-radius);
  width: 100%;
  max-width: 420px;
  max-height: 90vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  color: var(--p2p-text);
  box-shadow: 0 25px 50px rgba(0, 0, 0, 0.3);
}

.p2p-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 20px 16px;
  border-bottom: 1px solid var(--p2p-border);
  flex-shrink: 0;
}
.p2p-header-icon {
  width: 40px;
  height: 40px;
  background: var(--p2p-accent-dim);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--p2p-accent);
}
.p2p-header-text {
  flex: 1;
  min-width: 0;
}
.p2p-title {
  font-size: 16px;
  font-weight: 700;
  margin: 0;
}
.p2p-subtitle {
  font-size: 12px;
  color: var(--p2p-muted);
  margin: 2px 0 0;
}
.p2p-close {
  margin-inline-start: auto;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--p2p-muted);
  padding: 6px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s, background 0.15s;
  flex-shrink: 0;
}
.p2p-close:hover {
  color: var(--p2p-text);
  background: var(--p2p-surface2);
}
.p2p-body {
  flex: 1;
}

.p2p-pick {
  padding: 24px 20px;
}
.p2p-pick-label {
  font-size: 13px;
  color: var(--p2p-muted);
  text-align: center;
  margin: 0 0 16px;
}
.p2p-pick-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.p2p-pick-btn {
  background: var(--p2p-surface2);
  border: 1px solid var(--p2p-border);
  border-radius: 12px;
  padding: 20px 14px;
  cursor: pointer;
  color: var(--p2p-text);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
  transition: border-color 0.15s, background 0.15s, transform 0.1s;
}
.p2p-pick-btn:hover {
  border-color: var(--p2p-accent);
  background: var(--p2p-accent-dim);
  transform: translateY(-1px);
}
.p2p-pick-icon {
  width: 44px;
  height: 44px;
  background: var(--p2p-accent-dim);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--p2p-accent);
}
.p2p-pick-name {
  font-size: 13px;
  font-weight: 600;
}
.p2p-pick-desc {
  font-size: 11px;
  color: var(--p2p-muted);
  line-height: 1.4;
}

.p2p-waiting {
  padding: 40px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  color: var(--p2p-muted);
  font-size: 14px;
}
.p2p-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid var(--p2p-border);
  border-top-color: var(--p2p-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.p2p-qr-wrap {
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}
.p2p-qr-label {
  font-size: 13px;
  color: var(--p2p-muted);
  text-align: center;
  margin: 0;
}
.p2p-qr-box {
  position: relative;
  padding: 16px;
  background: #f8fafc;
  border-radius: 12px;
}
.p2p-qr-inner {
  display: block;
}
.p2p-qr-corner {
  position: absolute;
  width: 20px;
  height: 20px;
  border-color: var(--p2p-accent);
  border-style: solid;
}
.p2p-qr-corner--tl {
  top: -2px;
  left: -2px;
  border-width: 3px 0 0 3px;
  border-radius: 4px 0 0 0;
}
.p2p-qr-corner--tr {
  top: -2px;
  right: -2px;
  border-width: 3px 3px 0 0;
  border-radius: 0 4px 0 0;
}
.p2p-qr-corner--bl {
  bottom: -2px;
  left: -2px;
  border-width: 0 0 3px 3px;
  border-radius: 0 0 0 4px;
}
.p2p-qr-corner--br {
  bottom: -2px;
  right: -2px;
  border-width: 0 3px 3px 0;
  border-radius: 0 0 4px 0;
}
.p2p-peer-id {
  font-size: 11px;
  color: var(--p2p-muted);
  margin: 0;
}
.p2p-peer-id code {
  font-family: monospace;
  color: var(--p2p-accent);
  word-break: break-all;
}
.p2p-hint {
  font-size: 12px;
  color: var(--p2p-muted);
  text-align: center;
  margin: 0;
}

.p2p-syncing {
  padding: 32px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}
.p2p-sync-anim {
  position: relative;
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.p2p-sync-ring {
  position: absolute;
  inset: 0;
  border: 3px solid var(--p2p-border);
  border-top-color: var(--p2p-accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
.p2p-sync-icon {
  color: var(--p2p-accent);
}
.p2p-sync-msg {
  font-size: 14px;
  color: var(--p2p-muted);
  margin: 0;
}
.p2p-progress {
  width: 100%;
  max-width: 260px;
  height: 4px;
  background: var(--p2p-border);
  border-radius: 2px;
  overflow: hidden;
}
.p2p-progress-bar {
  height: 100%;
  background: var(--p2p-accent);
  border-radius: 2px;
  transition: width 0.3s ease;
}
.p2p-progress-label {
  font-size: 12px;
  color: var(--p2p-muted);
  margin: 0;
}

.p2p-done {
  padding: 40px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.p2p-done-icon {
  width: 56px;
  height: 56px;
  background: rgba(52, 211, 153, 0.15);
  color: var(--p2p-success);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  font-weight: 700;
  animation: pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes pop {
  from {
    transform: scale(0);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
.p2p-done-msg {
  font-size: 16px;
  font-weight: 700;
  color: var(--p2p-success);
  margin: 0;
}
.p2p-done-sub {
  font-size: 13px;
  color: var(--p2p-muted);
  margin: 0;
}

.p2p-error {
  padding: 40px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.p2p-error-icon {
  width: 56px;
  height: 56px;
  background: rgba(248, 113, 113, 0.15);
  color: var(--p2p-error);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  font-weight: 700;
}
.p2p-error-msg {
  font-size: 14px;
  color: var(--p2p-error);
  text-align: center;
  margin: 0;
}
.p2p-retry {
  background: var(--p2p-accent-dim);
  border: 1px solid var(--p2p-accent);
  color: var(--p2p-accent);
  border-radius: 8px;
  padding: 8px 18px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s;
}
.p2p-retry:hover {
  background: var(--p2p-accent-mid);
}

.p2p-enter {
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.p2p-enter-label {
  font-size: 13px;
  color: var(--p2p-muted);
  margin: 0;
  text-align: center;
}
.p2p-input-wrap {
  display: flex;
  gap: 8px;
}
.p2p-input {
  flex: 1;
  background: var(--p2p-surface2);
  border: 1px solid var(--p2p-border);
  border-radius: 8px;
  padding: 10px 12px;
  color: var(--p2p-text);
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
}
.p2p-input:focus {
  border-color: var(--p2p-accent);
}
.p2p-input::placeholder {
  color: var(--p2p-muted);
}
.p2p-input-btn {
  background: var(--p2p-accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.15s;
}
.p2p-input-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.p2p-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--p2p-muted);
  font-size: 12px;
}
.p2p-divider::before,
.p2p-divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--p2p-border);
}

.p2p-scan-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--p2p-surface2);
  border: 1px solid var(--p2p-border);
  border-radius: 10px;
  padding: 14px;
  color: var(--p2p-text);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, opacity 0.15s;
}
.p2p-scan-btn:hover {
  border-color: var(--p2p-accent);
  background: var(--p2p-accent-dim);
}
.p2p-scan-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.p2p-scan-error {
  font-size: 12px;
  color: var(--p2p-error);
  text-align: center;
  margin: 0;
  padding: 8px 12px;
  background: rgba(248, 113, 113, 0.08);
  border-radius: 8px;
}

.p2p-scan {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.p2p-scan-label {
  font-size: 13px;
  color: var(--p2p-muted);
  text-align: center;
  margin: 0;
}
.p2p-video-wrap {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  background: #000;
  aspect-ratio: 1;
}
.p2p-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.p2p-canvas-hidden {
  display: none;
}
.p2p-scan-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.p2p-scan-frame {
  width: 65%;
  aspect-ratio: 1;
  border: 2px solid var(--p2p-accent);
  border-radius: 12px;
  position: relative;
  overflow: hidden;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
}
.p2p-scan-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(
    90deg,
    transparent,
    var(--p2p-accent),
    transparent
  );
  animation: scan 2s ease-in-out infinite;
}
@keyframes scan {
  0% {
    top: 0%;
  }
  50% {
    top: calc(100% - 2px);
  }
  100% {
    top: 0%;
  }
}
.p2p-cancel-scan {
  background: var(--p2p-surface2);
  border: 1px solid var(--p2p-border);
  color: var(--p2p-muted);
  border-radius: 8px;
  padding: 10px;
  font-size: 13px;
  cursor: pointer;
  transition: color 0.15s;
}
.p2p-cancel-scan:hover {
  color: var(--p2p-text);
}

.p2p-debug {
  margin: 12px 20px 0;
  background: #0f172a;
  border-radius: 8px;
  padding: 10px 12px;
  max-height: 160px;
  overflow-y: auto;
  font-family: monospace;
}
.p2p-debug-title {
  font-size: 10px;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}
.p2p-debug-line {
  font-size: 10px;
  line-height: 1.5;
  word-break: break-all;
  white-space: pre-wrap;
  color: #94a3b8;
}
.p2p-debug-line.error {
  color: #f87171;
}

.p2p-footer {
  padding: 14px 20px;
  border-top: 1px solid var(--p2p-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 56px;
  flex-shrink: 0;
}
.p2p-back {
  background: none;
  border: none;
  color: var(--p2p-muted);
  font-size: 13px;
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 6px;
  transition: color 0.15s, background 0.15s;
}
.p2p-back:hover {
  color: var(--p2p-text);
  background: var(--p2p-surface2);
}
.p2p-close-btn {
  margin-inline-start: auto;
  background: var(--p2p-accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 8px 20px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}
.p2p-close-btn:hover {
  opacity: 0.85;
}

.p2p-host,
.p2p-guest {
  flex: 1;
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
  transform: scale(0.97);
}
</style>
