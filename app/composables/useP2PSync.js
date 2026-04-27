// store-app/composables/useP2PSync.js
//
// Peer-to-peer local sync using PeerJS (WebRTC data channels).
// No internet required — works on the same WiFi/LAN network.
//
// PROTOCOL v4 — explicit handshake, host waits for READY:
//   1. Guest open fires → guest sends HELLO
//   2. Host receives HELLO → replies with HELLO_ACK (no data yet)
//   3. Guest receives HELLO_ACK → sends READY (confirms listener is live)
//   4. Host receives READY → starts sendDump (DATA chunks + DONE)
//   5. Guest receives DATA* + DONE → merges → sends DATA* + DONE back
//   6. Host receives DATA* + DONE → merges → sends ACK
//   7. Guest receives ACK → done
//
// WHY THE HANDSHAKE:
//   Without it the host blasts DATA immediately after receiving HELLO.
//   On Capacitor WebView, PeerJS's internal message replay runs before the
//   app-level 'data' EventEmitter listener is attached — every DATA is
//   silently dropped, buffer stays empty, guest applies 0 rows.
//
//   HELLO → HELLO_ACK → READY forces two full network RTTs before data
//   flows. By then the guest JS stack has completely unwound and the
//   'data' listener is guaranteed to be live.

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
// Guarantees that async message handlers run strictly one at a time.
// Prevents DONE from being processed before all DATA handlers finish.
const makeQueue = () => {
  let _tail = Promise.resolve();
  return (fn) => {
    _tail = _tail
      .then(() => fn())
      .catch((e) => console.error("[P2P] queue error:", e?.message ?? e));
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

// ── Dump one table ────────────────────────────────────────────────────────────
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

  // ── Flush mobile db ───────────────────────────────────────────────────────
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

  // ── Collect all rows (always fresh) ──────────────────────────────────────
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

  // ── Apply incoming dump ───────────────────────────────────────────────────
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

  // ── Send local data to peer ───────────────────────────────────────────────
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
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    // Extra pause before DONE — gives the receiver's event loop time to
    // process the last DATA chunk before DONE is dispatched
    await new Promise((r) => setTimeout(r, 100));
    conn.send({ type: "DONE" });
    console.log(`[P2P] Sent ${totalRows} rows`);
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
              // Step 2: acknowledge HELLO — do NOT send data yet.
              // Wait for READY from guest before blasting DATA.
              console.log("[P2P] Host sending HELLO_ACK");
              conn.send({ type: "HELLO_ACK" });
            }

            if (msg.type === "READY") {
              // Step 4: guest confirmed its listener is live — safe to send
              console.log("[P2P] Host received READY — starting sendDump");
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

        // ── Attach 'data' listener immediately, before 'open' fires ────────
        // This is necessary but not sufficient on Capacitor — the handshake
        // (HELLO → HELLO_ACK → READY) is what actually guarantees the host
        // doesn't send DATA before this listener is processing events.
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
              // Step 3: host acknowledged us. Our data listener is now
              // provably live (we just received this message through it).
              // Signal host that it's safe to start sending DATA.
              console.log("[P2P] Guest received HELLO_ACK — sending READY");
              setState("syncing", "Receiving data from host…");

              // Yield one macrotask before sending READY.
              // Ensures any pending microtasks/PeerJS internals have settled.
              await new Promise((r) => setTimeout(r, 50));
              _conn.send({ type: "READY" });
            }

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

  // ── Cleanup ───────────────────────────────────────────────────────────────
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
