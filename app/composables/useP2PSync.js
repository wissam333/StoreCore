import QRCode from "qrcodejs2-fixes";

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

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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

export const useP2PSync = () => {
  const status = ref("idle");
  const statusMsg = ref("");
  const peerId = ref(null);
  const progress = ref({ current: 0, total: 0 });
  const error = ref(null);

  let _ws = null; // guest's WebSocket (guest side)
  let _enqueue = null;
  let _buffer = {};
  let _remoteChangedFieldsMap = {};

  const setState = (s, msg = "") => {
    status.value = s;
    statusMsg.value = msg;
  };

  // ── Data helpers ────────────────────────────────────────────────────────────
  const collectLocalData = async () => {
    const dump = {};
    const changedFieldsMap = {};
    if (isElectron()) {
      for (const table of ALL_TABLES) {
        try {
          const r = await window.store.getRawTable(table);
          dump[table] = r.ok ? r.data : [];
        } catch {
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
          for (const k of Object.keys(changedFieldsMap))
            changedFieldsMap[k] = [...changedFieldsMap[k]];
        }
      } catch (e) {
        console.warn("[P2P] changedFieldsMap error:", e?.message);
      }
      return { dump, changedFieldsMap };
    }
    // Mobile path
    const { initMobileSchema } = await import("./useMobileSchema");
    await initMobileSchema();
    const { getMobileDb } = await import("./useMobileDb");
    const db = await getMobileDb();
    for (const table of ALL_TABLES) dump[table] = await dumpTable(db, table);
    try {
      const qRows =
        (
          await db.query(
            `SELECT table_name, row_id, changed_fields FROM sync_queue
         WHERE synced_at IS NULL AND (retry_count IS NULL OR retry_count < 5)`,
          )
        ).values ?? [];
      for (const entry of qRows) {
        const key = `${entry.table_name}:${entry.row_id}`;
        const fields = entry.changed_fields
          ? JSON.parse(entry.changed_fields)
          : null;
        if (fields) {
          if (!changedFieldsMap[key]) changedFieldsMap[key] = [];
          for (const f of fields)
            if (!changedFieldsMap[key].includes(f))
              changedFieldsMap[key].push(f);
        }
      }
    } catch (e) {
      console.warn("[P2P] changedFieldsMap (mobile):", e?.message);
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
            await window.store.applyRemoteRow({
              table,
              row,
              changedFields: changedFieldsMap[`${table}:${row.id}`] ?? null,
            });
          } catch (e) {
            console.error(`[P2P] applyRemoteRow [${table}]:`, e?.message);
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
          await store.applyRemoteRow({
            table,
            row,
            changedFields: changedFieldsMap[`${table}:${row.id}`] ?? null,
          });
        } catch (e) {
          console.error(`[P2P] applyRemoteRow [${table}]:`, e?.message);
        }
        progress.value = { current: ++done, total: totalRows };
      }
    }
    try {
      const { flushMobileDb } = await import("./useMobileDb");
      await flushMobileDb();
    } catch {}
  };

  // ── Unified message sender ──────────────────────────────────────────────────
  // Host sends via IPC → main.js → WebSocket.
  // Guest sends via its own WebSocket directly.
  const sendMsg = (msg) => {
    const str = JSON.stringify(msg);
    if (isElectron() && !_ws) {
      // We are the HOST — send via IPC
      window.electronAPI.p2pSend(str);
    } else if (_ws?.readyState === WebSocket.OPEN) {
      // We are the GUEST — send directly
      _ws.send(str);
    }
  };

  const sendDump = async () => {
    setState("syncing", "Collecting local data…");
    const { dump, changedFieldsMap } = await collectLocalData();
    const CHUNK = 50;
    setState("syncing", "Sending data…");
    let sent = 0;
    const total = ALL_TABLES.reduce((s, t) => s + (dump[t]?.length ?? 0), 0);
    for (const table of ALL_TABLES) {
      for (const ch of chunk(dump[table] ?? [], CHUNK)) {
        sendMsg({ type: "DATA", table, rows: ch });
        sent += ch.length;
        progress.value = { current: sent, total };
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    sendMsg({ type: "CHANGED_FIELDS_MAP", map: changedFieldsMap });
    await new Promise((r) => setTimeout(r, 100));
    sendMsg({ type: "DONE" });
    console.log(`[P2P] Sent ${total} rows`);
  };

  // ── Message handler (shared logic for both host and guest) ─────────────────
  const handleMessage = (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg?.type) return;
    console.log(`[P2P] received: ${msg.type}`);
    _enqueue(async () => {
      if (msg.type === "HELLO") {
        sendMsg({ type: "HELLO_ACK" });
      }
      if (msg.type === "HELLO_ACK") {
        setState("syncing", "Receiving data from host…");
        await new Promise((r) => setTimeout(r, 50));
        sendMsg({ type: "READY" });
      }
      if (msg.type === "READY") {
        await sendDump();
      }
      if (msg.type === "DATA") {
        if (!_buffer[msg.table]) _buffer[msg.table] = [];
        _buffer[msg.table].push(...msg.rows);
      }
      if (msg.type === "CHANGED_FIELDS_MAP") {
        _remoteChangedFieldsMap = msg.map ?? {};
      }
      if (msg.type === "DONE") {
        // This device just finished receiving — now apply and send ours back
        setState("syncing", "Merging data…");
        const toApply = _buffer;
        const toApplyMap = _remoteChangedFieldsMap;
        _buffer = {};
        _remoteChangedFieldsMap = {};
        await applyRemoteDump(toApply, toApplyMap);
        await new Promise((r) => setTimeout(r, 300));
        useSyncTick().value++;

        if (!_ws) {
          // HOST just got guest's data — send ACK, done
          sendMsg({ type: "ACK" });
          setState("done", "Sync complete ✓");
        } else {
          // GUEST just got host's data — now send ours
          await sendDump();
        }
      }
      if (msg.type === "ACK") {
        // GUEST receives ACK — we're done
        setState("done", "Sync complete ✓");
      }
    });
  };

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  const cleanup = () => {
    if (isElectron()) {
      window.electronAPI?.p2pRemoveAllListeners?.();
    }
    if (_ws) {
      try {
        _ws.close();
      } catch {}
      _ws = null;
    }
    _buffer = {};
    _remoteChangedFieldsMap = {};
  };

  // ── HOST ────────────────────────────────────────────────────────────────────
  const startHost = async () => {
    setState("loading", "Preparing…");
    error.value = null;
    _enqueue = makeQueue();
    _buffer = {};
    _remoteChangedFieldsMap = {};

    try {
      const result = await window.electronAPI.p2pStartServer();
      if (!result?.ok) throw new Error(result?.error ?? "Server unavailable");

      // Wire up IPC listeners for incoming messages from guest
      window.electronAPI.p2pOnGuestConnected(() => {
        setState("connecting", "Device connected…");
        console.log("[P2P] Host: guest connected");
      });

      window.electronAPI.p2pOnMessage((raw) => handleMessage(raw));

      window.electronAPI.p2pOnGuestDisconnected(() => {
        if (status.value !== "done") {
          error.value = "Guest disconnected";
          setState("error", "Guest disconnected unexpectedly");
        }
      });

      // QR encodes ip|port — no peer ID needed
      peerId.value = `${result.ip}|${result.port}`;
      setState("ready", "Show this QR to the other device");
    } catch (e) {
      error.value = e.message;
      setState("error", e.message);
    }
  };

  // ── GUEST ───────────────────────────────────────────────────────────────────
  const connectToHost = async (scanned) => {
    setState("loading", "Connecting…");
    error.value = null;
    _enqueue = makeQueue();
    _buffer = {};
    _remoteChangedFieldsMap = {};

    // Parse QR: "ip|port" (new) or old PeerJS formats — always take last two segments
    let hostIp = "127.0.0.1";
    let hostPort = 9000;
    const parts = scanned.trim().split("|");
    if (parts.length >= 2) {
      hostIp = parts[0];
      hostPort = parseInt(parts[parts.length === 3 ? 1 : 1], 10) || 9000;
    }

    try {
      _ws = new WebSocket(`ws://${hostIp}:${hostPort}`);

      _ws.onopen = () => {
        console.log("[P2P] Guest: connected — sending HELLO");
        setState("syncing", "Connected — handshaking…");
        sendMsg({ type: "HELLO" });
      };

      _ws.onmessage = (evt) => handleMessage(evt.data);

      _ws.onerror = () => {
        error.value = `Cannot reach host at ${hostIp}:${hostPort}`;
        setState("error", error.value);
      };

      _ws.onclose = () => {
        if (status.value !== "done") {
          error.value = "Connection closed unexpectedly";
          setState("error", error.value);
        }
      };
    } catch (e) {
      error.value = e.message;
      setState("error", e.message);
    }
  };

  // ── Public ──────────────────────────────────────────────────────────────────
  const reset = () => {
    cleanup();
    status.value = "idle";
    statusMsg.value = "";
    peerId.value = null;
    progress.value = { current: 0, total: 0 };
    error.value = null;
  };

  const makeQrCode = (el, text) =>
    new QRCode(el, {
      text,
      width: 160,
      height: 160,
      colorDark: "#0f172a",
      colorLight: "#f8fafc",
      correctLevel: QRCode.CorrectLevel.M,
    });

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
