const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseV1Options, FuseVersion } = require("@electron/fuses");
const path = require("path");
const fse = require("fs-extra");

module.exports = {
  packagerConfig: {
    name: "StoreCore",
    executableName: "storecore",
    asar: true,
    icon: path.join(__dirname, "../public/logo/logo"),
    asarUnpack: [
      "**/node_modules/better-sqlite3/**",
      "**/node_modules/node-machine-id/**",
    ],
  },
  hooks: {
    postPackage: async (forgeConfig, options) => {
      const src = path.join(__dirname, "public_nuxt");
      const dest = path.join(
        options.outputPaths[0],
        "resources",
        "app.asar.unpacked",
        "public_nuxt",
      );
      console.log(`[postPackage] Copying ${src} → ${dest}`);
      await fse.copy(src, dest, { overwrite: true, dereference: true });
      console.log(`[postPackage] Done`);
    },
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "storecore",
        setupExe: "StoreCore-Setup.exe",
        setupIcon: path.join(__dirname, "../public/logo/logo.ico"),
        noMsi: true,
      },
    },
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-auto-unpack-natives",
      config: {},
    },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
