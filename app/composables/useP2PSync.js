// store-app/composables/useP2PSync.js
//
// Peer-to-peer local sync using PeerJS (WebRTC data channels).
// No internet required — works on the same WiFi/LAN network.
//
// FLOW:
//   Host  → generates PeerID → shows QR code
//   Guest → scans QR → connects → sends HELLO
//   Host  → receives HELLO → sends ALL host data → sends DONE
//   Guest → receives DONE → merges host data → flushes → ticks UI
//         → sends ALL guest data → sends DONE
//   Host  → receives DONE → merges guest data → sends ACK → ticks UI
//   Guest → receives ACK → done

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

// ── Dump all local rows for a table (mobile sql.js) ──────────────────────────
const dumpTable = async (db, table) => {
  try {
    const r = await db.query(`SELECT * FROM "${table}"`);
    return r.values ?? [];
  } catch (e) {
    console.warn(`[P2P] dumpTable skipping "${table}":`, e?.message);
    return [];
  }
};

// ── Apply a single remote row into mobile sql.js db ──────────────────────────
const applyRow = async (db, table, row) => {
  const ALLOWED = new Set(ALL_TABLES);
  if (!ALLOWED.has(table)) return;

  // Normalize booleans → integers for SQLite
  const normalized = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "synced_at") continue;
    if (typeof v === "boolean") normalized[k] = v ? 1 : 0;
    else normalized[k] = v;
  }
  if (!normalized.id) return;

  // Check if row exists locally
  const existing = (
    await db.query(`SELECT * FROM "${table}" WHERE id=?`, [normalized.id])
  ).values?.[0];

  if (!existing) {
    // Brand new row — insert it
    normalized.synced_at = new Date().toISOString();
    const cols = Object.keys(normalized);
    const colList = cols.map((c) => `"${c}"`).join(", ");
    const valPlaceholders = cols.map(() => "?").join(", ");
    const vals = cols.map((c) => normalized[c]);

    await db.run("PRAGMA foreign_keys = OFF");
    try {
      // INSERT OR REPLACE so constraint conflicts don't silently swallow the row
      await db.run(
        `INSERT OR REPLACE INTO "${table}" (${colList}) VALUES (${valPlaceholders})`,
        vals,
      );
      console.log(`[P2P] Inserted ${table} ${normalized.id}`);
    } catch (e) {
      console.error(
        `[P2P] INSERT failed [${table}] ${normalized.id}:`,
        e?.message,
      );
    } finally {
      await db.run("PRAGMA foreign_keys = ON");
    }
    return;
  }

  // Row exists — version-aware merge
  const remoteVersion = normalized.version ?? 0;
  const localVersion = existing.version ?? 0;
  const remoteTs = normalized.updated_at ?? "";
  const localTs = existing.updated_at ?? "";

  // Local is strictly newer on both axes — skip
  if (remoteVersion < localVersion && remoteTs < localTs) return;

  // Local has pending unsynced edits at same/higher version — skip
  const pending = (
    await db.query(
      `SELECT id FROM sync_queue WHERE row_id=? AND synced_at IS NULL LIMIT 1`,
      [normalized.id],
    )
  ).values?.[0];

  if (pending && remoteVersion <= localVersion) return;

  // Decide which fields to apply
  const skipCols = new Set(["id", "synced_at", "created_at"]);
  const updateCols = Object.keys(normalized).filter((k) => !skipCols.has(k));
  if (!updateCols.length) return;

  let setFields;
  if (remoteVersion > localVersion) {
    setFields = updateCols; // remote clearly newer — take everything
  } else {
    setFields = updateCols.filter(() => remoteTs > localTs); // tiebreak by timestamp
  }

  if (!setFields.length) return;

  const mergedVersion = Math.max(remoteVersion, localVersion) + 1;
  const now = new Date().toISOString();
  const finalCols = setFields.filter(
    (f) => f !== "version" && f !== "updated_at",
  );

  const setClause = [
    ...finalCols.map((c) => `"${c}" = ?`),
    `"version" = ?`,
    `"updated_at" = ?`,
    `"synced_at" = ?`,
  ].join(", ");

  const vals = [
    ...finalCols.map((c) => normalized[c]),
    mergedVersion,
    now,
    now,
    normalized.id,
  ];

  await db.run("PRAGMA foreign_keys = OFF");
  try {
    await db.run(`UPDATE "${table}" SET ${setClause} WHERE id = ?`, vals);
  } catch (e) {
    console.error(
      `[P2P] UPDATE failed [${table}] ${normalized.id}:`,
      e?.message,
    );
  } finally {
    await db.run("PRAGMA foreign_keys = ON");
  }
};

