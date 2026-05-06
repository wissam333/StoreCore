<!-- store-app/pages/dashboard/orders/new.vue -->
<template>
  <div>
    <SharedUiHeaderPage
      :title="isEdit ? $t('editOrder') : $t('newOrder')"
      :subtitle="isEdit ? $t('editOrderSubtitle') : $t('newOrderSubtitle')"
      icon="mdi:receipt-text-plus-outline"
      show-back
      :back-to="
        isEdit ? '/dashboard/orders/' + route.params.id : '/dashboard/orders'
      "
      :is-rtl="locale === 'ar'"
    />

    <div class="order-layout">
      <!-- ── LEFT column ──────────────────────────────────────────────────── -->
      <div class="order-main">
        <!-- Customer card -->
        <div class="form-card">
          <div class="card-head">
            <Icon name="mdi:account-outline" size="18" />
            <h4>{{ $t("customer") }}</h4>
            <span v-if="!selectedCustomer" class="optional-badge">{{
              $t("optional")
            }}</span>
            <span v-else class="selected-badge">
              <Icon name="mdi:check-circle" size="12" />
              {{ selectedCustomer.name }}
            </span>
          </div>
          <SharedUiFormCombobox
            v-model="selectedCustomer"
            v-model:search="customerSearch"
            :options="customerSuggestions"
            :loading="customerLoading"
            :label="$t('customerName')"
            :placeholder="$t('typeCustomerName')"
            :allow-create="true"
            :create-label="$t('createNew')"
            display-key="name"
            sub-key="phone"
            @update:search="onCustomerSearch"
            @create="onCreateCustomer"
          />
        </div>

        <!-- ── BARCODE SCANNER CARD ──────────────────────────────────────── -->
        <div class="form-card scanner-card">
          <div class="card-head">
            <Icon name="mdi:barcode-scan" size="18" />
            <h4>{{ $t("scanToAdd") || "Scan to Add Product" }}</h4>
            <span v-if="isElectronEnv" class="hw-ready-badge">
              <span class="hw-dot" />
              {{ $t("scannerReady") || "Scanner Ready" }}
            </span>
          </div>

          <Transition name="scan-flash">
            <div
              v-if="scanFeedback"
              class="scan-feedback"
              :class="scanFeedback.type"
            >
              <Icon
                :name="
                  scanFeedback.type === 'success'
                    ? 'mdi:check-circle'
                    : 'mdi:alert-circle'
                "
                size="16"
              />
              {{ scanFeedback.msg }}
            </div>
          </Transition>

          <div class="scanner-row">
            <div
              class="barcode-field"
              :class="{ 'barcode-field--scanning': webCameraOpen }"
            >
              <Icon name="mdi:barcode" size="17" class="barcode-field-icon" />
              <input
                ref="barcodeInputRef"
                v-model="barcodeInput"
                class="barcode-input"
                :placeholder="
                  $t('typeBarcodeOrScan') || 'Type barcode or scan…'
                "
                @keydown.enter.prevent="onManualBarcode"
              />
              <button
                v-if="!isElectronEnv"
                class="barcode-cam-btn"
                :class="{ active: webCameraOpen }"
                :disabled="scanLoading"
                @click="toggleWebCamera"
                :title="$t('openCamera') || 'Open Camera'"
              >
                <Icon
                  :name="
                    scanLoading
                      ? 'mdi:loading'
                      : webCameraOpen
                      ? 'mdi:close'
                      : 'mdi:camera'
                  "
                  size="18"
                  :class="{ spin: scanLoading }"
                />
              </button>
              <button
                class="barcode-go-btn"
                :disabled="!barcodeInput.trim()"
                @click="onManualBarcode"
              >
                <Icon name="mdi:arrow-right" size="16" />
              </button>
            </div>
          </div>

          <!--
            KEY FIX: v-show (not v-if) + NO <Transition> around the camera panel.
            On Capacitor, <Transition name="camera-slide"> with v-if delays DOM
            insertion past nextTick, so videoEl.value is null when we try to set
            srcObject — stream is acquired but never attached, frames never flow.
            v-show keeps <video> always in the DOM so we can attach immediately.
          -->
          <div v-show="webCameraOpen" class="camera-panel">
            <div class="camera-viewport">
              <video
                ref="videoEl"
                class="camera-video"
                autoplay
                playsinline
                muted
              />
              <canvas ref="canvasEl" class="camera-canvas-hidden" />
              <div class="scan-overlay">
                <div class="scan-frame">
                  <div class="scan-line" />
                  <span class="sf-corner sf-tl" />
                  <span class="sf-corner sf-tr" />
                  <span class="sf-corner sf-bl" />
                  <span class="sf-corner sf-br" />
                </div>
              </div>
              <p class="camera-hint">
                {{
                  $t("pointCameraAtBarcode") ||
                  "Point camera at barcode or QR code"
                }}
              </p>
            </div>
            <div v-if="cameraError" class="camera-error">
              <Icon name="mdi:alert-circle-outline" size="14" />
              {{ cameraError }}
            </div>
            <button class="camera-close-btn" @click="closeWebCamera">
              <Icon name="mdi:close" size="15" />
              {{ $t("cancel") }}
            </button>
          </div>

          <p class="scanner-hint">
            <template v-if="isElectronEnv">{{
              $t("hwScannerHint") ||
              "Hardware scanner is active — scan any barcode to instantly add it to the order."
            }}</template>
            <template v-else>{{
              $t("mobileScannerHint") ||
              "Type a barcode and press Enter, or tap the camera icon to scan."
            }}</template>
          </p>
        </div>

        <!-- Items — empty state -->
        <div v-if="!items.length" class="items-empty">
          <div class="empty-icon-wrap">
            <Icon name="mdi:cart-outline" size="40" />
          </div>
          <p>{{ $t("noItemsYet") }}</p>
          <SharedUiButtonBase
            size="sm"
            variant="primary"
            icon-left="mdi:plus"
            @click="addItem"
          >
            {{ $t("addFirstItem") }}
          </SharedUiButtonBase>
        </div>

        <!-- Items list -->
        <div v-else class="items-list">
          <TransitionGroup name="item-anim">
            <div
              v-for="(item, idx) in items"
              :key="item._key"
              class="item-card"
              :class="{ 'item-card--fresh': item._fresh }"
            >
              <div class="item-top">
                <div class="item-product">
                  <SharedUiFormBaseSelect
                    v-model="item.product_id"
                    :options="productOptions"
                    :placeholder="$t('selectProduct')"
                    searchable
                    @change="onProductSelect(idx, $event)"
                  />
                  <div class="item-tags">
                    <span
                      v-if="item._maxStock !== null"
                      class="stock-tag"
                      :class="
                        item._maxStock === 0
                          ? 'stock-out'
                          : item._maxStock <= 5
                          ? 'stock-low'
                          : ''
                      "
                    >
                      <Icon
                        :name="
                          item._maxStock === 0
                            ? 'mdi:close-circle'
                            : 'mdi:cube-outline'
                        "
                        size="11"
                      />
                      {{
                        item._maxStock === 0
                          ? $t("outOfStock")
                          : `${$t("inStock")}: ${item._maxStock}`
                      }}
                    </span>
                    <span v-if="item._maxStock === 0" class="error-tag">{{
                      $t("cannotAddOutOfStock")
                    }}</span>
                    <span
                      v-if="
                        item.quantity > item._maxStock &&
                        item._maxStock !== null &&
                        item._maxStock > 0
                      "
                      class="warn-tag"
                    >
                      <Icon name="mdi:alert" size="11" />{{
                        $t("exceedsStock")
                      }}
                    </span>
                    <span v-if="item._scanned" class="scanned-tag">
                      <Icon name="mdi:barcode-scan" size="11" />{{
                        $t("scanned") || "Scanned"
                      }}
                    </span>
                  </div>
                </div>
                <button class="del-btn" @click="removeItem(idx)">
                  <Icon name="mdi:trash-can-outline" size="16" />
                </button>
              </div>

              <div class="item-bottom">
                <div class="item-field">
                  <label class="field-label">{{ $t("price") }}</label>
                  <SharedUiFormBaseInput
                    v-model.number="item.sell_price_at_sale"
                    type="number"
                    min="0"
                    step="any"
                    :class="{ 'input-error': item.sell_price_at_sale <= 0 }"
                  />
                </div>
                <div class="item-field item-field--cur">
                  <label class="field-label">{{ $t("cur") }}</label>
                  <SharedUiFormBaseSelect
                    v-model="item.currency_at_sale"
                    :options="currencyOpts"
                  />
                </div>
                <div class="item-field item-field--qty">
                  <label class="field-label">{{ $t("qty") }}</label>
                  <div class="qty-control">
                    <button
                      class="qty-btn"
                      :disabled="item.quantity <= 1"
                      @click="
                        item.quantity = Math.max(1, (item.quantity || 1) - 1)
                      "
                    >
                      <Icon name="mdi:minus" size="14" />
                    </button>
                    <SharedUiFormBaseInput
                      v-model.number="item.quantity"
                      type="number"
                      min="1"
                      :max="item._maxStock > 0 ? item._maxStock : undefined"
                      class="qty-input"
                      @blur="clampQty(idx)"
                    />
                    <button
                      class="qty-btn"
                      :disabled="
                        item._maxStock !== null &&
                        item.quantity >= item._maxStock
                      "
                      @click="
                        item.quantity = Math.min(
                          item._maxStock > 0 ? item._maxStock : 9999,
                          (item.quantity || 1) + 1,
                        )
                      "
                    >
                      <Icon name="mdi:plus" size="14" />
                    </button>
                  </div>
                </div>
                <div class="item-total">
                  <label class="field-label">{{ $t("lineTotal") }}</label>
                  <strong>{{ lineTotalDisplay(item) }}</strong>
                </div>
              </div>
            </div>
          </TransitionGroup>
          <button class="add-item-btn" @click="addItem">
            <Icon name="mdi:plus" size="16" />{{ $t("addItem") }}
          </button>
        </div>

        <div class="form-card">
          <SharedUiFormBaseTextarea
            v-model="orderNotes"
            :label="$t('notes')"
            :placeholder="$t('orderNotesPlaceholder')"
            :rows="3"
          />
        </div>
      </div>

      <!-- ── RIGHT sidebar ────────────────────────────────────────────────── -->
      <div class="order-sidebar">
        <div class="form-card summary-card">
          <div class="card-head">
            <Icon name="mdi:calculator-outline" size="18" />
            <h4>{{ $t("orderSummary") }}</h4>
          </div>
          <div v-if="items.length" class="summary-items-count">
            <Icon name="mdi:cart-outline" size="14" />
            {{ items.length }} {{ $t("items") }} · {{ totalQty }}
            {{ $t("units") }}
          </div>
          <div class="totals-block">
            <div
              v-for="item in items"
              :key="item._key"
              class="line-item-summary"
            >
              <span class="lis-name">{{
                item.product_name || $t("product")
              }}</span>
              <span class="lis-val">{{ lineTotalDisplay(item) }}</span>
            </div>
            <div class="total-line total-line--grand">
              <span>{{ $t("total") }}</span>
              <strong class="grand-val">{{ fmtSP(grandTotalSP) }}</strong>
            </div>
          </div>
          <div class="payment-info-box">
            <Icon name="mdi:information-outline" size="16" />
            <div class="payment-info-text">
              <strong>{{ $t("paymentAfterCreate") }}</strong>
              <span>{{ $t("paymentAfterCreateDesc") }}</span>
            </div>
          </div>
          <div v-if="validationErrors.length" class="validation-errors">
            <div v-for="err in validationErrors" :key="err" class="val-error">
              <Icon name="mdi:alert-circle-outline" size="13" />{{ err }}
            </div>
          </div>
          <SharedUiButtonBase
            class="save-btn"
            size="lg"
            icon-left="mdi:content-save-outline"
            :loading="saving"
            :disabled="!canSave"
            @click="save"
          >
            {{ isEdit ? $t("saveChanges") : $t("createOrder") }}
          </SharedUiButtonBase>
          <div v-if="!items.length" class="save-hint">
            {{ $t("addItemsFirst") }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted } from "vue";

