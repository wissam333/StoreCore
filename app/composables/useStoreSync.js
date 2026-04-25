// store-app/composables/useStoreSync.js
// Two-phase sync: push local outbox → remote, then pull remote changes → local.
// Auth uses the activated license key as the Bearer token.
//
// FIX: getRemoteConfig() previously read license_key only from SQLite settings.
// On mobile, persistToSettings() is deferred and often hasn't written the key
// yet (or failed silently), so license_key in SQLite was empty → cfg was null
// → sync() returned immediately with no error → "sync complete" with no data.
//
// NEW: license key is read from the correct source per platform:
//   Mobile  → Capacitor Preferences (written synchronously during activate())
//   Electron → window.license.getKey() via IPC
//   Fallback → SQLite settings (for any edge case)

import { useNetwork } from "@vueuse/core";

// ── Read license key from the authoritative source for this platform ──────────
const getLicenseKey = async () => {
  // Electron: IPC bridge
  if (
    typeof window !== "undefined" &&
    window.__ELECTRON__ &&
    window.license?.getKey
  ) {
    try {
      return (await window.license.getKey()) ?? null;
    } catch {}
  }

  // Native mobile: Capacitor Preferences — always written synchronously by activate()
  if (
    typeof window !== "undefined" &&
    window?.Capacitor?.isNativePlatform?.()
  ) {
    try {
      const { Preferences } = await import("@capacitor/preferences");
      const r = await Preferences.get({ key: "license_key" });
      return r?.value ?? null;
    } catch {}
  }

  // Fallback: SQLite settings (web/dev or if Preferences unavailable)
  return null;
};

