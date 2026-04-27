// store-app/composables/useP2PSync.js
//
// Peer-to-peer local sync using PeerJS (WebRTC data channels).
// No internet required — works on the same WiFi/LAN network.
//
// PROTOCOL (sequential, no races):
//   1. Guest connects → sends HELLO
//   2. Host receives HELLO → collects FRESH dump → sends DATA+DONE
//   3. Guest receives DONE → merges → flushes → ticks UI → sends DATA+DONE
//   4. Host receives DONE → merges → flushes → ticks UI → sends ACK
//   5. Guest receives ACK → done
//
// KEY FIX (v3):
//   On mobile/Capacitor the WebRTC data channel can deliver messages
//   BEFORE the PeerJS 'open' event fires on the guest side. Registering
//   conn.on('data') inside conn.on('open') means those early DATA messages
//   are dropped — the listener isn't attached yet. Result: buffer is empty
//   when DONE arrives, so "Applying 0 remote rows".
//
//   Fix: attach the 'data' listener IMMEDIATELY after _peer.connect() returns
//   the DataConnection object, before 'open' fires. The serial queue (makeQueue)
//   is still needed to prevent async handlers racing each other.

const PEERJS_CDN =
  "https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js";
const QRCODE_CDN =
  "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";

const ALL_TABLES = [
  "categories",
  "products",
  "customers",
  "orders",
  "order_items",
  "dues",
  "staff",
];

// FK-safe apply order
const APPLY_ORDER = [
  "categories",
  "customers",
  "staff",
  "products",
  "orders",
  "order_items",
  "dues",
];

// ── Serial async queue ────────────────────────────────────────────────────────
// Returns an `enqueue(fn)` function. Every fn() is awaited before the next
// one starts. This is the core fix: it prevents DONE from racing ahead of DATA.
const makeQueue = () => {
  let _tail = Promise.resolve();
  return (fn) => {
    _tail = _tail
      .then(() => fn())
      .catch((e) => {
        console.error("[P2P] queue error:", e?.message ?? e);
      });
    return _tail;
  };
};

// ── Load script from CDN (idempotent) ─────────────────────────────────────────
const loadScript = (src) =>
  new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(s);
  });

// ── Platform detection ────────────────────────────────────────────────────────
const isElectron = () =>
  typeof window !== "undefined" && !!window.__ELECTRON__ && !!window.store;

// ── Dump all rows for a table via sql.js ─────────────────────────────────────
const dumpTable = async (db, table) => {
  try {
    const r = await db.query(`SELECT * FROM "${table}"`);
    return r.values ?? [];
  } catch (e) {
    console.warn(`[P2P] dumpTable skipping "${table}":`, e?.message);
    return [];
  }
};