definePageMeta({
  searchMeta: {
    label: "New Order",
    labelAr: "طلب جديد",
    icon: "mdi:receipt-text-plus-outline",
    group: "Main",
  },
});

const route = useRoute();
const { locale, t: $t } = useI18n();
const { $toast } = useNuxtApp();
const {
  getCustomers,
  findOrCreateCustomer,
  getProducts,
  getOrderById,
  saveOrder,
} = useStore();
const { fmtSP, fmtTx, toSP, loadSettings } = useCurrency();

const isEdit = computed(
  () => !!route.params.id && route.path.includes("/edit"),
);
const isElectronEnv = typeof window !== "undefined" && !!window.electronAPI;

const currencyOpts = [
  { label: "SP (ل.س)", value: "SP" },
  { label: "USD ($)", value: "USD" },
];

// ── Customer ──────────────────────────────────────────────────────────────────
const customerSearch = ref("");
const customerSuggestions = ref([]);
const customerLoading = ref(false);
const selectedCustomer = ref(null);
let customerTimer;

const onCustomerSearch = (val) => {
  customerSearch.value = val;
  clearTimeout(customerTimer);
  if (!val.trim()) {
    customerSuggestions.value = [];
    return;
  }
  customerLoading.value = true;
  customerTimer = setTimeout(async () => {
    const r = await getCustomers({ search: val, limit: 8 });
    if (r.ok) customerSuggestions.value = r.data;
    customerLoading.value = false;
  }, 250);
};

