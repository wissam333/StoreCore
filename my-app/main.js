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
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// ── File logger ───────────────────────────────────────────────────────────────
const logFile = path.join(app.getPath("userData"), "app.log");
const log = (...args) => {
  const line = `[${new Date().toISOString()}] ${args.join(" ")}\n`;
  fs.appendFileSync(logFile, line);
  console.log(...args);
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Squirrel startup (must be first) ──────────────────────────────────────────
if (require("electron-squirrel-startup")) app.quit();

if (process.platform === "win32") {
  const command = process.argv[1];
  if (command === "--squirrel-install" || command === "--squirrel-updated") {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: path.join(path.dirname(process.execPath), "..", "Update.exe"),
      args: [
        "--processStart",
        `"${path.basename(process.execPath)}"`,
        "--process-start-args",
        '"--autostart"',
      ],
    });
  } else if (command === "--squirrel-uninstall") {
    app.setLoginItemSettings({ openAtLogin: false });
  }
}

// ── Register app:// protocol (must be before app ready) ───────────────────────
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

// ── Window references ─────────────────────────────────────────────────────────
let mainWindow = null;
let licenseWindow = null;

// ── Load window helper ────────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV === "development";

const loadWindow = async (win, route = "") => {
  const url = isDev
    ? `http://localhost:3000${route}`
    : `app://./index.html${route ? "#" + route : ""}`;
  await win.loadURL(url);
};

// ── Register app:// protocol handler ─────────────────────────────────────────
const registerProtocol = () => {
  const publicDir = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "public_nuxt")
    : path.join(__dirname, "../.output/public");

  protocol.handle("app", (request) => {
    let filePath = request.url.slice("app://./".length);
    filePath = filePath.split("?")[0].split("#")[0];
    if (!filePath || !path.extname(filePath)) filePath = "index.html";
    const fullPath = path.join(publicDir, filePath);
    return net.fetch(pathToFileURL(fullPath).toString());
  });
};

// ── Create main app window ────────────────────────────────────────────────────
const createWindow = async () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    icon: path.join(__dirname, "../public/logo/logo.ico"),
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

// ── Create license window ─────────────────────────────────────────────────────
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

  // Load the /license route directly
  await loadWindow(licenseWindow, "/license");

  licenseWindow.on("closed", () => {
    licenseWindow = null;
    // If no main window exists, quit the app
    if (!mainWindow || mainWindow.isDestroyed()) {
      app.quit();
    }
  });
};

// ── DB init (once) ────────────────────────────────────────────────────────────
const db = getDb();
initSchema(db);
registerStoreHandlers(db, ipcMain);

// ── License IPC handlers ──────────────────────────────────────────────────────
ipcMain.handle("license:activate", async (_, key) => {
  return await activateLicense(key, db);
});

ipcMain.handle("license:deactivate", async () => {
  return await deactivateLicense(db);
});

ipcMain.handle("license:getKey", () => getSavedKey());
ipcMain.handle("license:getMachineId", () => getMachineId());

ipcMain.on("license:activated", async () => {
  log("[main] license:activated received");
  if (licenseWindow && !licenseWindow.isDestroyed()) {
    licenseWindow.close();
    licenseWindow = null;
  }
  await createWindow();
});

ipcMain.on("app:quit", () => {
  app.quit();
});

// ── App ready ─────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  log("[1] app ready");

  registerProtocol();

  let license;
  try {
    license = await verifyLicense();
    log("[2] license result:", JSON.stringify(license));
  } catch (err) {
    log("[2] verifyLicense THREW:", err.message);
    license = { ok: false, reason: "error" };
  }

  if (!license.ok) {
    log("[3] opening license window");
    await createLicenseWindow();
    return;
  }

  log("[3] opening main app");
  await createWindow();
});

// ── macOS dock re-open ────────────────────────────────────────────────────────
app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const license = await verifyLicense();
    if (license.ok) await createWindow();
    else await createLicenseWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
