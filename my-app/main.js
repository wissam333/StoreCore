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
import http from "http"; // ← NEW: needed to create our own HTTP server
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

// ── P2P PeerJS Server (on-demand) ─────────────────────────────────────────────
//
// FIX: PeerServer() from the "peer" package returns an Express middleware,
// NOT a real http.Server — so it has no .close() method. The correct approach
// is to create our own http.Server and pass it to PeerServer via { server }.
// We keep a reference to peerHttpServer so we can call .close() on it properly.
//
let peerHttpServer = null; // The real http.Server — this is what we .close()
let peerServerApp = null; // The PeerServer instance (for logging/events only)

const getLocalIp = () => {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address; // e.g. 192.168.1.5
      }
    }
  }
  return "127.0.0.1";
};

ipcMain.handle("p2p:start-server", () => {
  return new Promise((resolve, reject) => {
    // Already running — just return the current IP
    if (peerHttpServer && peerHttpServer.listening) {
      log("[PeerServer] Already running, IP:", getLocalIp());
      resolve({ ok: true, ip: getLocalIp() });
      return;
    }

    try {
      const { PeerServer } = require("peer");

      // Create our own http.Server FIRST so we control its lifecycle
      peerHttpServer = http.createServer();

      // Attach PeerServer to our http.Server via the `server` option.
      // This is the only pattern where .close() works correctly.
      peerServerApp = PeerServer({
        server: peerHttpServer,
        path: "/myapp",
      });

      peerServerApp.on("connection", (client) => {
        log("[PeerServer] Client connected:", client.getId());
      });

      peerServerApp.on("disconnect", (client) => {
        log("[PeerServer] Client disconnected:", client.getId());
      });

      // Handle errors on the HTTP server itself
      peerHttpServer.on("error", (err) => {
        log("[PeerServer] HTTP error:", err.message);
        peerHttpServer = null;
        peerServerApp = null;
        reject({ ok: false, error: err.message });
      });

      // listen() callback fires only when the port is actually bound —
      // no more setTimeout guesswork
      peerHttpServer.listen(9000, () => {
        const ip = getLocalIp();
        log("[PeerServer] Started on port 9000, IP:", ip);
        resolve({ ok: true, ip });
      });
    } catch (e) {
      peerHttpServer = null;
      peerServerApp = null;
      log("[PeerServer] Failed to start:", e.message);
      reject({ ok: false, error: e.message });
    }
  });
});

ipcMain.handle("p2p:stop-server", () => {
  return new Promise((resolve) => {
    // Nothing running — nothing to do
    if (!peerHttpServer) {
      log("[PeerServer] Stop called but server was not running");
      resolve({ ok: true });
      return;
    }

    // .close() on the real http.Server — this is what was missing before
    peerHttpServer.close((err) => {
      if (err) {
        log("[PeerServer] Stop error:", err.message);
      } else {
        log("[PeerServer] Stopped cleanly");
      }
      peerHttpServer = null;
      peerServerApp = null;
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