const onCreateCustomer = async (name) => {
  const r = await findOrCreateCustomer(name);
  if (r.ok) {
    selectedCustomer.value = r.data;
    customerSearch.value = r.data.name;
    $toast.success($t("customerCreated"));
  } else $toast.error(r.error);
};

// ── Products ──────────────────────────────────────────────────────────────────
const allProducts = ref([]);
const productOptions = computed(() =>
  allProducts.value.map((p) => ({
    label: `${p.name}  ·  ${p.stock} ${p.unit}  ·  ${p.sell_price} ${p.currency}`,
    value: p.id,
  })),
);

// ── Items ─────────────────────────────────────────────────────────────────────
let _keyCounter = 0;
const items = ref([]);

const addItem = () =>
  items.value.push({
    _key: ++_keyCounter,
    product_id: null,
    product_name: "",
    quantity: 1,
    sell_price_at_sale: 0,
    currency_at_sale: "SP",
    _maxStock: null,
    _scanned: false,
    _fresh: false,
  });

const removeItem = (idx) => items.value.splice(idx, 1);

const onProductSelect = (idx, productId) => {
  const p = allProducts.value.find((x) => x.id === productId);
  if (!p) return;
  const item = items.value[idx];
  item.product_name = p.name;
  item.sell_price_at_sale = p.sell_price;
  item.currency_at_sale = p.currency;
  item._maxStock = p.stock;
  item.quantity = p.stock > 0 ? 1 : 0;
};

