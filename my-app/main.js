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

// run on startup
// if (process.platform === "win32") {
//   const command = process.argv[1];
//   if (command === "--squirrel-install" || command === "--squirrel-updated") {
//     app.setLoginItemSettings({
//       openAtLogin: true,
//       path: path.join(path.dirname(process.execPath), "..", "Update.exe"),
//       args: [
//         "--processStart",
//         `"${path.basename(process.execPath)}"`,
//         "--process-start-args",
//         '"--autostart"',
//       ],
//     });
//   } else if (command === "--squirrel-uninstall") {
//     app.setLoginItemSettings({ openAtLogin: false });
//   }
// }

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

// ── License IPC ───────────────────────────────────────────────────────────────

// KEY FIX: activate handler now checks that the key was actually written to
// disk before returning ok:true. If storage fails, we return ok:false with a
// diagnostic error so the license page shows it — the user keeps the input
// field and can try again. We never call onActivated() unless save confirmed.
ipcMain.handle("license:activate", async (_, key) => {
  log("[license:activate] key:", key?.slice(0, 8) + "...");

  const result = await activateLicense(key, db);
  log("[license:activate] server result:", JSON.stringify(result));

  if (!result.ok) return result; // server rejected — pass error straight through

  // Confirm the key landed on disk
  const saved = getSavedKey();
  log("[license:activate] getSavedKey after save:", saved ? "OK ✓" : "NULL ✗");

  if (!saved) {
    // Run storage diagnostics so we can see the cause in app.log
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
      // Tell the user what happened without a dead-end.
      // The input field stays open so they can retry.
      error:
        "Your license was accepted by the server but could not be saved on this PC. " +
        `Check app.log at: ${getLogFile()}`,
    };
  }

  // Key is on disk — safe to proceed
  return { ok: true };
});

ipcMain.handle("license:deactivate", async () => deactivateLicense(db));

ipcMain.handle("license:getKey", () => {
  const k = getSavedKey();
  log("[license:getKey]", k ? k.slice(0, 8) + "..." : "null");
  return k;
});

ipcMain.handle("license:getMachineId", () => getMachineId());

// This is only sent after activate() confirmed ok:true AND key is on disk.
// So we can open the main window unconditionally here.
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
