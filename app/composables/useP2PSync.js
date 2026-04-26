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
    await db.query(`SELECT version, updated_at FROM "${table}" WHERE id=?`, [
      normalized.id,
    ])
  ).values?.[0];

  if (!existing) {
    normalized.synced_at = new Date().toISOString();
    const cols2 = Object.keys(normalized); // rebuild after adding synced_at
    const colList = cols2.map((c) => `"${c}"`).join(", ");
    const valPlaceholders = cols2.map(() => "?").join(", ");
    const vals = cols2.map((c) => normalized[c]);

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

  if (remoteVersion < localVersion) return; // local wins

  if (remoteVersion === localVersion) {
    const remoteTs = normalized.updated_at ?? "";
    const localTs = existing.updated_at ?? "";
    if (remoteTs <= localTs) return; // local wins on tiebreak
  }

  // Remote wins — field-level update
  const skipCols = new Set(["id", "synced_at", "created_at"]);
  const updateCols = Object.keys(normalized).filter((k) => !skipCols.has(k));
  if (!updateCols.length) return;

  const setClause = updateCols.map((c) => `"${c}" = ?`).join(", ");
  const vals = [...updateCols.map((c) => normalized[c]), normalized.id];

  await db.run("PRAGMA foreign_keys = OFF");
  try {
    await db.run(`UPDATE "${table}" SET ${setClause}, synced_at=? WHERE id=?`, [
      ...vals.slice(0, -1),
      new Date().toISOString(),
      normalized.id,
    ]);
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
    const { getMobileDb } = await import("./useMobileDb");
    const db = await getMobileDb();

    const tables = Object.keys(dump).filter((t) => ALL_TABLES.includes(t));
    let totalRows = tables.reduce((s, t) => s + (dump[t]?.length ?? 0), 0);
    let done = 0;
    progress.value = { current: 0, total: totalRows };

    // Apply in FK-safe order
    const ORDER = [
      "categories",
      "customers",
      "staff",
      "products",
      "orders",
      "order_items",
      "dues",
    ];
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
      // Persist merged data immediately so it survives backgrounding
      try {
        const { flushMobileDb } = await import("./useMobileDb");
        await flushMobileDb();
      } catch {}
      // Signal all pages to reload their data
      useSyncTick().value++;
      setState("done", "Sync complete ✓");
      cleanup();
    }

    if (msg.type === "ACK") {
      // We sent data and got confirmation — also flush and tick
      try {
        const { flushMobileDb } = await import("./useMobileDb");
        await flushMobileDb();
      } catch {}
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