const clampQty = (idx) => {
  const item = items.value[idx];
  item.quantity = Math.max(
    1,
    Math.min(item.quantity || 1, item._maxStock > 0 ? item._maxStock : 9999),
  );
};

// ── Totals ────────────────────────────────────────────────────────────────────
const lineTotalSP = (item) =>
  toSP(item.sell_price_at_sale * (item.quantity || 1), item.currency_at_sale);
const lineTotalDisplay = (item) =>
  fmtTx(
    item.sell_price_at_sale * (item.quantity || 1),
    item.currency_at_sale,
    lineTotalSP(item),
  );
const grandTotalSP = computed(() =>
  items.value.reduce((s, i) => s + lineTotalSP(i), 0),
);
const totalQty = computed(() =>
  items.value.reduce((s, i) => s + (i.quantity || 0), 0),
);

// ── Validation ────────────────────────────────────────────────────────────────
const validationErrors = computed(() => {
  const errs = [];
  if (!items.value.length) return errs;
  if (items.value.some((i) => !i.product_id))
    errs.push($t("selectProductForAllItems"));
  if (items.value.some((i) => !i.quantity || i.quantity < 1))
    errs.push($t("qtyMustBeAtLeastOne"));
  if (items.value.some((i) => i._maxStock !== null && i._maxStock === 0))
    errs.push($t("removeOutOfStockItems"));
  if (
    items.value.some(
      (i) =>
        i._maxStock !== null && i._maxStock > 0 && i.quantity > i._maxStock,
    )
  )
    errs.push($t("someItemsExceedStock"));
  if (items.value.some((i) => i.product_id && i.sell_price_at_sale <= 0))
    errs.push($t("priceCannotBeZero"));
  return errs;
});
const canSave = computed(
  () => items.value.length > 0 && validationErrors.value.length === 0,
);

// ─────────────────────────────────────────────────────────────────────────────
// BARCODE SCANNER
// ─────────────────────────────────────────────────────────────────────────────
const barcodeInputRef = ref(null);
const barcodeInput = ref("");
const scanLoading = ref(false);
const cameraError = ref("");
const webCameraOpen = ref(false);
const videoEl = ref(null); // always in DOM via v-show
const canvasEl = ref(null); // always in DOM via v-show
const scanFeedback = ref(null);
let _feedbackTimer = null;

const showFeedback = (type, msg) => {
  scanFeedback.value = { type, msg };
  clearTimeout(_feedbackTimer);
  _feedbackTimer = setTimeout(() => {
    scanFeedback.value = null;
  }, 2500);
};

