// store-app/composables/useUuid.js
// Generates RFC-4122 v4 UUIDs without any dependency.
// Works in both Electron (Node crypto) and Capacitor (Web Crypto API).

export const generateUuid = () => {
  // Web Crypto — available in both browser and modern Node
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback: manual v4 construction
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
};