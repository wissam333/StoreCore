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
//   - applyRow uses INSERT OR REPLACE (never INSERT OR IGNORE) so new rows
//     from the remote are never silently dropped
//   - getMobileDb() is imported directly — no dynamic useMobileStore import
//     that could fail on first call due to circular deps or Capacitor timing
//   - flushMobileDb() is called explicitly after all rows are written,
//     bypassing the 600ms debounce so data survives immediate app backgrounding

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

// ── Apply one remote row into the mobile sql.js db ────────────────────────────
//
// Uses INSERT OR REPLACE for new rows — never INSERT OR IGNORE.
// INSERT OR IGNORE silently drops rows on any constraint conflict,
// which caused PC→mobile sync to lose data on the first attempt.
//
// Merge logic for existing rows:
//   remote version >  local version  → remote wins, UPDATE
//   remote version <  local version  → local is newer, skip
//   remote version == local version  → compare updated_at, newer wins
//     unless there is a pending unsynced local edit (sync_queue), in which
//     case we skip to avoid stomping an uncommitted local change
const applyRow = async (db, table, row) => {
  if (!ALL_TABLES.includes(table)) return;

  // Normalize booleans → integers for SQLite
  const normalized = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "synced_at") continue; // always regenerated locally
    normalized[k] = typeof v === "boolean" ? (v ? 1 : 0) : v;
  }
  if (!normalized.id) return;

  // ── Check whether row already exists ──────────────────────────────────────
  let existing = null;
  try {
    const r = await db.query(`SELECT * FROM "${table}" WHERE id=?`, [
      normalized.id,
    ]);
    existing = r.values?.[0] ?? null;
  } catch (e) {
    console.warn(`[P2P] SELECT failed [${table}]:`, e?.message);
    return;
  }

  if (!existing) {
    // ── New row — INSERT OR REPLACE ──────────────────────────────────────────
    // INSERT OR REPLACE (not INSERT OR IGNORE) guarantees the row lands even
    // if there is a stale partial duplicate from a previous failed sync.
    normalized.synced_at = new Date().toISOString();
    const cols = Object.keys(normalized);
    const colList = cols.map((c) => `"${c}"`).join(", ");
    const placeholders = cols.map(() => "?").join(", ");
    const vals = cols.map((c) => normalized[c]);

    await db.run("PRAGMA foreign_keys = OFF");
    try {
      await db.run(
        `INSERT OR REPLACE INTO "${table}" (${colList}) VALUES (${placeholders})`,
        vals,
      );
      console.log(`[P2P] Inserted ${table} id=${normalized.id}`);
    } catch (e) {
      console.error(
        `[P2P] INSERT failed [${table}] id=${normalized.id}:`,
        e?.message,
      );
    } finally {
      await db.run("PRAGMA foreign_keys = ON");
    }
    return;
  }

  // ── Existing row — version/timestamp merge ────────────────────────────────
  const remoteVer = normalized.version ?? 0;
  const localVer = existing.version ?? 0;
  const remoteTs = normalized.updated_at ?? "";
  const localTs = existing.updated_at ?? "";

  if (remoteVer < localVer) {
    // Local is strictly newer — skip
    return;
  }

  if (remoteVer === localVer) {
    // Check for a pending local edit that hasn't been pushed yet
    let hasPending = false;
    try {
      const pq = await db.query(
        `SELECT id FROM sync_queue WHERE row_id=? AND synced_at IS NULL LIMIT 1`,
        [normalized.id],
      );
      hasPending = !!pq.values?.[0];
    } catch {
      // sync_queue may not exist yet on a fresh install — treat as no pending
    }

    if (hasPending) return; // don't overwrite an uncommitted local edit
    if (remoteTs <= localTs) return; // local timestamp is same or newer
  }

  // ── Remote wins — UPDATE existing row ────────────────────────────────────
  const skipCols = new Set(["id", "synced_at", "created_at"]);
  const updateCols = Object.keys(normalized).filter((k) => !skipCols.has(k));
  if (!updateCols.length) return;

  const setClause = [
    ...updateCols.map((c) => `"${c}" = ?`),
    `"synced_at" = ?`,
  ].join(", ");

  const vals = [
    ...updateCols.map((c) => normalized[c]),
    new Date().toISOString(),
    normalized.id,
  ];

  await db.run("PRAGMA foreign_keys = OFF");
  try {
    await db.run(`UPDATE "${table}" SET ${setClause} WHERE id = ?`, vals);
    console.log(`[P2P] Updated ${table} id=${normalized.id}`);
  } catch (e) {
    console.error(
      `[P2P] UPDATE failed [${table}] id=${normalized.id}:`,
      e?.message,
    );
  } finally {
    await db.run("PRAGMA foreign_keys = ON");
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

  // ── Flush mobile db — bypass the 600ms debounce ───────────────────────────
  const flushIfMobile = async () => {
    if (isElectron()) return;
    try {
      const { flushMobileDb } = await import("./useMobileDb");
      await flushMobileDb();
      console.log("[P2P] Mobile DB flushed to Preferences ✓");
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
  // Mobile path: uses getMobileDb() + applyRow() directly.
  // No dynamic useMobileStore import — that import can fail silently on the
  // very first call (module not yet cached by Capacitor's JS engine), which
  // caused try-1 to silently drop all incoming rows with no visible error.
  //
  // After all rows are written, flushMobileDb() is called immediately so the
  // data survives if the app is backgrounded before the 600ms debounce fires.
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

    // ── Mobile path ───────────────────────────────────────────────────────
    // Init schema once up front (idempotent — safe to call every sync)
    const { initMobileSchema } = await import("./useMobileSchema");
    await initMobileSchema();

    // Get db directly — avoids dynamic useMobileStore import timing issues
    const { getMobileDb } = await import("./useMobileDb");
    const db = await getMobileDb();

    for (const table of APPLY_ORDER) {
      for (const row of dump[table] ?? []) {
        try {
          await applyRow(db, table, row);
        } catch (e) {
          console.error(`[P2P] applyRow [${table}] id=${row?.id}:`, e?.message);
        }
        progress.value = { current: ++done, total: totalRows };
      }
    }

    // Force immediate persistence — critical on mobile.
    // scheduleSave() inside the db wrapper is debounced 600ms. If the app
    // backgrounds before that timer fires, all written rows are lost.
    // flushMobileDb() writes to Capacitor Preferences synchronously right now.
    await flushIfMobile();
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

        let buffer = {};

        conn.on("open", () => {
          conn.on("data", async (msg) => {
            if (!msg?.type) return;

            if (msg.type === "HELLO") {
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
              await applyRemoteDump(toApply); // flush inside on mobile
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

        let buffer = {};

        _conn.on("open", () => {
          setState("syncing", "Connected — waiting for host…");

          _conn.on("data", async (msg) => {
            if (!msg?.type) return;

            if (msg.type === "DATA") {
              if (!buffer[msg.table]) buffer[msg.table] = [];
              buffer[msg.table].push(...msg.rows);
            }

            if (msg.type === "DONE") {
              setState("syncing", "Merging host data…");
              const toApply = buffer;
              buffer = {};

              // applyRemoteDump writes all rows then flushes before returning
              await applyRemoteDump(toApply);

              // Tick UI — pages reload with the newly written host data
              await new Promise((r) => setTimeout(r, 300));
              useSyncTick().value++;

              // Now send our data to the host
              await sendDump(_conn);
            }

            if (msg.type === "ACK") {
              setState("done", "Sync complete ✓");
              cleanup();
            }
          });

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