const handleBarcode = (code) => {
  const barcode = (code ?? "").trim();
  if (!barcode) return;
  const product = allProducts.value.find(
    (p) => p.barcode && p.barcode.trim() === barcode,
  );
  if (!product) {
    showFeedback(
      "error",
      `${$t("barcodeNotFound") || "Product not found"}: ${barcode}`,
    );
    barcodeInput.value = barcode;
    return;
  }
  if (product.stock === 0) {
    showFeedback("error", `${product.name} — ${$t("outOfStock")}`);
    return;
  }
  const existing = items.value.find((i) => i.product_id === product.id);
  if (existing) {
    const newQty = (existing.quantity || 1) + 1;
    if (existing._maxStock !== null && newQty > existing._maxStock) {
      showFeedback("error", `${product.name} — ${$t("exceedsStock")}`);
      return;
    }
    existing.quantity = newQty;
    showFeedback("success", `${product.name} ×${existing.quantity}`);
  } else {
    const newItem = {
      _key: ++_keyCounter,
      product_id: product.id,
      product_name: product.name,
      quantity: 1,
      sell_price_at_sale: product.sell_price,
      currency_at_sale: product.currency,
      _maxStock: product.stock,
      _scanned: true,
      _fresh: true,
    };
    items.value.push(newItem);
    setTimeout(() => {
      const idx = items.value.findIndex((i) => i._key === newItem._key);
      if (idx !== -1) items.value[idx]._fresh = false;
    }, 1200);
    showFeedback("success", `${product.name} added`);
  }
  barcodeInput.value = "";
  nextTick(() => barcodeInputRef.value?.focus());
};

const onManualBarcode = () => {
  const code = barcodeInput.value.trim();
  if (!code) return;
  handleBarcode(code);
};

// ── HW scanner (Electron) ─────────────────────────────────────────────────────
let _hwBuffer = "",
  _hwTimer = null;
const _onHwKey = (e) => {
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return;
  if (["Shift", "Control", "Alt", "Meta", "Tab"].includes(e.key)) return;
  if (e.key === "Enter") {
    const code = _hwBuffer.trim();
    _hwBuffer = "";
    clearTimeout(_hwTimer);
    if (code.length > 2) handleBarcode(code);
    return;
  }
  _hwBuffer += e.key;
  clearTimeout(_hwTimer);
  _hwTimer = setTimeout(() => {
    const code = _hwBuffer.trim();
    _hwBuffer = "";
    if (code.length > 2) handleBarcode(code);
  }, 80);
};

// ── Web camera ────────────────────────────────────────────────────────────────
const JSQR_CDN = "https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.js";
let _webStream = null,
  _webRaf = null,
  _webActive = false,
  _barcodeDetector = null,
  _lastFrameTime = 0;
const FRAME_INTERVAL_MS = 200;

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

const _webScanFrame = async (ts) => {
  if (!_webActive) return;
  if (ts - _lastFrameTime < FRAME_INTERVAL_MS) {
    _webRaf = requestAnimationFrame(_webScanFrame);
    return;
  }
  _lastFrameTime = ts;
  const video = videoEl.value;
  const canvas = canvasEl.value;
  if (
    !video ||
    !canvas ||
    !_webStream ||
    video.readyState < 4 ||
    video.videoWidth === 0
  ) {
    _webRaf = requestAnimationFrame(_webScanFrame);
    return;
  }
  const W = video.videoWidth,
    H = video.videoHeight;
  const size = Math.min(W, H) * 0.75;
  const sx = (W - size) / 2,
    sy = (H - size) / 2;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  try {
    ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
    if (_barcodeDetector) {
      const codes = await _barcodeDetector.detect(canvas);
      if (codes.length > 0) {
        closeWebCamera();
        handleBarcode(codes[0].rawValue);
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
      const result = window.jsQR(
        ctx.getImageData(0, 0, size, size).data,
        size,
        size,
        { inversionAttempts: "attemptBoth" },
      );
      if (result?.data) {
        closeWebCamera();
        handleBarcode(result.data);
        return;
      }
    }
  } catch {
    /* ignore per-frame errors */
  }
  if (_webActive) _webRaf = requestAnimationFrame(_webScanFrame);
};

const openWebCamera = async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraError.value = $t("cameraNotAvailable") || "Camera not available.";
    return;
  }
  try {
    cameraError.value = "";
    scanLoading.value = true;

    _webStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });

    // KEY FIX: videoEl is always in DOM (v-show), no nextTick needed — attach immediately
    webCameraOpen.value = true;
    videoEl.value.srcObject = _webStream;

    // Wait for canplay — the real signal on Capacitor that frames are flowing
    await new Promise((resolve) => {
      const onCanPlay = () => {
        videoEl.value?.removeEventListener("canplay", onCanPlay);
        resolve();
      };
      videoEl.value.addEventListener("canplay", onCanPlay);
      videoEl.value.play().catch(() => {});
      setTimeout(resolve, 3000); // safety fallback
    });

    await _loadJsQr().catch(() => {});

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

    _webActive = true;
    _lastFrameTime = 0;
    _webRaf = requestAnimationFrame(_webScanFrame);
  } catch (e) {
    cameraError.value =
      e.name === "NotAllowedError"
        ? $t("cameraPermissionDenied") || "Camera permission denied."
        : $t("cameraOpenFailed") || "Could not open camera.";
    _webStream?.getTracks().forEach((t) => t.stop());
    _webStream = null;
    webCameraOpen.value = false;
  } finally {
    scanLoading.value = false;
  }
};

