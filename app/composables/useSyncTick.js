// Global tick counter — incremented after every successful sync cycle.
// Pages watch this to know when to reload their data.
export const useSyncTick = () => useState("syncTick", () => 0);