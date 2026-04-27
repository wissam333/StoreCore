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
// KEY DESIGN DECISIONS:
//   - No dump caching — always collect fresh at send time
//   - Buffer is local to each connection handler (no shared state)
//   - applyRemoteDump on mobile routes through useMobileStore().applyRemoteRow()
//     so every write goes through the wrapped db that schedules persistence
//   - initMobileSchema called only once before dump/apply, not repeatedly

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
  //
  // IMPORTANT: On mobile, we route every row through useMobileStore().applyRemoteRow()
  // instead of a local applyRow() helper. This guarantees:
  //   1. Writes go through the wrapped db → scheduleSave() is always called
  //   2. The same battle-tested version/timestamp merge logic is used everywhere
  //   3. flushMobileDb() at the end persists everything before we return
  //
  // On Electron, we continue using window.store.applyRemoteRow() via IPC as before.
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
    // Init schema once up front — not inside the per-row loop
    const { initMobileSchema } = await import("./useMobileSchema");
    await initMobileSchema();

    // Get the store — applyRemoteRow() uses getMobileDb() internally and
    // goes through the wrapped db that calls scheduleSave() on every write
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

    // Force immediate persistence — don't rely on the 600ms debounce
    // This is the critical step that was missing: without it the in-memory
    // SQLite changes are lost if the app is backgrounded or restarted
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

        let buffer = {}; // local buffer, not shared

        conn.on("open", () => {
          conn.on("data", async (msg) => {
            if (!msg?.type) return;

            if (msg.type === "HELLO") {
              // Send host data first — dump is fresh here
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
              // applyRemoteDump handles flush internally on mobile
              await applyRemoteDump(toApply);
              // Extra flush for Electron (no-op on mobile — already done inside)
              if (isElectron()) await flushIfMobile();
              conn.send({ type: "ACK" });
              await new Promise((r) => setTimeout(r, 300));
              useSyncTick().value++;
              setState("done", "Sync complete ✓");
              cleanup();
            }
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

        let buffer = {}; // local buffer, not shared

        _conn.on("open", () => {
          setState("syncing", "Connected — waiting for host…");

          _conn.on("data", async (msg) => {
            if (!msg?.type) return;

            if (msg.type === "DATA") {
              if (!buffer[msg.table]) buffer[msg.table] = [];
              buffer[msg.table].push(...msg.rows);
            }

            if (msg.type === "DONE") {
              // Got all host data — merge it
              setState("syncing", "Merging host data…");
              const toApply = buffer;
              buffer = {};
              // applyRemoteDump handles flush internally on mobile
              await applyRemoteDump(toApply);

              // Extra flush for Electron (no-op on mobile — already done inside)
              if (isElectron()) await flushIfMobile();

              // Tick UI — pages reload with merged data
              await new Promise((r) => setTimeout(r, 300));
              useSyncTick().value++;

              // Now send our data to host
              await sendDump(_conn);
            }

            if (msg.type === "ACK") {
              setState("done", "Sync complete ✓");
              cleanup();
            }
          });

          // Announce to host
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
