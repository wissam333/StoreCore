// composables/useScanner.js
// Unified barcode scanner — no native plugins required.
// Works on: Electron (HW scanner via keydown), Android WebView (getUserMedia),
// and desktop browsers (getUserMedia + BarcodeDetector / jsQR fallback).

import { ref } from "vue";

// ── Environment ───────────────────────────────────────────────────────────────
const isElectron = () => typeof window !== "undefined" && !!window.electronAPI;

// Capacitor mobile WebView: getUserMedia IS available, no plugin needed.
// We treat it exactly like a web camera — same code path.
const isCapacitor = () =>
  typeof window !== "undefined" && !!window.Capacitor?.isNativePlatform?.();

// ── jsQR CDN loader ───────────────────────────────────────────────────────────
const JSQR_CDN = "https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.js";

const loadJsQr = () =>
  new Promise((resolve, reject) => {
    if (window.jsQR) return resolve();
    const existing = document.querySelector(`script[src="${JSQR_CDN}"]`);
    if (existing) {
      if (window.jsQR) return resolve();
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

// ── Shared reactive state (singleton across all useScanner() calls) ───────────
const isScanning = ref(false);
const scanError = ref("");

// ─────────────────────────────────────────────────────────────────────────────
// HARDWARE SCANNER (Electron)
// HW scanners send keystrokes very fast then fire Enter.
// We buffer keys and flush when Enter arrives or after a short idle timeout.
// ─────────────────────────────────────────────────────────────────────────────
let _hwBuffer = "";
let _hwTimer = null;
let _hwCallback = null;
const HW_TIMEOUT_MS = 80;

const _onHwKey = (e) => {
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return;
  if (["Shift", "Control", "Alt", "Meta", "Tab"].includes(e.key)) return;

  if (e.key === "Enter") {
    const code = _hwBuffer.trim();
    _hwBuffer = "";
    clearTimeout(_hwTimer);
    if (code.length > 2) _hwCallback?.(code);
    return;
  }

  _hwBuffer += e.key;
  clearTimeout(_hwTimer);
  _hwTimer = setTimeout(() => {
    const code = _hwBuffer.trim();
    _hwBuffer = "";
    if (code.length > 2) _hwCallback?.(code);
  }, HW_TIMEOUT_MS);
};

const _startHw = (onScan) => {
  _hwCallback = onScan;
  _hwBuffer = "";
  window.addEventListener("keydown", _onHwKey);
  isScanning.value = true;
};

const _stopHw = () => {
  window.removeEventListener("keydown", _onHwKey);
  clearTimeout(_hwTimer);
  _hwCallback = null;
  _hwBuffer = "";
  isScanning.value = false;
};

// ─────────────────────────────────────────────────────────────────────────────
// CAMERA SCANNER — Web browser + Android WebView + Capacitor WebView
// All three use getUserMedia. No native plugin needed.
// Uses BarcodeDetector (native Chrome API) first, jsQR as fallback.
// ─────────────────────────────────────────────────────────────────────────────
let _webStream = null;
let _webRaf = null;
let _webActive = false;
let _webCallback = null;
let _barcodeDetector = null;
let _lastFrameTime = 0;
const FRAME_INTERVAL_MS = 200;

let _activeVideoEl = null;
let _activeCanvasEl = null;

const _webScanFrame = async (ts) => {
  if (!_webActive) return;

  if (ts - _lastFrameTime < FRAME_INTERVAL_MS) {
    _webRaf = requestAnimationFrame(_webScanFrame);
    return;
  }
  _lastFrameTime = ts;

  const video = _activeVideoEl;
  const canvas = _activeCanvasEl;

  if (!video || !canvas || video.readyState < 4 || video.videoWidth === 0) {
    _webRaf = requestAnimationFrame(_webScanFrame);
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

    // ── BarcodeDetector (Chrome 83+, Android WebView, Electron ≥22) ──────────
    if (_barcodeDetector) {
      const codes = await _barcodeDetector.detect(canvas);
      if (codes.length > 0) {
        const val = codes[0].rawValue;
        _stopWeb();
        _webCallback?.(val);
        return;
      }
    }

    // ── jsQR fallback ─────────────────────────────────────────────────────────
    if (window.jsQR) {
      const imageData = ctx.getImageData(0, 0, size, size);
      // Contrast boost improves QR decode rates
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        let g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        g = g < 128 ? g * 0.7 : 128 + (g - 128) * 1.3;
        g = Math.max(0, Math.min(255, g));
        d[i] = d[i + 1] = d[i + 2] = g;
      }
      ctx.putImageData(imageData, 0, 0);

      const result = window.jsQR(
        ctx.getImageData(0, 0, size, size).data,
        size,
        size,
        { inversionAttempts: "attemptBoth" },
      );
      if (result?.data) {
        const val = result.data;
        _stopWeb();
        _webCallback?.(val);
        return;
      }
    }
  } catch {
    /* ignore per-frame decode errors */
  }

  if (_webActive) _webRaf = requestAnimationFrame(_webScanFrame);
};

const _startWeb = async ({ onScan, videoEl, canvasEl }) => {
  if (!navigator.mediaDevices?.getUserMedia) {
    scanError.value = "Camera not available. Please type the barcode manually.";
    return;
  }

  // videoEl and canvasEl are required for the camera preview
  if (!videoEl || !canvasEl) {
    scanError.value = "Scanner UI elements not ready. Please try again.";
    return;
  }

  try {
    scanError.value = "";
    _webCallback = onScan;
    _activeVideoEl = videoEl;
    _activeCanvasEl = canvasEl;

    // On Capacitor/Android: prefer environment (rear) camera.
    // On desktop: environment may not exist, browser will fall back gracefully.
    _webStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });

    videoEl.srcObject = _webStream;
    await videoEl.play().catch(() => {});

    // 1500ms stabilisation delay — proven reliable on Android WebView
    await new Promise((r) => setTimeout(r, 1500));

    // Load jsQR in background (may already be cached)
    await loadJsQr().catch(() => {});

    // Try native BarcodeDetector
    if ("BarcodeDetector" in window) {
      try {
        _barcodeDetector = new window.BarcodeDetector({
          formats: [
            "qr_code",
            "ean_13",
            "ean_8",
            "code_128",
            "code_39",
            "code_93",
            "upc_a",
            "upc_e",
            "itf",
            "codabar",
            "data_matrix",
            "pdf417",
          ],
        });
      } catch {
        _barcodeDetector = null;
      }
    }

    _webActive = true;
    isScanning.value = true;
    _lastFrameTime = 0;
    _webRaf = requestAnimationFrame(_webScanFrame);
  } catch (e) {
    if (e.name === "NotAllowedError") {
      scanError.value = "Camera permission denied. Please allow camera access.";
    } else {
      scanError.value =
        "Could not open camera. Please type the barcode manually.";
    }
    isScanning.value = false;
  }
};