const closeWebCamera = () => {
  _webActive = false;
  if (_webRaf) {
    cancelAnimationFrame(_webRaf);
    _webRaf = null;
  }
  if (_webStream) {
    _webStream.getTracks().forEach((t) => t.stop());
    _webStream = null;
  }
  if (videoEl.value) videoEl.value.srcObject = null;
  _barcodeDetector = null;
  webCameraOpen.value = false;
  cameraError.value = "";
};

const toggleWebCamera = async () => {
  if (webCameraOpen.value) {
    closeWebCamera();
    return;
  }
  await openWebCamera();
};

// ── Save ──────────────────────────────────────────────────────────────────────
const saving = ref(false);
const orderNotes = ref("");

const save = async () => {
  if (!canSave.value) return;
  if (!selectedCustomer.value && customerSearch.value.trim())
    await onCreateCustomer(customerSearch.value.trim());
  saving.value = true;
  const r = await saveOrder({
    order: {
      id: isEdit.value ? route.params.id : undefined,
      customer_id: selectedCustomer.value?.id ?? null,
      order_date: new Date().toISOString(),
      paid_amount: 0,
      display_currency: items.value.every((i) => i.currency_at_sale === "USD")
        ? "USD"
        : "SP",
      notes: orderNotes.value,
    },
    items: items.value.map((i) => ({
      product_id: i.product_id,
      product_name:
        i.product_name ||
        allProducts.value.find((p) => p.id === i.product_id)?.name ||
        "Unknown",
      quantity: i.quantity,
      sell_price_at_sale: i.sell_price_at_sale,
      currency_at_sale: i.currency_at_sale,
    })),
  });
  saving.value = false;
  if (r.ok) {
    $toast.success($t(isEdit.value ? "orderUpdated" : "orderCreated"));
    navigateTo("/dashboard/orders/" + r.id);
  } else $toast.error(r.error);
};

// ── Load for edit ─────────────────────────────────────────────────────────────
const loadEdit = async () => {
  if (!isEdit.value || !route.params.id) return;
  const r = await getOrderById(route.params.id);
  if (!r.ok) return;
  const o = r.data;
  if (o.customer_id) {
    selectedCustomer.value = { id: o.customer_id, name: o.customer_name ?? "" };
    customerSearch.value = o.customer_name ?? "";
  }
  orderNotes.value = o.notes ?? "";
  items.value = (o.items ?? []).map((i) => ({
    _key: ++_keyCounter,
    product_id: i.product_id,
    product_name: i.product_name,
    quantity: i.quantity,
    sell_price_at_sale: i.sell_price_at_sale,
    currency_at_sale: i.currency_at_sale,
    _maxStock: i.current_stock ?? null,
    _scanned: false,
    _fresh: false,
  }));
};

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  await loadSettings();
  const r = await getProducts({ limit: 500, activeOnly: true });
  if (r.ok) allProducts.value = r.data;
  await loadEdit();
  if (isElectronEnv) window.addEventListener("keydown", _onHwKey);
  _loadJsQr().catch(() => {});
});

onUnmounted(() => {
  if (isElectronEnv) {
    window.removeEventListener("keydown", _onHwKey);
    clearTimeout(_hwTimer);
  }
  closeWebCamera();
  clearTimeout(_feedbackTimer);
});
</script>

<style lang="scss" scoped>
.order-layout {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 1.5rem;
  align-items: start;
  @media (max-width: 991px) {
    grid-template-columns: 1fr;
  }
}
.order-main {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.order-sidebar {
  position: sticky;
  top: 16px;
}

.form-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 1.5rem;
}

.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 1.25rem;
  color: var(--text-sub);
  h4 {
    font-size: 0.95rem;
    font-weight: 700;
    margin: 0;
    flex: 1;
    color: var(--text-primary);
  }
}
.optional-badge {
  font-size: 0.7rem;
  background: var(--bg-elevated);
  color: var(--text-muted);
  padding: 2px 8px;
  border-radius: 20px;
}
.selected-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.7rem;
  font-weight: 600;
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  padding: 2px 8px;
  border-radius: 20px;
}

