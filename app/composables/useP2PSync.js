// store-app/composables/useP2PSync.js
// UPDATED: CDN loadScript replaced with npm imports (peerjs, qrcodejs2-fixes)
// Protocol v4 unchanged — only table lists updated.

import Peer from "peerjs";
import QRCode from "qrcodejs2-fixes";

// ── Table lists ───────────────────────────────────────────────────────────────
const ALL_TABLES = [
  "categories",
  "products",
  "customers",
  "orders",
  "order_items",
  "order_payments",
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
  "order_payments",
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

const isElectron = () =>
  typeof window !== "undefined" && !!window.__ELECTRON__ && !!window.store;

// ── PeerJS server lifecycle ───────────────────────────────────────────────────
let _localIp = "127.0.0.1";

const startLocalServer = async () => {
  if (!isElectron()) return; // mobile/web: skip, uses cloud PeerJS
  try {
    const result = await window.electronAPI.p2pStartServer();
    if (result?.ok) {
      _localIp = result.ip;
      console.log("[P2P] Local server started, IP:", _localIp);
    } else {
      throw new Error(result?.error ?? "Server start failed");
    }
  } catch (e) {
    throw new Error("[P2P] Could not start local PeerJS server: " + e?.message);
  }
};

const stopLocalServer = async () => {
  if (!isElectron()) return;
  try {
    await window.electronAPI.p2pStopServer();
    console.log("[P2P] Local server stopped");
  } catch (e) {
    console.warn("[P2P] Server stop error:", e?.message);
  }
};

// ── Peer factory — always points to local server in Electron ─────────────────
const makePeer = () => {
  if (isElectron()) {
    return new Peer(undefined, {
      host: "127.0.0.1", // renderer always talks to local server
      port: 9000,
      path: "/myapp",
      config: { iceServers: [] }, // LAN only — no STUN needed
    });
  }
  // Fallback for non-Electron (web/mobile): use cloud PeerJS
  return new Peer(undefined, {
    config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] },
  });
};

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

  const collectLocalData = async () => {
    const dump = {};
    const changedFieldsMap = {};

    if (isElectron()) {
      for (const table of ALL_TABLES) {
        try {
          const r = await window.store.getRawTable(table);
          dump[table] = r.ok ? r.data : [];
        } catch (e) {
          dump[table] = [];
        }
      }
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

    conn.send({ type: "CHANGED_FIELDS_MAP", map: changedFieldsMap });
    await new Promise((r) => setTimeout(r, 100));
    conn.send({ type: "DONE" });
    console.log(`[P2P] Sent ${totalRows} rows + changedFieldsMap`);
  };

  // ── HOST ──────────────────────────────────────────────────────────────────
  const startHost = async () => {
    setState("loading", "Preparing…");
    error.value = null;

    try {
      // Start the local PeerJS server FIRST
      await startLocalServer();

      _peer = makePeer();

      _peer.on("open", (id) => {
        // Encode LAN IP + peer ID so guest knows where to connect
        // Format: "192.168.1.5|peer-id-here"
        peerId.value = isElectron() ? `${_localIp}|${id}` : id;
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
            console.log(`[P2P] Host received: ${msg.type}`);

            if (msg.type === "HELLO") {
              conn.send({ type: "HELLO_ACK" });
            }
            if (msg.type === "READY") {
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
              await applyRemoteDump(toApply, toApplyMap);
              conn.send({ type: "ACK" });
              await new Promise((r) => setTimeout(r, 300));
              useSyncTick().value++;
              setState("done", "Sync complete ✓");
              cleanup();
            }
          });
        });

        conn.on("open", () => console.log("[P2P] Host: data channel open"));
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

  // ── GUEST ───────────────────────────────────────────────────────────────────
  const connectToHost = async (scanned) => {
    setState("loading", "Connecting…");
    error.value = null;

    // Decode the scanned value — may contain "ip|peerId" or just "peerId"
    let hostIp = "127.0.0.1";
    let hostPeerId = scanned;

    if (scanned.includes("|")) {
      const parts = scanned.split("|");
      hostIp = parts[0];
      hostPeerId = parts[1];
    }

    try {
      // Guest also starts the local server (needed if guest is also Electron)
      // If guest is a phone/tablet, this is a no-op
      if (isElectron()) await startLocalServer();

      _peer = isElectron()
        ? new Peer(undefined, {
            host: hostIp, // ← connect to HOST machine's IP
            port: 9000,
            path: "/myapp",
            config: { iceServers: [] },
          })
        : new Peer(undefined, {
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
            console.log(`[P2P] Guest received: ${msg.type}`);

            if (msg.type === "HELLO_ACK") {
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
              await applyRemoteDump(toApply, toApplyMap);
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

  // ── Cleanup — stops server when session ends ─────────────────────────────
  const cleanup = () => {
    setTimeout(async () => {
      try {
        _conn?.close();
      } catch {}
      try {
        _peer?.destroy();
      } catch {}
      _conn = null;
      _peer = null;
      await stopLocalServer(); // ← stop server after sync is done
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

  const makeQrCode = (el, text) => {
    return new QRCode(el, {
      text,
      width: 160,
      height: 160,
      colorDark: "#0f172a",
      colorLight: "#f8fafc",
      correctLevel: QRCode.CorrectLevel.M,
    });
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
    makeQrCode,
  };
};
