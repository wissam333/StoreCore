<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="modelValue" class="p2p-overlay" @click.self="tryClose">
        <div class="p2p-modal">
          <!-- Header -->
          <div class="p2p-header">
            <div class="p2p-header-icon">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              >
                <path
                  d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z"
                />
              </svg>
            </div>
            <div class="p2p-header-text">
              <h2 class="p2p-title">{{ $t("p2p.title") }}</h2>
              <p class="p2p-subtitle">{{ $t("p2p.subtitle") }}</p>
            </div>
            <button class="p2p-close" @click="tryClose">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Body -->
          <div class="p2p-body">
            <!-- Mode picker -->
            <div v-if="mode === 'pick'" class="p2p-pick">
              <p class="p2p-pick-label">{{ $t("p2p.pick.question") }}</p>
              <div class="p2p-pick-grid">
                <button class="p2p-pick-btn" @click="chooseMode('host')">
                  <div class="p2p-pick-icon">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <path d="M8 12h8M12 8v8" />
                    </svg>
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
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                    >
                      <path
                        d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                      />
                      <circle cx="12" cy="13" r="3" />
                    </svg>
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

            <!-- HOST VIEW -->
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
                  <svg
                    class="p2p-sync-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                  >
                    <path
                      d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                    />
                  </svg>
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

            <!-- GUEST VIEW -->
            <div v-else-if="mode === 'guest'" class="p2p-guest">
              <!-- Enter peer ID / scan -->
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
                <button
                  class="p2p-scan-btn"
                  @click="startScan"
                  :disabled="scanLoading"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                  >
                    <path
                      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                    />
                    <circle cx="12" cy="13" r="3" />
                  </svg>
                  <span v-if="scanLoading">{{
                    $t("p2p.guest.scanLoading") || "Opening camera…"
                  }}</span>
                  <span v-else>{{ $t("p2p.guest.openCamera") }}</span>
                </button>
                <!-- Hidden file input for native camera on mobile -->
                <input
                  ref="fileInputEl"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  class="p2p-file-input-hidden"
                  @change="onFileInputChange"
                />
              </div>

              <!-- Live camera scan -->
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
                  <!-- Hidden canvas used for frame capture -->
                  <canvas ref="canvasEl" class="p2p-canvas-hidden"></canvas>
                </div>
                <button class="p2p-cancel-scan" @click="stopScan">
                  {{ $t("p2p.guest.cancelScan") }}
                </button>
              </div>

              <!-- Syncing / Done / Error -->
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
                    <svg
                      class="p2p-sync-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                    >
                      <path
                        d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                      />
                    </svg>
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
import { ref, computed, watch, nextTick, onUnmounted } from "vue";
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

const mode = ref("pick");
const guestStep = ref("enter");
const manualId = ref("");
const scanLoading = ref(false);

const qrEl = ref(null);
const videoEl = ref(null);
const canvasEl = ref(null);
const fileInputEl = ref(null);

let _qrInstance = null;
let _videoStream = null;
let _scanRaf = null;
let _scanActive = false;

const progressPct = computed(() =>
  progress.value.total > 0
    ? Math.round((progress.value.current / progress.value.total) * 100)
    : 0,
);

const loadScript = (src) =>
  new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });

// ── QR rendering ─────────────────────────────────────────────────────────────
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
      correctLevel: window.QRCode.CorrectLevel.H, // H = highest error correction = easier to scan
    });
  } catch (e) {
    console.warn("[P2P] QR generation failed:", e);
  }
});

// ── Guest: manual connect ─────────────────────────────────────────────────────
const connectManual = () => {
  const id = manualId.value.trim();
  if (!id) return;
  guestStep.value = "sync";
  connectToHost(id);
};

// ── QR scan entry point ───────────────────────────────────────────────────────
// Strategy:
//   Native mobile (Capacitor) → file input with capture=environment
//   Web/Electron with getUserMedia → live video scan
//   Fallback → file input (no capture attr, opens gallery)
const startScan = async () => {
  scanLoading.value = true;

  // Try live camera first (works on web + Electron + modern mobile browsers)
  if (navigator.mediaDevices?.getUserMedia) {
    try {
      await startWebScan();
      scanLoading.value = false;
      return;
    } catch {
      // Denied or not supported — fall through to file input
    }
  }

  // Fallback: file input (native camera on mobile, gallery on desktop)
  scanLoading.value = false;
  await nextTick();
  fileInputEl.value?.click();
};

// ── File input → jsQR decode ──────────────────────────────────────────────────
const onFileInputChange = async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  scanLoading.value = true;
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("File read failed"));
      reader.readAsDataURL(file);
    });
    const qrId = await decodeQrFromDataUrl(dataUrl);
    if (qrId) {
      handleScannedId(qrId);
    } else {
      alert(
        "No QR code detected. Try holding your camera closer and steadier.",
      );
    }
  } catch (e) {
    console.warn("[P2P] File read error:", e);
  } finally {
    scanLoading.value = false;
    if (fileInputEl.value) fileInputEl.value.value = "";
  }
};