// ── Chunk large arrays ────────────────────────────────────────────────────────
const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// ── Main composable ───────────────────────────────────────────────────────────
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

  // ── Flush mobile db — force immediate persistence ──────────────────────────
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

  // ── Collect all rows — always fresh, never cached ─────────────────────────
  const collectLocalData = async () => {
    if (isElectron()) {
      const dump = {};
      for (const table of ALL_TABLES) {
        try {
          const r = await window.store.getRawTable(table);
          dump[table] = r.ok ? r.data : [];
          console.log(
            `[P2P] Electron dump ${table}: ${dump[table].length} rows`,
          );
        } catch (e) {
          console.warn(`[P2P] Electron dump failed [${table}]:`, e?.message);
          dump[table] = [];
        }
      }
      return dump;
    }

    // Mobile — init schema once, then dump
    const { initMobileSchema } = await import("./useMobileSchema");
    await initMobileSchema();
    const { getMobileDb } = await import("./useMobileDb");
    const db = await getMobileDb();
    const dump = {};
    for (const table of ALL_TABLES) {
      dump[table] = await dumpTable(db, table);
      console.log(`[P2P] Mobile dump ${table}: ${dump[table].length} rows`);
    }
    return dump;
  };

  // ── Apply a full incoming dump ─────────────────────────────────────────────
  const applyRemoteDump = async (dump) => {
    const totalRows = APPLY_ORDER.reduce(
      (s, t) => s + (dump[t]?.length ?? 0),
      0,
    );
    let done = 0;
    progress.value = { current: 0, total: totalRows };
    console.log(`[P2P] Applying ${totalRows} remote rows`);

    if (isElectron()) {
      for (const table of APPLY_ORDER) {
        for (const row of dump[table] ?? []) {
          try {
            await window.store.applyRemoteRow({ table, row });
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

    // ── Mobile path ────────────────────────────────────────────────────────
    const { initMobileSchema } = await import("./useMobileSchema");
    await initMobileSchema();

    const { useMobileStore } = await import("./useMobileStore");
    const store = useMobileStore();

    for (const table of APPLY_ORDER) {
      for (const row of dump[table] ?? []) {
        try {
          await store.applyRemoteRow({ table, row });
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
    console.log(`[P2P] Applied and persisted ${totalRows} rows`);
  };

  // ── Send local data to peer ────────────────────────────────────────────────
  const sendDump = async (conn) => {
    setState("syncing", "Collecting local data…");
    const dump = await collectLocalData();
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
        // Small yield — lets PeerJS flush the send buffer
        await new Promise((r) => setTimeout(r, 15));
      }
    }
    conn.send({ type: "DONE" });
    console.log(`[P2P] Sent ${totalRows} rows`);
  };

  const loadPeer = async () => {
    await loadScript(PEERJS_CDN);
    return window.Peer;
  };

  // ── HOST ───────────────────────────────────────────────────────────────────
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

        // ── Register data listener BEFORE open fires ───────────────────────
        // Some PeerJS versions / network conditions can deliver the first
        // message during the open handshake. Listening early is safe — the
        // underlying DataChannel won't deliver app messages before open,
        // but PeerJS may buffer and replay them. Belt-and-suspenders.
        conn.on("data", (msg) => {
          enqueue(async () => {
            if (!msg?.type) return;
            console.log(
              `[P2P] Host received: ${msg.type}${
                msg.table
                  ? " table=" + msg.table + " rows=" + (msg.rows?.length ?? 0)
                  : ""
              }`,
            );

            if (msg.type === "HELLO") {
              await sendDump(conn);
            }

            if (msg.type === "DATA") {
              if (!buffer[msg.table]) buffer[msg.table] = [];
              buffer[msg.table].push(...msg.rows);
            }

            if (msg.type === "DONE") {
              const totalBuffered = Object.values(buffer).reduce(
                (s, r) => s + r.length,
                0,
              );
              console.log(
                `[P2P] Host received DONE — buffer has ${totalBuffered} rows`,
              );
              setState("syncing", "Merging guest data…");
              const toApply = buffer;
              buffer = {};
              await applyRemoteDump(toApply);
              if (isElectron()) await flushIfMobile();
              conn.send({ type: "ACK" });
              await new Promise((r) => setTimeout(r, 300));
              useSyncTick().value++;
              setState("done", "Sync complete ✓");
              cleanup();
            }
          });
        });

        conn.on("open", () => {
          console.log("[P2P] Host: connection open");
          // data listener already registered above — nothing extra needed
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

  // ── GUEST ──────────────────────────────────────────────────────────────────
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

        // ── CRITICAL: register 'data' listener RIGHT NOW, synchronously ────
        //
        // Do NOT put this inside _conn.on('open', ...).
        //
        // On mobile/Capacitor WebView, the WebRTC DataChannel can transition
        // to 'open' and deliver buffered messages before PeerJS fires the
        // JavaScript 'open' event on the DataConnection object. If the 'data'
        // listener is registered inside the 'open' callback, those early DATA
        // messages are silently dropped — buffer stays empty — DONE arrives
        // and we apply 0 rows.
        //
        // PeerJS DataConnection extends EventEmitter and queues events, so
        // attaching the listener here (before 'open') is safe: no messages
        // are delivered until the DataChannel is actually open at the WebRTC
        // level, and by then our listener is already in place.
        _conn.on("data", (msg) => {
          enqueue(async () => {
            if (!msg?.type) return;
            console.log(
              `[P2P] Guest received: ${msg.type}${
                msg.table
                  ? " table=" + msg.table + " rows=" + (msg.rows?.length ?? 0)
                  : ""
              }`,
            );

            if (msg.type === "DATA") {
              if (!buffer[msg.table]) buffer[msg.table] = [];
              buffer[msg.table].push(...msg.rows);
            }

            if (msg.type === "DONE") {
              const totalBuffered = Object.values(buffer).reduce(
                (s, rows) => s + rows.length,
                0,
              );
              console.log(
                `[P2P] Guest received DONE — buffer has ${totalBuffered} rows across ${
                  Object.keys(buffer).length
                } tables`,
              );

              setState("syncing", "Merging host data…");
              const toApply = buffer;
              buffer = {};
              await applyRemoteDump(toApply);

              if (isElectron()) await flushIfMobile();

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

        // 'open' fires after the DataChannel is ready — use it only to send
        // HELLO and update UI. The data listener is already attached above.
        _conn.on("open", () => {
          console.log("[P2P] Guest: connection open — sending HELLO");
          setState("syncing", "Connected — waiting for host…");
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

  // ── Cleanup ────────────────────────────────────────────────────────────────
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