const _stopWeb = () => {
  _webActive = false;
  if (_webRaf) {
    cancelAnimationFrame(_webRaf);
    _webRaf = null;
  }
  if (_webStream) {
    _webStream.getTracks().forEach((t) => t.stop());
    _webStream = null;
  }
  _barcodeDetector = null;
  _webCallback = null;
  _activeVideoEl = null;
  _activeCanvasEl = null;
  isScanning.value = false;
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────
export const useScanner = () => {
  /**
   * startScan({ onScan, videoEl?, canvasEl? })
   *
   * Electron  → activates hardware scanner keydown listener (always-on, no UI needed)
   * Web / Mobile / Capacitor → opens getUserMedia camera (requires videoEl + canvasEl)
   *
   * onScan(barcode: string) is called once when a code is detected.
   * Camera stops automatically after the first successful scan.
   */
  const startScan = async ({
    onScan,
    videoEl = null,
    canvasEl = null,
  } = {}) => {
    scanError.value = "";
    if (isElectron()) {
      _startHw(onScan);
    } else {
      // Both web browsers AND Capacitor WebView use the same camera path
      await _startWeb({ onScan, videoEl, canvasEl });
    }
  };

  /**
   * stopScan() — call on component unmount or when closing the camera panel.
   */
  const stopScan = () => {
    if (isElectron()) _stopHw();
    else _stopWeb();
  };

  return {
    startScan,
    stopScan,
    isScanning,
    scanError,
    isElectron,
    isCapacitor,
  };
};