// ── Chunk large arrays so DataChannel doesn't overflow ───────────────────────
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
  let _localDump = null;

  const setState = (s, msg = "") => {
    status.value = s;
    statusMsg.value = msg;
  };

  // ── Flush mobile db (no-op on Electron) ───────────────────────────────────
  const flushIfMobile = async () => {
    if (isElectron()) return;
    try {
      const { flushMobileDb } = await import("./useMobileDb");
      await flushMobileDb();
    } catch (e) {
      console.warn("[P2P] flush error:", e?.message);
    }
  };

  // ── Collect all local rows — platform aware ────────────────────────────────
  const collectLocalData = async () => {
    if (isElectron()) {
      // Electron: dump via IPC getRawTable
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

    // Mobile: dump via sql.js
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

  // ── Apply a full dump — platform aware ────────────────────────────────────
  const applyRemoteDump = async (dump) => {
    const totalRows = APPLY_ORDER.reduce(
      (s, t) => s + (dump[t]?.length ?? 0),
      0,
    );
    let done = 0;
    progress.value = { current: 0, total: totalRows };

    console.log(`[P2P] applyRemoteDump: ${totalRows} total rows`);

    if (isElectron()) {
      // Electron: write via IPC applyRemoteRow
      for (const table of APPLY_ORDER) {
        const rows = dump[table] ?? [];
        for (const row of rows) {
          try {
            await window.store.applyRemoteRow({ table, row });
          } catch (e) {
            console.error(
              `[P2P] Electron applyRemoteRow failed [${table}]:`,
              e?.message,
            );
          }
          progress.value = { current: ++done, total: totalRows };
        }
      }
      return;
    }

    // Mobile: write via sql.js
    const { initMobileSchema } = await import("./useMobileSchema");
    await initMobileSchema();
    const { getMobileDb } = await import("./useMobileDb");
    const db = await getMobileDb();

    for (const table of APPLY_ORDER) {
      const rows = dump[table] ?? [];
      for (const row of rows) {
        try {
          await applyRow(db, table, row);
        } catch (e) {
          console.error(
            `[P2P] applyRow failed [${table}]:`,
            e?.message,
            row?.id,
          );
        }
        progress.value = { current: ++done, total: totalRows };
      }
    }
  };

  // ── Send local dump over connection ───────────────────────────────────────
  const sendDump = async (conn) => {
    const dump = _localDump ?? (await collectLocalData());
    const CHUNK_SIZE = 50;

    for (const table of ALL_TABLES) {
      const rows = dump[table] ?? [];
      for (const ch of chunk(rows, CHUNK_SIZE)) {
        conn.send({ type: "DATA", table, rows: ch });
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    conn.send({ type: "DONE" });
    console.log("[P2P] sendDump complete");
  };

  // ── HOST incoming message handler ─────────────────────────────────────────
  // Protocol: Guest sends HELLO → Host sends data → Host sends DONE
  //           Guest merges → Guest sends data → Guest sends DONE
  //           Host merges → Host sends ACK
  const handleIncomingData = async (conn, msg) => {
    if (!msg?.type) return;

    if (msg.type === "HELLO") {
      // Guest connected — host sends its data first
      setState("syncing", "Sending local data…");
      await sendDump(conn);
    }

    if (msg.type === "DATA") {
      if (!conn._buffer) conn._buffer = {};
      if (!conn._buffer[msg.table]) conn._buffer[msg.table] = [];
      conn._buffer[msg.table].push(...msg.rows);
    }

    if (msg.type === "DONE") {
      // Host received all guest rows — merge them
      setState("syncing", "Merging guest data…");
      const buffer = conn._buffer ?? {};
      conn._buffer = {};

      await applyRemoteDump(buffer);
      await flushIfMobile();

      conn.send({ type: "ACK" });

      await new Promise((r) => setTimeout(r, 300));
      useSyncTick().value++;
      setState("done", "Sync complete ✓");
      cleanup();
    }
  };

  // ── Load PeerJS ────────────────────────────────────────────────────────────
  const loadPeer = async () => {
    await loadScript(PEERJS_CDN);
    return window.Peer;
  };

  // ── HOST: create peer, show QR ─────────────────────────────────────────────
  const startHost = async () => {
    setState("loading", "Preparing…");
    error.value = null;

    try {
      _localDump = await collectLocalData();
      console.log("[P2P] Host dump ready");

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
        setState("connecting", "Device connected — syncing…");
        conn.on("open", () => {
          conn.on("data", (msg) => handleIncomingData(conn, msg));
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

  // ── GUEST: connect to host peer ID ─────────────────────────────────────────
  const connectToHost = async (hostPeerId) => {
    setState("loading", "Connecting…");
    error.value = null;

    try {
      // Collect local data before connecting so we're ready to send
      _localDump = await collectLocalData();
      console.log("[P2P] Guest dump ready");

      const Peer = await loadPeer();
      _peer = new Peer(undefined, {
        config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] },
      });

      _peer.on("open", () => {
        _conn = _peer.connect(hostPeerId, { reliable: true });

        _conn.on("open", () => {
          setState("syncing", "Connected — waiting for host data…");

          _conn.on("data", async (msg) => {
            if (!msg?.type) return;

            // Buffer incoming rows from host
            if (msg.type === "DATA") {
              if (!_conn._buffer) _conn._buffer = {};
              if (!_conn._buffer[msg.table]) _conn._buffer[msg.table] = [];
              _conn._buffer[msg.table].push(...msg.rows);
            }

            // Host finished sending — merge host data then send ours
            if (msg.type === "DONE") {
              setState("syncing", "Merging host data…");
              const buffer = _conn._buffer ?? {};
              _conn._buffer = {};

              await applyRemoteDump(buffer);

              // Flush and tick NOW so UI shows host's data immediately
              await flushIfMobile();
              await new Promise((r) => setTimeout(r, 300));
              useSyncTick().value++;

              // Now send guest's data to host
              setState("syncing", "Sending local data to host…");
              await sendDump(_conn);
            }

            // Host confirmed it received and merged our data
            if (msg.type === "ACK") {
              setState("done", "Sync complete ✓");
              cleanup();
            }
          });

          // Announce to host — host will send its data first
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
      _localDump = null;
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