export const useStoreSyncManager = () => {
  const { isOnline } = useNetwork();
  const {
    getSyncQueue,
    markSynced,
    getLastSyncedAt,
    applyRemoteRow,
    setLastSyncedAt,
    getSettings,
  } = useStore();

  const isSyncing = ref(false);
  const lastSyncedAt = ref(null);
  const pendingCount = ref(0);
  const syncError = ref(null);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const loadLastSynced = async () => {
    const r = await getLastSyncedAt();
    if (r.ok) lastSyncedAt.value = r.data ? new Date(r.data) : null;
  };

  const refreshPendingCount = async () => {
    const r = await getSyncQueue();
    pendingCount.value = r.ok ? r.data?.length ?? 0 : 0;
  };

  // ── Remote config ─────────────────────────────────────────────────────────
  // sync_base comes from SQLite settings (user-editable in the Settings page).
  // license_key comes from the authoritative platform source — NOT SQLite —
  // because the SQLite mirror may be empty if persistToSettings() failed.
  const getRemoteConfig = async () => {
    // Always read sync_base from SQLite settings
    const r = await getSettings();
    const base = r.ok ? r.data?.sync_base?.trim() : "";

    if (!base) return null;

    // Read license key from the correct platform source
    let licenseKey = await getLicenseKey();

    // Final fallback: SQLite (covers Electron dev mode / web)
    if (!licenseKey && r.ok) {
      licenseKey = r.data?.license_key?.trim() ?? "";
    }

    if (!licenseKey) return null;

    return { base, token: licenseKey };
  };

  const PUSH_ORDER = {
    categories: 1,
    customers: 2,
    staff: 3,
    products: 4,
    orders: 5,
    order_items: 6,
    dues: 7,
  };

  // ── PHASE 1: Push ─────────────────────────────────────────────────────────
  const push = async (base, token) => {
    let hasMore = true;

    while (hasMore) {
      const r = await getSyncQueue();
      if (!r.ok || !r.data?.length) break;

      const batch = r.data.slice(0, 50);
      batch.sort(
        (a, b) =>
          (PUSH_ORDER[a.table_name] || 99) - (PUSH_ORDER[b.table_name] || 99),
      );
      const synced = [];

      for (const item of batch) {
        try {
          const payload = item.payload ? JSON.parse(item.payload) : {};
          const headers = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          };

          let url, method;
          if (item.operation === "delete") {
            method = "DELETE";
            url = `${base}/${item.table_name}/${item.row_id}`;
          } else if (item.operation === "insert") {
            method = "POST";
            url = `${base}/${item.table_name}`;
          } else {
            method = "PUT";
            url = `${base}/${item.table_name}/${item.row_id}`;
          }

          const res = await fetch(url, {
            method,
            headers,
            body: method !== "DELETE" ? JSON.stringify(payload) : undefined,
          });

          if (res.status === 401)
            throw new Error("Unauthorized — check license key in Settings");
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          synced.push(item.id);
        } catch (err) {
          if (err.message.includes("Unauthorized")) throw err;
          console.warn(
            `[store-sync] Push failed for queue item ${item.id}:`,
            err.message,
          );
        }
      }

      if (synced.length) await markSynced(synced);
      hasMore = r.data.length > 50;
    }
  };

  // ── PHASE 2: Pull ─────────────────────────────────────────────────────────
  const pull = async (base, token) => {
    const since = lastSyncedAt.value
      ? lastSyncedAt.value.toISOString()
      : "1970-01-01T00:00:00.000Z";

    const headers = { Authorization: `Bearer ${token}` };
    let offset = 0;
    const limit = 200;
    let hasMore = true;
    let latestRowTs = null;

    while (hasMore) {
      const res = await fetch(
        `${base}/changes?since=${encodeURIComponent(
          since,
        )}&limit=${limit}&offset=${offset}`,
        { headers },
      );
      if (res.status === 401)
        throw new Error("Unauthorized — check license key in Settings");
      if (!res.ok) throw new Error(`Pull failed: HTTP ${res.status}`);

      const json = await res.json();
      const rows = json.rows ?? [];

      for (const { table, row } of rows) {
        await applyRemoteRow({ table, row });
        if (row.updated_at && (!latestRowTs || row.updated_at > latestRowTs)) {
          latestRowTs = row.updated_at;
        }
      }

      hasMore = json.hasMore ?? false;
      offset += limit;
    }

    const newWatermark = latestRowTs ?? new Date().toISOString();
    await setLastSyncedAt(newWatermark);
    lastSyncedAt.value = new Date(newWatermark);
  };

  // ── Full sync cycle ───────────────────────────────────────────────────────
  const sync = async () => {
    if (!isOnline.value || isSyncing.value) return;

    const cfg = await getRemoteConfig();
    if (!cfg) {
      // Make the reason visible in the UI instead of silently doing nothing
      console.warn(
        "[store-sync] Skipping sync — no sync_base or license key configured",
      );
      syncError.value = "Sync not configured — check Settings";
      return;
    }

    isSyncing.value = true;
    syncError.value = null;

    try {
      await push(cfg.base, cfg.token);
      await pull(cfg.base, cfg.token);
      await refreshPendingCount();
      useSyncTick().value++;
    } catch (err) {
      syncError.value = err.message;
      console.error("[store-sync] Sync error:", err);
    } finally {
      isSyncing.value = false;
    }
  };

  // ── Auto-sync every 3 minutes ─────────────────────────────────────────────
  let intervalId = null;
  const startAutoSync = () => {
    intervalId = setInterval(() => {
      if (isOnline.value) sync();
    }, 3 * 60 * 1000);
  };
  const stopAutoSync = () => {
    if (intervalId) clearInterval(intervalId);
  };

  onMounted(async () => {
    await loadLastSynced();
    await refreshPendingCount();
    startAutoSync();
    if (isOnline.value) sync();
  });

  onUnmounted(() => stopAutoSync());

  watch(isOnline, (online) => {
    if (online) sync();
  });

  return {
    isSyncing: readonly(isSyncing),
    lastSyncedAt: readonly(lastSyncedAt),
    pendingCount: readonly(pendingCount),
    syncError: readonly(syncError),
    isOnline,
    sync,
    refreshPendingCount,
  };
};