// ── Decode QR from dataUrl — tries multiple scales + filters ─────────────────
const decodeQrFromDataUrl = async (dataUrl) => {
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.js");
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // Try multiple scale factors — far/small QR codes often need scaling up
      const scales = [1, 2, 1.5, 0.75, 3];
      for (const scale of scales) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        // Enhance contrast to help with difficult captures
        ctx.filter = "contrast(1.5) brightness(1.1) saturate(0)";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx.filter = "none";
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = window.jsQR(imageData.data, canvas.width, canvas.height, {
          inversionAttempts: "attemptBoth",
        });
        if (code?.data) {
          console.log(`[P2P] QR decoded at scale ${scale}`);
          resolve(code.data);
          return;
        }
      }
      resolve(null);
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
};

// ── Live camera scan ──────────────────────────────────────────────────────────
const startWebScan = async () => {
  // Request high-resolution rear camera
  _videoStream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  });

  guestStep.value = "scan";
  await nextTick();

  if (videoEl.value) {
    videoEl.value.srcObject = _videoStream;
    await videoEl.value.play().catch(() => {});
  }

  // Load jsQR in parallel while camera warms up
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.js");

  _scanActive = true;
  scheduleScan();
};

const stopScan = () => {
  _scanActive = false;
  if (_scanRaf) {
    cancelAnimationFrame(_scanRaf);
    _scanRaf = null;
  }
  if (_videoStream) {
    _videoStream.getTracks().forEach((t) => t.stop());
    _videoStream = null;
  }
  guestStep.value = "enter";
};

// Use requestAnimationFrame for smooth scanning — much faster than setTimeout
const scheduleScan = () => {
  if (!_scanActive) return;
  _scanRaf = requestAnimationFrame(scanFrame);
};

let _lastScanTime = 0;
const SCAN_INTERVAL_MS = 100; // scan at most 10 times/sec to avoid CPU overload

const scanFrame = async (timestamp) => {
  if (!_scanActive) return;

  // Throttle to SCAN_INTERVAL_MS
  if (timestamp - _lastScanTime < SCAN_INTERVAL_MS) {
    scheduleScan();
    return;
  }
  _lastScanTime = timestamp;

  const video = videoEl.value;
  const canvas = canvasEl.value;
  if (!video || !canvas || !_videoStream) {
    scheduleScan();
    return;
  }
  if (video.readyState < 2 || video.videoWidth === 0) {
    scheduleScan();
    return;
  }

  const W = video.videoWidth;
  const H = video.videoHeight;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  try {
    // Try BarcodeDetector first — native, very fast, works at any distance
    if ("BarcodeDetector" in window) {
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      const codes = await detector.detect(video);
      if (codes.length > 0) {
        handleScannedId(codes[0].rawValue);
        return;
      }
    } else {
      // jsQR fallback — draw frame with contrast boost
      ctx.filter = "contrast(1.4) brightness(1.05) saturate(0)";
      ctx.drawImage(video, 0, 0, W, H);
      ctx.filter = "none";
      const imageData = ctx.getImageData(0, 0, W, H);
      const code = window.jsQR(imageData.data, W, H, {
        inversionAttempts: "attemptBoth",
      });
      if (code?.data) {
        handleScannedId(code.data);
        return;
      }
    }
  } catch (e) {
    // ignore scan errors, keep trying
  }

  scheduleScan();
};

// ── Handle scanned ID ─────────────────────────────────────────────────────────
const handleScannedId = (id) => {
  if (!id?.trim()) return;
  stopScan();
  manualId.value = id.trim();
  guestStep.value = "sync";
  connectToHost(id.trim());
};

// ── Navigation ────────────────────────────────────────────────────────────────
const goBack = () => {
  stopScan();
  reset();
  mode.value = "pick";
  guestStep.value = "enter";
  manualId.value = "";
  _qrInstance = null;
};

const tryClose = () => {
  if (status.value === "syncing") return;
  handleClose();
};

const handleClose = () => {
  if (status.value === "done") emit("synced");
  stopScan();
  reset();
  mode.value = "pick";
  guestStep.value = "enter";
  manualId.value = "";
  scanLoading.value = false;
  _qrInstance = null;
  emit("update:modelValue", false);
};

onUnmounted(() => {
  stopScan();
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
  font-family: "Tajawal", system-ui, sans-serif;
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
.p2p-header-icon svg {
  width: 20px;
  height: 20px;
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
  transition: color 0.15s, background 0.15s;
  flex-shrink: 0;
}
.p2p-close:hover {
  color: var(--p2p-text);
  background: var(--p2p-surface2);
}
.p2p-close svg {
  width: 18px;
  height: 18px;
  display: block;
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
.p2p-pick-icon svg {
  width: 22px;
  height: 22px;
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
  width: 28px;
  height: 28px;
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
  font-family: monospace;
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
.p2p-scan-btn svg {
  width: 18px;
  height: 18px;
  color: var(--p2p-accent);
}

.p2p-file-input-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
  overflow: hidden;
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
