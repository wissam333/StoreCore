import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.medicore.app",
  appName: "StoreCore",
  webDir: ".output/public",
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
