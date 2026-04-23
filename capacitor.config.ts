import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.example.app",
  appName: "Al-Hasan-Center",
  webDir: ".output/public",
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