.scanner-card {
  border-color: var(--primary);
  background: linear-gradient(
    135deg,
    var(--bg-surface) 0%,
    color-mix(in srgb, var(--primary) 4%, var(--bg-surface)) 100%
  );
}
.hw-ready-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.68rem;
  font-weight: 600;
  padding: 3px 10px;
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  border-radius: 20px;
  white-space: nowrap;
}
.hw-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
  animation: pulse-dot 1.8s ease-in-out infinite;
}
@keyframes pulse-dot {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.4;
    transform: scale(0.7);
  }
}

.scan-feedback {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 10px;
  font-size: 0.82rem;
  font-weight: 600;
  margin-bottom: 12px;
  &.success {
    background: rgba(16, 185, 129, 0.1);
    color: #10b981;
    border: 1px solid rgba(16, 185, 129, 0.25);
  }
  &.error {
    background: rgba(239, 68, 68, 0.08);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.2);
  }
}
.scan-flash-enter-active {
  transition: all 0.2s ease;
}
.scan-flash-leave-active {
  transition: all 0.3s ease;
}
.scan-flash-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}
.scan-flash-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.scanner-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.barcode-field {
  flex: 1;
  display: flex;
  align-items: center;
  background: var(--bg-elevated);
  border: 1.5px solid var(--border-color);
  border-radius: 10px;
  overflow: hidden;
  transition: border-color 0.15s, box-shadow 0.15s;
  &:focus-within {
    border-color: var(--primary);
    box-shadow: 0 0 0 3px rgba(var(--primary-rgb, 211, 47, 47), 0.08);
  }
  &--scanning {
    border-color: var(--primary);
  }
}
.barcode-field-icon {
  padding: 0 10px;
  color: var(--text-muted);
  flex-shrink: 0;
}
.barcode-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  padding: 10px 4px;
  font-size: 0.88rem;
  color: var(--text-primary);
  font-family: monospace;
  letter-spacing: 0.04em;
  min-width: 0;
  &::placeholder {
    color: var(--text-muted);
    font-family: "Tajawal", sans-serif;
    letter-spacing: 0;
    font-size: 0.82rem;
  }
}
.barcode-cam-btn {
  background: none;
  border: none;
  border-inline-start: 1px solid var(--border-color);
  width: 42px;
  height: 40px;
  cursor: pointer;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: color 0.15s, background 0.15s;
  &:hover,
  &.active {
    background: var(--primary-soft);
    color: var(--primary);
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .spin {
    animation: spin 0.8s linear infinite;
  }
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.barcode-go-btn {
  background: var(--primary);
  border: none;
  border-start-end-radius: 8px;
  border-end-end-radius: 8px;
  border-start-start-radius: 0;
  border-end-start-radius: 0;
  width: 38px;
  height: 40px;
  cursor: pointer;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: opacity 0.15s;
  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  &:not(:disabled):hover {
    opacity: 0.85;
  }
}
.scanner-hint {
  font-size: 0.72rem;
  color: var(--text-muted);
  margin: 10px 0 0;
  line-height: 1.5;
}

.camera-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
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
.scan-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.scan-frame {
  position: relative;
  width: 60%;
  aspect-ratio: 1;
  &::before {
    content: "";
    position: absolute;
    inset: -9999px;
    box-shadow: inset 0 0 0 9999px rgba(0, 0, 0, 0.45);
    border-radius: 10px;
    pointer-events: none;
  }
}
.scan-line {
  position: absolute;
  inset-inline: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--primary), transparent);
  animation: scanline 2s ease-in-out infinite;
}
@keyframes scanline {
  0%,
  100% {
    top: 5%;
  }
  50% {
    top: 93%;
  }
}
.sf-corner {
  position: absolute;
  width: 18px;
  height: 18px;
  border-color: var(--primary);
  border-style: solid;
}
.sf-tl {
  inset-block-start: 0;
  inset-inline-start: 0;
  border-width: 3px 0 0 3px;
  border-start-start-radius: 3px;
}
.sf-tr {
  inset-block-start: 0;
  inset-inline-end: 0;
  border-width: 3px 3px 0 0;
  border-start-end-radius: 3px;
}
.sf-bl {
  inset-block-end: 0;
  inset-inline-start: 0;
  border-width: 0 0 3px 3px;
  border-end-start-radius: 3px;
}
.sf-br {
  inset-block-end: 0;
  inset-inline-end: 0;
  border-width: 0 3px 3px 0;
  border-end-end-radius: 3px;
}
.camera-hint {
  position: absolute;
  inset-block-end: 8px;
  inset-inline: 0;
  text-align: center;
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.75);
  margin: 0;
  padding: 0 12px;
}
.camera-error {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  color: #ef4444;
  background: rgba(239, 68, 68, 0.07);
  border-radius: 8px;
  padding: 8px 12px;
  border: 1px solid rgba(239, 68, 68, 0.15);
}
.camera-close-btn {
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

.items-empty {
  background: var(--bg-surface);
  border: 2px dashed var(--border-color);
  border-radius: 16px;
  text-align: center;
  padding: 2.5rem 2rem;
  color: var(--text-muted);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  transition: border-color 0.2s;
  &:hover {
    border-color: var(--primary);
  }
  p {
    margin: 0;
    font-size: 0.9rem;
  }
}
.empty-icon-wrap {
  width: 72px;
  height: 72px;
  border-radius: 20px;
  background: var(--bg-elevated);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}

.items-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.item-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: border-color 0.15s, box-shadow 0.15s, background 0.4s;
  &:hover {
    border-color: var(--primary);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  }
  &--fresh {
    border-color: #10b981 !important;
    background: rgba(16, 185, 129, 0.04);
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12);
  }
}
.item-top {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  .item-product {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
}
.item-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.stock-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 0.68rem;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 20px;
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  &.stock-out {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
  }
  &.stock-low {
    background: rgba(245, 158, 11, 0.1);
    color: #f59e0b;
  }
}
.error-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 0.68rem;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 20px;
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}
.warn-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 0.68rem;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 20px;
  background: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
}
.scanned-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 0.68rem;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 20px;
  background: rgba(99, 102, 241, 0.1);
  color: #6366f1;
}

