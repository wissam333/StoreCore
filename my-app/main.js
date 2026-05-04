// store-app/main.js
import { app, BrowserWindow, ipcMain, protocol, net } from "electron";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { registerStoreHandlers } from "./ipc/store.js";
import { getDb } from "./db/connection.js";
import { initSchema } from "./db/schema.js";
import {
  verifyLicense,
  activateLicense,
  deactivateLicense,
  getSavedKey,
  getMachineId,
} from "./license/licenseManager.js";
import fs from "fs";
import http from "http";
import { createRequire } from "module";
import { networkInterfaces } from "os";
const require = createRequire(import.meta.url);

// ── File logger ───────────────────────────────────────────────────────────────
const getLogFile = () => path.join(app.getPath("userData"), "app.log");
const log = (...args) => {
  const line = `[${new Date().toISOString()}] ${args.join(" ")}\n`;
  try {
    fs.appendFileSync(getLogFile(), line);
  } catch {}
  console.log(...args);
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (require("electron-squirrel-startup")) app.quit();

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

let mainWindow = null;
let licenseWindow = null;
const isDev = process.env.NODE_ENV === "development";

const loadWindow = async (win, route = "") => {
  const url = isDev
    ? `http://localhost:3000${route}`
    : `app://./index.html${route ? "#" + route : ""}`;
  await win.loadURL(url);
};

const registerProtocol = () => {
  const publicDir = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "public_nuxt")
    : path.join(__dirname, "../.output/public");
  protocol.handle("app", (request) => {
    let filePath = request.url.slice("app://./".length);
    filePath = filePath.split("?")[0].split("#")[0];
    if (!filePath || !path.extname(filePath)) filePath = "index.html";
    return net.fetch(pathToFileURL(path.join(publicDir, filePath)).toString());
  });
};

const createWindow = async () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    icon: path.join(__dirname, "../public/logo/logo.png"),
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "preload.mjs"),
    },
  });
  await loadWindow(mainWindow);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
};

const createLicenseWindow = async () => {
  if (licenseWindow && !licenseWindow.isDestroyed()) {
    licenseWindow.focus();
    return;
  }
  licenseWindow = new BrowserWindow({
    width: 500,
    height: 600,
    resizable: false,
    center: true,
    frame: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "preload.mjs"),
    },
  });
  await loadWindow(licenseWindow, "/license");
  licenseWindow.on("closed", () => {
    licenseWindow = null;
    if (!mainWindow || mainWindow.isDestroyed()) app.quit();
  });
};

// ── DB ────────────────────────────────────────────────────────────────────────
const db = getDb();
initSchema(db);
registerStoreHandlers(db, ipcMain);

// ── P2P PeerJS Server ─────────────────────────────────────────────────────────
//
// WHY THIS APPROACH:
//   PeerServer() returns an Express middleware — NOT an http.Server.
//   Calling .close() on it crashes with "is not a function".
//   Fix: create our own http.Server and pass it via { server } option.
//
// WHY REF-COUNTING:
//   Both host AND guest call startLocalServer() in useP2PSync.js.
//   Without ref-counting, the second caller gets EADDRINUSE because
//   port 9000 is already taken by the first caller's server.
//   With ref-counting: first start() creates the server, second start()
//   just increments the counter. Each stop() decrements; server only
//   actually closes when the counter reaches 0.
//
let peerHttpServer = null; // real http.Server — the one we .close()
let peerServerApp = null; // PeerServer instance (used for events only)
let peerRefCount = 0; // how many callers currently hold the server open

const getLocalIp = () => {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "127.0.0.1";
};

// Destroy a stale server that exists but is not listening.
// Safe to call when peerHttpServer is null.
const forceStopServer = () =>
  new Promise((resolve) => {
    if (!peerHttpServer) {
      resolve();
      return;
    }
    const old = peerHttpServer;
    peerHttpServer = null;
    peerServerApp = null;
    peerRefCount = 0;
    // closeAllConnections() flushes keep-alive sockets so .close() doesn't hang.
    // It was added in Node 18.2 — safe to call conditionally.
    old.closeAllConnections?.();
    old.close(() => {
      log("[PeerServer] Stale instance force-stopped");
      resolve();
    });
  });

