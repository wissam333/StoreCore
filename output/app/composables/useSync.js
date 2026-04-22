// composables/useSync.js
// Syncs the local SQLite "sync_queue" to a remote REST API.
// Call useSyncManager() from any page or the layout to show sync status.

import { useNetwork } from "@vueuse/core";

export const useSyncManager = () => {
  const { isOnline } = useNetwork();
  const { getSyncQueue, markSynced, getLastSyncedAt } = useClinic();
  const config = useRuntimeConfig();

  const isSyncing = ref(false);
  const lastSyncedAt = ref(null);
  const pendingCount = ref(0);
  const syncError = ref(null);

  // ── Load last sync time ───────────────────────────────────────────────────
  const loadLastSynced = async () => {
    const r = await getLastSyncedAt();
    if (r.ok) lastSyncedAt.value = r.data ? new Date(r.data) : null;
  };

  // ── Count pending ─────────────────────────────────────────────────────────
  const refreshPendingCount = async () => {
    const r = await getSyncQueue();
    pendingCount.value = r.ok ? (r.data?.length ?? 0) : 0;
  };

  // ── Core sync ─────────────────────────────────────────────────────────────
  const sync = async () => {
    if (!isOnline.value || isSyncing.value) return;
    const remoteBase = config.public.syncBase;
    if (!remoteBase) return; // sync not configured yet

    isSyncing.value = true;
    syncError.value = null;

    try {
      const r = await getSyncQueue();
      if (!r.ok || !r.data?.length) return;

      const queue = r.data; // [{id, table_name, operation, row_id, payload}]

      // Group by table for bulk requests
      const synced = [];
      for (const item of queue) {
        try {
          const payload = item.payload ? JSON.parse(item.payload) : {};
          const method =
            item.operation === "delete"
              ? "DELETE"
              : item.operation === "insert"
                ? "POST"
                : "PUT";

          const url =
            item.operation === "delete"
              ? `${remoteBase}/${item.table_name}/${item.row_id}`
              : `${remoteBase}/${item.table_name}`;

          await $fetch(url, { method, body: payload });
          synced.push(item.id);
        } catch (err) {
          // Per-item failure: skip but keep in queue
          console.warn(`Sync failed for queue item ${item.id}:`, err.message);
        }
      }

      if (synced.length) {
        await markSynced(synced);
        lastSyncedAt.value = new Date();
      }

      pendingCount.value = queue.length - synced.length;
    } catch (err) {
      syncError.value = err.message;
    } finally {
      isSyncing.value = false;
    }
  };

  // ── Auto-sync every 3 minutes when online ─────────────────────────────────
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
    // Sync immediately on mount if online
    if (isOnline.value) sync();
  });

  onUnmounted(() => stopAutoSync());

  // Re-sync when coming back online
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
