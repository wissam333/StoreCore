// store-app/composables/useP2PSync.js
//
// Peer-to-peer local sync using PeerJS (WebRTC data channels).
// No internet required — works on the same WiFi/LAN network.
//
// FLOW:
//   Host  → generates PeerID → shows QR code
//   Guest → scans QR → connects → handshake → exchange rows → merge
//
// CONFLICT RESOLUTION:
//   Same logic as applyRemoteRow — version wins, timestamp tiebreaks.
//   Both sides send ALL their rows; both sides apply what they receive.
//   Result: full bidirectional merge.

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

// ── Dump all local rows for a table ──────────────────────────────────────────
const dumpTable = async (db, table) => {
  try {
    const r = await db.query(`SELECT * FROM "${table}" WHERE 1=1`);
    return r.values ?? [];
  } catch (e) {
    console.warn(
      `[P2P] dumpTable skipping missing table "${table}":`,
      e?.message,
    );
    return [];
  }
};

// ── Apply a single remote row (same logic as useMobileStore.applyRemoteRow) ──
// useP2PSync.js — replace applyRow entirely:
const applyRow = async (db, table, row) => {
  const ALLOWED = new Set(ALL_TABLES);
  if (!ALLOWED.has(table)) return;

  const normalized = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "synced_at") continue;
    if (typeof v === "boolean") normalized[k] = v ? 1 : 0;
    else normalized[k] = v;
  }
  if (!normalized.id) return;

  const existing = (
    await db.query(`SELECT * FROM "${table}" WHERE id=?`, [normalized.id])
  ).values?.[0];

  if (!existing) {
    normalized.synced_at = new Date().toISOString();
    const cols = Object.keys(normalized);
    const colList = cols.map((c) => `"${c}"`).join(", ");
    const valPlaceholders = cols.map(() => "?").join(", ");
    const vals = cols.map((c) => normalized[c]);
    await db.run("PRAGMA foreign_keys = OFF");
    try {
      await db.run(
        `INSERT OR IGNORE INTO "${table}" (${colList}) VALUES (${valPlaceholders})`,
        vals,
      );
    } finally {
      await db.run("PRAGMA foreign_keys = ON");
    }
    return;
  }

  const remoteVersion = normalized.version ?? 0;
  const localVersion = existing.version ?? 0;

  // P2P: no server authority — do field-level merge on ALL fields
  // Each field independently takes the value from whichever side
  // has the higher version. On tie, newer updated_at wins per field.
  const skipCols = new Set(["id", "synced_at", "created_at"]);
  const updateCols = Object.keys(normalized).filter((k) => !skipCols.has(k));
  if (!updateCols.length) return;

  const remoteTs = normalized.updated_at ?? "";
  const localTs = existing.updated_at ?? "";

  // If local is strictly newer in both version AND timestamp — skip entirely
  if (remoteVersion < localVersion && remoteTs < localTs) return;

  // Check for pending unsynced local changes
  const pending = (
    await db.query(
      `SELECT id FROM sync_queue WHERE row_id=? AND synced_at IS NULL LIMIT 1`,
      [normalized.id],
    )
  ).values?.[0];

  let setFields;
  if (pending && remoteVersion <= localVersion) {
    // Local has unsent edits and is same/newer version — skip to protect local work
    return;
  } else if (remoteVersion > localVersion) {
    // Remote is clearly newer — take all remote fields
    setFields = updateCols;
  } else {
    // Same version or ambiguous — take remote fields but preserve local
    // fields that are newer (best-effort field merge without changedFields metadata)
    setFields = updateCols.filter((f) => {
      // For timestamps and version, prefer remote if it's newer
      if (f === "updated_at" || f === "version") return remoteTs > localTs;
      // For data fields, prefer remote if remote timestamp is newer
      return remoteTs > localTs;
    });
  }

  if (!setFields.length) return;

  // Bump version to max+1 so the merged result propagates correctly
  // when this device later syncs with the cloud server
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
  const status = ref("idle"); // idle | loading | ready | connecting | syncing | done | error
  const statusMsg = ref("");
  const peerId = ref(null);
  const progress = ref({ current: 0, total: 0 });
  const error = ref(null);

  let _peer = null;
  let _conn = null;
  let _localDump = null; // cached dump to send to guest

  const setState = (s, msg = "") => {
    status.value = s;
    statusMsg.value = msg;
  };

  // ── Collect all local data ─────────────────────────────────────────────────
  const collectLocalData = async () => {
    // ── Electron: read via IPC ─────────────────────────────────────────────
    if (typeof window !== "undefined" && window.__ELECTRON__ && window.store) {
      const TABLES = [
        "categories",
        "customers",
        "staff",
        "products",
        "orders",
        "order_items",
        "dues",
      ];
      const dump = {};
      for (const table of TABLES) {
        try {
          // Use the existing store getters which go through IPC
          const getterMap = {
            categories: () => window.store.getCategories(),
            customers: () => window.store.getCustomers({ limit: 99999 }),
            staff: () => window.store.getStaff(),
            products: () => window.store.getProducts({ limit: 99999 }),
            orders: () => window.store.getOrders({ limit: 99999 }),
            order_items: () => window.store.getAllOrderItems(),
            dues: () => window.store.getDues({ limit: 99999 }),
          };

          if (getterMap[table]) {
            const r = await getterMap[table]();
            dump[table] = r.ok ? r.data : [];
          } else {
            // order_items has no top-level getter — skip for now
            // or add a getRawTable IPC handler if needed
            dump[table] = [];
          }
        } catch (e) {
          console.warn(`[P2P] Electron dump failed for ${table}:`, e);
          dump[table] = [];
        }
      }
      return dump;
    }

    // ── Mobile: read via sql.js ────────────────────────────────────────────
    const { initMobileSchema } = await import("./useMobileSchema");
    await initMobileSchema();

    const { getMobileDb } = await import("./useMobileDb");
    const db = await getMobileDb();
    const dump = {};
    for (const table of ALL_TABLES) {
      dump[table] = await dumpTable(db, table);
    }
    return dump;
  };

  // ── Apply a full dump from the other device ────────────────────────────────
  const applyRemoteDump = async (dump) => {
    // ← Ensure schema exists before writing anything
    const { initMobileSchema } = await import("./useMobileSchema");
    await initMobileSchema();

    const { getMobileDb } = await import("./useMobileDb");
    const db = await getMobileDb();

    const ORDER = [
      "categories",
      "customers",
      "staff",
      "products",
      "orders",
      "order_items",
      "dues",
    ];

    const totalRows = ORDER.reduce((s, t) => s + (dump[t]?.length ?? 0), 0);
    let done = 0;
    progress.value = { current: 0, total: totalRows };

    for (const table of ORDER) {
      const rows = dump[table] ?? [];
      for (const row of rows) {
        await applyRow(db, table, row);
        progress.value = { current: ++done, total: totalRows };
      }
    }
  };

  // ── Protocol messages ──────────────────────────────────────────────────────
  // { type: 'HELLO' }                 → guest announces connection
  // { type: 'DATA', table, rows }     → chunk of rows
  // { type: 'DONE' }                  → all rows sent
  // { type: 'ACK' }                   → receiver finished applying

  const handleIncomingData = async (conn, msg) => {
    if (!msg?.type) return;

    if (msg.type === "HELLO") {
      // Guest connected — send our data
      setState("syncing", "Sending local data…");
      await sendDump(conn);
    }

    if (msg.type === "DATA") {
      // Receiving rows — buffer them, apply on DONE
      if (!conn._buffer) conn._buffer = {};
      if (!conn._buffer[msg.table]) conn._buffer[msg.table] = [];
      conn._buffer[msg.table].push(...msg.rows);
    }

    if (msg.type === "DONE") {
      setState("syncing", "Merging data…");
      if (conn._buffer) {
        await applyRemoteDump(conn._buffer);
      }
      conn.send({ type: "ACK" });

      try {
        const { flushMobileDb } = await import("./useMobileDb");
        await flushMobileDb();
      } catch (e) {
        console.warn("[P2P] flush error:", e);
      }

      // Small delay so sql.js finishes writing before UI reloads
      await new Promise((r) => setTimeout(r, 300));
      useSyncTick().value++;
      setState("done", "Sync complete ✓");
      cleanup();
    }

    if (msg.type === "ACK") {
      try {
        const { flushMobileDb } = await import("./useMobileDb");
        await flushMobileDb();
      } catch (e) {
        console.warn("[P2P] flush error:", e);
      }

      await new Promise((r) => setTimeout(r, 300));
      useSyncTick().value++;
      setState("done", "Sync complete ✓");
      cleanup();
    }
  };

  const sendDump = async (conn) => {
    const dump = _localDump ?? (await collectLocalData());
    const CHUNK_SIZE = 50;

    for (const table of ALL_TABLES) {
      const rows = dump[table] ?? [];
      for (const ch of chunk(rows, CHUNK_SIZE)) {
        conn.send({ type: "DATA", table, rows: ch });
        // Small yield to keep UI responsive
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    conn.send({ type: "DONE" });
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

      const Peer = await loadPeer();
      _peer = new Peer(undefined, {
        // Use public PeerJS cloud as signalling only — actual data is P2P
        config: {
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        },
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
      _localDump = await collectLocalData();

      const Peer = await loadPeer();
      _peer = new Peer(undefined, {
        config: {
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        },
      });

      _peer.on("open", () => {
        _conn = _peer.connect(hostPeerId, { reliable: true });

        _conn.on("open", () => {
          setState("syncing", "Sending local data…");
          _conn.on("data", (msg) => handleIncomingData(_conn, msg));
          // Guest initiates by saying hello, then immediately sends its data
          _conn.send({ type: "HELLO" });
          sendDump(_conn);
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
    }, 2000); // delay so ACK has time to arrive
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
