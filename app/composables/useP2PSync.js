// store-app/composables/useP2PSync.js
// UPDATED: order_payments added to ALL_TABLES and APPLY_ORDER
// Protocol v4 unchanged — only table lists updated.

const PEERJS_CDN =
  "https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js";
const QRCODE_CDN =
  "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";

// ── Table lists ───────────────────────────────────────────────────────────────
const ALL_TABLES = [
  "categories",
  "products",
  "customers",
  "orders",
  "order_items",
  "order_payments", // ← NEW
  "dues",
  "staff",
];

const APPLY_ORDER = [
  "categories",
  "customers",
  "staff",
  "products",
  "orders",
  "order_items",
  "order_payments", // ← NEW: after orders + order_items (FK constraint)
  "dues",
];

// ── Serial async queue ────────────────────────────────────────────────────────
const makeQueue = () => {
  let _tail = Promise.resolve();
  return (fn) => {
    _tail = _tail
      .then(() => fn())
      .catch((e) => console.error("[P2P] queue error:", e?.message ?? e));
    return _tail;
  };
};

const loadScript = (src) =>
  new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(s);
  });

const isElectron = () =>
  typeof window !== "undefined" && !!window.__ELECTRON__ && !!window.store;

const dumpTable = async (db, table) => {
  try {
    const r = await db.query(`SELECT * FROM "${table}"`);
    return r.values ?? [];
  } catch (e) {
    console.warn(`[P2P] dumpTable skipping "${table}":`, e?.message);
    return [];
  }
};

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export const useP2PSync = () => {
  const status = ref("idle");
  const statusMsg = ref("");
  const peerId = ref(null);
  const progress = ref({ current: 0, total: 0 });
  const error = ref(null);

  let _peer = null;
  let _conn = null;

  const setState = (s, msg = "") => {
    status.value = s;
    statusMsg.value = msg;
  };

  const flushIfMobile = async () => {
    if (isElectron()) return;
    try {
      const { flushMobileDb } = await import("./useMobileDb");
      await flushMobileDb();
      console.log("[P2P] Mobile DB flushed to Preferences");
    } catch (e) {
      console.warn("[P2P] flush error:", e?.message);
    }
  };

  // In useP2PSync.js — replace collectLocalData with this:
  const collectLocalData = async () => {
    const dump = {};
    const changedFieldsMap = {}; // { "table:rowId": ["field1", "field2"] }

    if (isElectron()) {
      for (const table of ALL_TABLES) {
        try {
          const r = await window.store.getRawTable(table);
          dump[table] = r.ok ? r.data : [];
        } catch (e) {
          dump[table] = [];
        }
      }
      // Get sync_queue to know which fields were locally changed
      try {
        const q = await window.store.getSyncQueue();
        if (q.ok) {
          for (const entry of q.data) {
            const key = `${entry.table_name}:${entry.row_id}`;
            const fields = entry.changed_fields
              ? JSON.parse(entry.changed_fields)
              : null;
            if (fields) {
              if (!changedFieldsMap[key]) changedFieldsMap[key] = new Set();
              for (const f of fields) changedFieldsMap[key].add(f);
            }
          }
          // Convert Sets to arrays
          for (const key of Object.keys(changedFieldsMap)) {
            changedFieldsMap[key] = [...changedFieldsMap[key]];
          }
        }
      } catch (e) {
        console.warn("[P2P] Could not collect changedFieldsMap:", e?.message);
      }
      return { dump, changedFieldsMap };
    }

    const { initMobileSchema } = await import("./useMobileSchema");
    await initMobileSchema();
    const { getMobileDb } = await import("./useMobileDb");
    const db = await getMobileDb();

    for (const table of ALL_TABLES) {
      dump[table] = await dumpTable(db, table);
    }

    // Get changed_fields from sync_queue
    try {
      const qRows =
        (
          await db.query(
            `SELECT table_name, row_id, changed_fields FROM sync_queue WHERE synced_at IS NULL AND (retry_count IS NULL OR retry_count < 5)`,
          )
        ).values ?? [];
      for (const entry of qRows) {
        const key = `${entry.table_name}:${entry.row_id}`;
        const fields = entry.changed_fields
          ? JSON.parse(entry.changed_fields)
          : null;
        if (fields) {
          if (!changedFieldsMap[key]) changedFieldsMap[key] = [];
          for (const f of fields) {
            if (!changedFieldsMap[key].includes(f))
              changedFieldsMap[key].push(f);
          }
        }
      }
    } catch (e) {
      console.warn("[P2P] Could not collect changedFieldsMap:", e?.message);
    }

    return { dump, changedFieldsMap };
  };

  // Replace applyRemoteDump signature:
  const applyRemoteDump = async (dump, changedFieldsMap = {}) => {
    const totalRows = APPLY_ORDER.reduce(
      (s, t) => s + (dump[t]?.length ?? 0),
      0,
    );
    let done = 0;
    progress.value = { current: 0, total: totalRows };

    if (isElectron()) {
      for (const table of APPLY_ORDER) {
        for (const row of dump[table] ?? []) {
          try {
            const key = `${table}:${row.id}`;
            const changedFields = changedFieldsMap[key] ?? null;
            await window.store.applyRemoteRow({ table, row, changedFields });
          } catch (e) {
            console.error(
              `[P2P] Electron applyRemoteRow [${table}]:`,
              e?.message,
            );
          }
          progress.value = { current: ++done, total: totalRows };
        }
      }
      return;
    }

    const { initMobileSchema } = await import("./useMobileSchema");
    await initMobileSchema();
    const { useMobileStore } = await import("./useMobileStore");
    const store = useMobileStore();

    for (const table of APPLY_ORDER) {
      for (const row of dump[table] ?? []) {
        try {
          const key = `${table}:${row.id}`;
          const changedFields = changedFieldsMap[key] ?? null;
          await store.applyRemoteRow({ table, row, changedFields });
        } catch (e) {
          console.error(
            `[P2P] applyRemoteRow [${table}] ${row?.id}:`,
            e?.message,
          );
        }
        progress.value = { current: ++done, total: totalRows };
      }
    }

    await flushIfMobile();
  };

  // Replace sendDump:
  const sendDump = async (conn) => {
    setState("syncing", "Collecting local data…");
    const { dump, changedFieldsMap } = await collectLocalData();
    const CHUNK_SIZE = 50;

    setState("syncing", "Sending data…");
    let sent = 0;
    const totalRows = ALL_TABLES.reduce(
      (s, t) => s + (dump[t]?.length ?? 0),
      0,
    );

    for (const table of ALL_TABLES) {
      const rows = dump[table] ?? [];
      for (const ch of chunk(rows, CHUNK_SIZE)) {
        conn.send({ type: "DATA", table, rows: ch });
        sent += ch.length;
        progress.value = { current: sent, total: totalRows };
        await new Promise((r) => setTimeout(r, 20));
      }
    }

    // Send the changed fields map so receiver knows what was intentionally edited
    conn.send({ type: "CHANGED_FIELDS_MAP", map: changedFieldsMap });

    await new Promise((r) => setTimeout(r, 100));
    conn.send({ type: "DONE" });
    console.log(`[P2P] Sent ${totalRows} rows + changedFieldsMap`);
  };

  const loadPeer = async () => {
    await loadScript(PEERJS_CDN);
    return window.Peer;
  };

  // ── HOST ──────────────────────────────────────────────────────────────────
  const startHost = async () => {
    setState("loading", "Preparing…");
    error.value = null;

    try {
      const Peer = await loadPeer();
      _peer = new Peer(undefined, {
        config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] },
      });

      _peer.on("open", (id) => {
        peerId.value = id;
        setState("ready", "Show this QR to the other device");
      });

      _peer.on("connection", (conn) => {
        _conn = conn;
        setState("connecting", "Device connected…");

        const enqueue = makeQueue();
        let buffer = {};
        let remoteChangedFieldsMap = {};

        conn.on("data", (msg) => {
          enqueue(async () => {
            if (!msg?.type) return;
            console.log(
              `[P2P] Host received: ${msg.type}` +
                (msg.table
                  ? ` table=${msg.table} rows=${msg.rows?.length ?? 0}`
                  : ""),
            );

            if (msg.type === "HELLO") {
              console.log("[P2P] Host sending HELLO_ACK");
              conn.send({ type: "HELLO_ACK" });
            }

            if (msg.type === "READY") {
              console.log("[P2P] Host received READY — starting sendDump");
              await sendDump(conn);
            }

            if (msg.type === "DATA") {
              if (!buffer[msg.table]) buffer[msg.table] = [];
              buffer[msg.table].push(...msg.rows);
            }

            if (msg.type === "CHANGED_FIELDS_MAP") {
              remoteChangedFieldsMap = msg.map ?? {};
            }

            if (msg.type === "DONE") {
              setState("syncing", "Merging guest data…");
              const toApply = buffer;
              const toApplyMap = remoteChangedFieldsMap;
              buffer = {};
              remoteChangedFieldsMap = {};
              await applyRemoteDump(toApply, toApplyMap); // pass the map
              conn.send({ type: "ACK" });
              await new Promise((r) => setTimeout(r, 300));
              useSyncTick().value++;
              setState("done", "Sync complete ✓");
              cleanup();
            }
          });
        });

        conn.on("open", () => {
          console.log("[P2P] Host: data channel open");
        });

        conn.on("error", (e) => {
          error.value = e.message;
          setState("error", e.message);
        });
      });

      _peer.on("error", (e) => {
        error.value = e.message;
        setState("error", e.message);
      });
    } catch (e) {
      error.value = e.message;
      setState("error", e.message);
    }
  };

  // ── GUEST ─────────────────────────────────────────────────────────────────
  const connectToHost = async (hostPeerId) => {
    setState("loading", "Connecting…");
    error.value = null;

    try {
      const Peer = await loadPeer();
      _peer = new Peer(undefined, {
        config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] },
      });

      _peer.on("open", () => {
        _conn = _peer.connect(hostPeerId, { reliable: true });

        const enqueue = makeQueue();
        let buffer = {};
        let remoteChangedFieldsMap = {};

        _conn.on("data", (msg) => {
          enqueue(async () => {
            if (!msg?.type) return;
            console.log(
              `[P2P] Guest received: ${msg.type}` +
                (msg.table
                  ? ` table=${msg.table} rows=${msg.rows?.length ?? 0}`
                  : ""),
            );

            if (msg.type === "HELLO_ACK") {
              console.log("[P2P] Guest received HELLO_ACK — sending READY");
              setState("syncing", "Receiving data from host…");
              await new Promise((r) => setTimeout(r, 50));
              _conn.send({ type: "READY" });
            }

            if (msg.type === "DATA") {
              if (!buffer[msg.table]) buffer[msg.table] = [];
              buffer[msg.table].push(...msg.rows);
            }

            if (msg.type === "CHANGED_FIELDS_MAP") {
              remoteChangedFieldsMap = msg.map ?? {};
            }

            if (msg.type === "DONE") {
              setState("syncing", "Merging host data…");
              const toApply = buffer;
              const toApplyMap = remoteChangedFieldsMap;
              buffer = {};
              remoteChangedFieldsMap = {};
              await applyRemoteDump(toApply, toApplyMap); // pass the map

              await new Promise((r) => setTimeout(r, 300));
              useSyncTick().value++;
              await sendDump(_conn);
            }

            if (msg.type === "ACK") {
              setState("done", "Sync complete ✓");
              cleanup();
            }
          });
        });

        _conn.on("open", () => {
          console.log("[P2P] Guest: data channel open — sending HELLO");
          setState("syncing", "Connected — handshaking…");
          _conn.send({ type: "HELLO" });
        });

        _conn.on("error", (e) => {
          error.value = e.message;
          setState("error", e.message);
        });
      });

      _peer.on("error", (e) => {
        error.value = e.message;
        setState("error", e.message);
      });
    } catch (e) {
      error.value = e.message;
      setState("error", e.message);
    }
  };

  const cleanup = () => {
    setTimeout(() => {
      try {
        _conn?.close();
      } catch {}
      try {
        _peer?.destroy();
      } catch {}
      _conn = null;
      _peer = null;
    }, 2000);
  };

  const reset = () => {
    cleanup();
    status.value = "idle";
    statusMsg.value = "";
    peerId.value = null;
    progress.value = { current: 0, total: 0 };
    error.value = null;
  };

  return {
    status: readonly(status),
    statusMsg: readonly(statusMsg),
    peerId: readonly(peerId),
    progress: readonly(progress),
    error: readonly(error),
    startHost,
    connectToHost,
    reset,
    loadQrLib: () => loadScript(QRCODE_CDN),
  };
};
