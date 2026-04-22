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

const loadWindow = async (win) => {
  if (isDev) {
    await win.loadURL("http://localhost:3000");
  } else {
    await win.loadURL("app://./index.html");
  }
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
  console.log("[createWindow] creating MAIN window");
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
  console.log("[createLicenseWindow] creating LICENSE window");

  licenseWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    resizable: true,
    center: true,
    frame: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  licenseWindow.webContents.on("dom-ready", () => {
    console.log("[main] dom-ready fired");
    licenseWindow.webContents
      .executeJavaScript(
        `
      window.__SHOW_LICENSE__ = true;
      window.dispatchEvent(new CustomEvent('force-license-screen'));
    `,
      )
      .catch(console.error);
  });

  licenseWindow.on("closed", () => {
    licenseWindow = null;
  });

  await loadWindow(licenseWindow);
};

// ── License IPC handlers ──────────────────────────────────────────────────────

ipcMain.handle("license:activate", async (_, key) => {
  return await activateLicense(key, db); // ← add db
});
ipcMain.handle("license:deactivate", async () => {
  return await deactivateLicense(db); // ← add db
});
ipcMain.handle("license:getKey", () => getSavedKey());
ipcMain.handle("license:getMachineId", () => getMachineId());

ipcMain.on("license:activated", async () => {
  console.log("[main] license:activated received");
  if (licenseWindow && !licenseWindow.isDestroyed()) {
    licenseWindow.close();
  }
  await openMainApp();
});

ipcMain.on("app:quit", () => {
  app.quit();
});

// ── DB init ───────────────────────────────────────────────────────────────────
const db = getDb();

// ── Open main app ─────────────────────────────────────────────────────────────
const openMainApp = async () => {
  if (!openMainApp._initialized) {
    initSchema(db);
    registerStoreHandlers(db, ipcMain);
    openMainApp._initialized = true;
  }
  await createWindow();
};
openMainApp._initialized = false;

// ── App ready ─────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  log("[1] app ready");
  log("[userData]", app.getPath("userData"));
  log("[resourcesPath]", process.resourcesPath);

  const publicDir = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", ".output", "public")
    : path.join(__dirname, "../.output/public");

  log("[publicDir]", publicDir);
  log("[publicDir exists]", fs.existsSync(publicDir));

  // Log what's actually in resourcesPath
  if (app.isPackaged) {
    try {
      log(
        "[resources contents]",
        fs.readdirSync(process.resourcesPath).join(", "),
      );
    } catch (e) {
      log("[resources read error]", e.message);
    }
  }

  registerProtocol();

  initSchema(db);
  registerStoreHandlers(db, ipcMain);
  openMainApp._initialized = true;

  let license;
  try {
    license = await verifyLicense();
    console.log("[2] license result:", JSON.stringify(license));
  } catch (err) {
    console.error("[2] verifyLicense THREW:", err.message);
    license = { ok: false, reason: "error" };
  }

  console.log("[3] license.ok =", license.ok);

  if (!license.ok) {
    console.log("[4] opening license window");
    await createLicenseWindow();
    return;
  }

  console.log("[4] opening main app");
  await createWindow();
});

// ── macOS dock re-open ────────────────────────────────────────────────────────
app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const license = await verifyLicense();
    if (license.ok) await openMainApp();
    else await createLicenseWindow();
  }
});

app.on("browser-window-created", (_, win) => {
  console.log("[window created] id:", win.id);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
