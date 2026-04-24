// store-app/composables/useStoreSync.js
// Two-phase sync: push local outbox → remote, then pull remote changes → local.
// Auth uses the activated license key as the Bearer token.

import { useNetwork } from "@vueuse/core";

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

  // ── Helpers ──────────────────────────────────────────────────────────────
  const loadLastSynced = async () => {
    const r = await getLastSyncedAt();
    if (r.ok) lastSyncedAt.value = r.data ? new Date(r.data) : null;
  };

  const refreshPendingCount = async () => {
    const r = await getSyncQueue();
    pendingCount.value = r.ok ? r.data?.length ?? 0 : 0;
  };

  // Reads sync_base + license_key from settings.
  // license_key is saved automatically on activation — no manual token needed.
  const getRemoteConfig = async () => {
    const r = await getSettings();
    if (!r.ok) return null;
    const base = r.data?.sync_base?.trim();
    const licenseKey = r.data?.license_key?.trim();
    if (!base || !licenseKey) return null;
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

          if (res.status === 401) {
            // Wrong or expired license — stop immediately, no point retrying
            throw new Error("Unauthorized — check license key in Settings");
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          synced.push(item.id);
        } catch (err) {
          // Re-throw auth errors to surface them in the UI
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
    if (!cfg) return; // no sync_base or license_key configured yet

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