ipcMain.handle("p2p:start-server", async () => {
  // ── Case 1: server already running ────────────────────────────────────────
  if (peerHttpServer?.listening) {
    peerRefCount++;
    const ip = getLocalIp();
    log(`[PeerServer] Reusing server (refs=${peerRefCount}), IP: ${ip}`);
    return { ok: true, ip };
  }

  // ── Case 2: stale object (crashed or race condition) ───────────────────────
  if (peerHttpServer) {
    log("[PeerServer] Stale server found — force-stopping before restart");
    await forceStopServer();
  }

  // ── Case 3: fresh start ────────────────────────────────────────────────────
  return new Promise((resolve, reject) => {
    try {
      const { PeerServer } = require("peer");

      // Create the real HTTP server FIRST — this is what we'll .close() later
      peerHttpServer = http.createServer();

      // Attach PeerServer to it via the `server` option (not `port`)
      peerServerApp = PeerServer({ server: peerHttpServer, path: "/myapp" });

      peerServerApp.on("connection", (c) =>
        log("[PeerServer] connected:", c.getId()),
      );
      peerServerApp.on("disconnect", (c) =>
        log("[PeerServer] disconnected:", c.getId()),
      );

      peerHttpServer.on("error", (err) => {
        log("[PeerServer] HTTP error:", err.message);
        peerHttpServer = null;
        peerServerApp = null;
        peerRefCount = 0;
        reject({ ok: false, error: err.message });
      });

      // listen() callback fires only when the port is actually bound —
      // no more setTimeout guessing
      peerHttpServer.listen(9000, () => {
        peerRefCount = 1;
        const ip = getLocalIp();
        log(`[PeerServer] Started on :9000, IP: ${ip}`);
        resolve({ ok: true, ip });
      });
    } catch (e) {
      peerHttpServer = null;
      peerServerApp = null;
      peerRefCount = 0;
      log("[PeerServer] Failed to start:", e.message);
      reject({ ok: false, error: e.message });
    }
  });
});

ipcMain.handle("p2p:stop-server", () => {
  return new Promise((resolve) => {
    if (!peerHttpServer) {
      log("[PeerServer] stop-server called — nothing running");
      peerRefCount = 0;
      resolve({ ok: true });
      return;
    }

    // Decrement — clamp to 0 so a rogue extra stop() can't go negative
    peerRefCount = Math.max(0, peerRefCount - 1);
    log(`[PeerServer] stop requested (refs now=${peerRefCount})`);

    if (peerRefCount > 0) {
      // Another caller still needs the server — leave it running
      resolve({ ok: true });
      return;
    }

    // Last caller — actually shut down
    const old = peerHttpServer;
    peerHttpServer = null;
    peerServerApp = null;

    old.closeAllConnections?.(); // flush keep-alive sockets
    old.close((err) => {
      if (err) log("[PeerServer] stop error:", err.message);
      else log("[PeerServer] stopped cleanly");
      resolve({ ok: true });
    });
  });
});

// ── License IPC ───────────────────────────────────────────────────────────────
ipcMain.handle("license:activate", async (_, key) => {
  log("[license:activate] key:", key?.slice(0, 8) + "...");

  const result = await activateLicense(key, db);
  log("[license:activate] server result:", JSON.stringify(result));

  if (!result.ok) return result;

  const saved = getSavedKey();
  log("[license:activate] getSavedKey after save:", saved ? "OK ✓" : "NULL ✗");

  if (!saved) {
    const userData = app.getPath("userData");
    const storePath = path.join(userData, "license.json");
    let diag = `userData=${userData}`;
    try {
      fs.accessSync(userData, fs.constants.W_OK);
      diag += " writable=YES";
    } catch {
      diag += " writable=NO";
    }
    diag += fs.existsSync(storePath) ? " file=EXISTS" : " file=MISSING";
    log("[license:activate] STORAGE FAILURE —", diag);

    return {
      ok: false,
      error:
        "Your license was accepted by the server but could not be saved on this PC. " +
        `Check app.log at: ${getLogFile()}`,
    };
  }

  return { ok: true };
});

ipcMain.handle("license:deactivate", async () => deactivateLicense(db));

ipcMain.handle("license:getKey", () => {
  const k = getSavedKey();
  log("[license:getKey]", k ? k.slice(0, 8) + "..." : "null");
  return k;
});

ipcMain.handle("license:getMachineId", () => getMachineId());

ipcMain.on("license:activated", async () => {
  log("[main] license:activated — opening main window");
  if (licenseWindow && !licenseWindow.isDestroyed()) {
    licenseWindow.close();
    licenseWindow = null;
  }
  await createWindow();
});

ipcMain.on("app:quit", () => app.quit());

// ── App ready ─────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  log("[1] app ready — userData:", app.getPath("userData"));
  registerProtocol();

  let license;
  try {
    license = await verifyLicense();
    log("[2] license:", JSON.stringify(license));
  } catch (err) {
    log("[2] verifyLicense threw:", err.message);
    license = { ok: false, reason: "error" };
  }

  if (!license.ok) {
    log("[3] opening license window");
    await createLicenseWindow();
    return;
  }

  log("[3] opening main window");
  await createWindow();
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const lic = await verifyLicense();
    if (lic.ok) await createWindow();
    else await createLicenseWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
