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
// KEY FIX (v2):
//   PeerJS fires conn.on('data', async handler) without awaiting the previous
//   invocation. This means DONE can be processed while DATA messages are still
//   being buffered — resulting in "Applying 0 remote rows" on the guest side.
//
//   Solution: route every incoming message through a serial async queue
//   (makeQueue). Each message is processed strictly in order, one at a time.

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

        // ── Serial queue for host — prevents DONE racing ahead of DATA ────
        const enqueue = makeQueue();
        let buffer = {};

        conn.on("open", () => {
          conn.on("data", (msg) => {
            // Enqueue synchronously — the handler itself is async but
            // execution is serialised: next message waits for this one.
            enqueue(async () => {
              if (!msg?.type) return;

              if (msg.type === "HELLO") {
                // Send host data first — dump is always fresh
                await sendDump(conn);
              }

              if (msg.type === "DATA") {
                if (!buffer[msg.table]) buffer[msg.table] = [];
                buffer[msg.table].push(...msg.rows);
              }

              if (msg.type === "DONE") {
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

        // ── Serial queue for guest — this is the critical fix ─────────────
        // Without this, the async DATA handlers haven't finished populating
        // `buffer` before the DONE handler fires and snapshots it as empty.
        const enqueue = makeQueue();
        let buffer = {};

        _conn.on("open", () => {
          setState("syncing", "Connected — waiting for host…");

          _conn.on("data", (msg) => {
            // Enqueue synchronously — do NOT await here.
            // PeerJS calls this callback for every message; by passing an
            // async fn to enqueue() we guarantee strict serial execution.
            enqueue(async () => {
              if (!msg?.type) return;

              if (msg.type === "DATA") {
                if (!buffer[msg.table]) buffer[msg.table] = [];
                buffer[msg.table].push(...msg.rows);
                console.log(
                  `[P2P] Guest buffered ${msg.rows.length} rows for ${
                    msg.table
                  } (total: ${buffer[msg.table].length})`,
                );
              }

              if (msg.type === "DONE") {
                // At this point ALL DATA messages have been fully processed
                // because the queue serialises them — buffer is complete.
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

                // Tick UI — pages reload with merged data
                await new Promise((r) => setTimeout(r, 300));
                useSyncTick().value++;

                // Now send our data back to the host
                await sendDump(_conn);
              }

              if (msg.type === "ACK") {
                setState("done", "Sync complete ✓");
                cleanup();
              }
            });
          });

          // Announce presence to host
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
