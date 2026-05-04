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

// ── P2P WebSocket Server ──────────────────────────────────────────────────────
// Uses Node's built-in 'ws' module — no PeerJS, no port conflicts.
// The OS picks a free port automatically (port 0).
import { WebSocketServer } from "ws";

const PREFERRED_PORTS = [9000, 9001, 9002, 9003, 9010];

const getLocalIp = () => {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "127.0.0.1";
};

let _wss = null;
let _wssPort = null;
let _wssReady = false;
let _wssError = null;
let _wssCallbacks = [];

const startWssOnce = () => {
  if (_wss) return; // already started
  try {
    _wss = new WebSocketServer({ port: 0 }); // port 0 = OS picks free port
    _wss.on("listening", () => {
      _wssPort = _wss.address().port;
      _wssReady = true;
      log(`[WSS] Listening on port ${_wssPort}`);
      _wssCallbacks.forEach((cb) =>
        cb({ ok: true, ip: getLocalIp(), port: _wssPort }),
      );
      _wssCallbacks = [];
    });
    _wss.on("error", (err) => {
      _wssError = err.message;
      log(`[WSS] Error: ${err.message}`);
      _wssCallbacks.forEach((cb) => cb({ ok: false, error: err.message }));
      _wssCallbacks = [];
    });
    // Route incoming connections to the renderer via IPC
    _wss.on("connection", (ws) => {
      log("[WSS] Guest connected");
      ws.on("message", (data) => {
        mainWindow?.webContents.send("p2p:message", data.toString());
      });
      ws.on("close", () => {
        log("[WSS] Guest disconnected");
        mainWindow?.webContents.send("p2p:guest-disconnected");
        _hostSocket = null;
      });
      _hostSocket = ws;
      mainWindow?.webContents.send("p2p:guest-connected");
    });
  } catch (err) {
    _wssError = err.message;
    log(`[WSS] Failed to start: ${err.message}`);
  }
};

let _hostSocket = null; // the connected guest socket (host side)

ipcMain.handle("p2p:start-server", () => {
  if (_wssReady) return { ok: true, ip: getLocalIp(), port: _wssPort };
  if (_wssError) return { ok: false, error: _wssError };
  return new Promise((resolve) => {
    _wssCallbacks.push(resolve);
    setTimeout(() => resolve({ ok: false, error: "Timeout" }), 10_000);
  });
});

ipcMain.handle("p2p:stop-server", () => ({ ok: true })); // server is app-lifetime

// Host sends a message to the connected guest
ipcMain.handle("p2p:send", (_, msg) => {
  if (_hostSocket?.readyState === 1) {
    // 1 = OPEN
    _hostSocket.send(msg);
    return { ok: true };
  }
  return { ok: false, error: "No guest connected" };
});

app.on("before-quit", () => {
  _wss?.close();
  log("[WSS] Closed on app quit");
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
  startWssOnce();
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