.item-bottom {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}
.item-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 90px;
  min-width: 80px;
  &--cur {
    flex: 0 1 105px;
  }
  &--qty {
    flex: 0 1 130px;
  }
}
.field-label {
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  margin: 0;
}
.qty-control {
  display: flex;
  align-items: center;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-elevated);
}
.qty-btn {
  width: 32px;
  height: 34px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--text-sub);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
  &:hover:not(:disabled) {
    background: var(--primary-soft);
    color: var(--primary);
  }
  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
}
.qty-input {
  flex: 1;
  text-align: center;
  border: none !important;
  border-radius: 0 !important;
  background: transparent !important;
  min-width: 0;
}
.item-total {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 0 0 auto;
  text-align: end;
  min-width: 80px;
  strong {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--primary);
    white-space: nowrap;
  }
}
.input-error {
  border-color: #ef4444 !important;
}
.add-item-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border: 1.5px dashed var(--border-color);
  border-radius: 12px;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  width: 100%;
  justify-content: center;
  transition: all 0.18s;
  &:hover {
    border-color: var(--primary);
    color: var(--primary);
    background: var(--primary-soft);
  }
}
.del-btn {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border: none;
  background: rgba(239, 68, 68, 0.07);
  border-radius: 8px;
  cursor: pointer;
  color: #ef4444;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
  margin-top: 2px;
  &:hover {
    background: rgba(239, 68, 68, 0.18);
  }
}

.summary-card {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}
.summary-items-count {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  color: var(--text-muted);
  padding: 6px 10px;
  background: var(--bg-elevated);
  border-radius: 8px;
}
.totals-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border-color);
}
.line-item-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.8rem;
  color: var(--text-sub);
  gap: 8px;
}
.lis-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: 0.78rem;
}
.lis-val {
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  font-size: 0.8rem;
}
.total-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.9rem;
  color: var(--text-sub);
  &--grand {
    font-size: 1rem;
    font-weight: 700;
    color: var(--text-primary);
    padding-top: 8px;
    border-top: 1px solid var(--border-color);
    margin-top: 4px;
  }
}
.grand-val {
  font-size: 1.25rem;
  color: var(--primary);
  font-weight: 800;
}
.payment-info-box {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px 14px;
  background: rgba(6, 182, 212, 0.06);
  border: 1px solid rgba(6, 182, 212, 0.2);
  border-radius: 10px;
  color: #06b6d4;
  font-size: 0.78rem;
  flex-shrink: 0;
}
.payment-info-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  line-height: 1.4;
  strong {
    font-size: 0.8rem;
    display: block;
  }
  span {
    color: var(--text-muted);
    font-size: 0.73rem;
  }
}
.validation-errors {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px 12px;
  background: rgba(239, 68, 68, 0.06);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 10px;
}
.val-error {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: #ef4444;
  font-weight: 500;
}
.save-btn {
  width: 100%;
}
.save-hint {
  text-align: center;
  font-size: 0.72rem;
  color: var(--text-muted);
  margin-top: -4px;
}

.item-anim-enter-active {
  transition: all 0.25s ease;
}
.item-anim-leave-active {
  transition: all 0.2s ease;
}
.item-anim-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}
.item-anim-leave-to {
  opacity: 0;
  transform: translateX(12px);
}
</style>
