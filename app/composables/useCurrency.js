// store-app/composables/useCurrency.js
// Shared reactive singleton via useState.
// loadSettings() can be called from any page; subsequent calls are no-ops
// unless forceReload=true. Settings page calls forceReload after saving
// so that currency symbols update everywhere immediately.

export const useCurrency = () => {
  const settings = useState("currencySettings", () => ({}));
  const _loaded = useState("currencyLoaded", () => false);

  const dollarRate = computed(
    () => parseFloat(settings.value?.dollar_rate ?? "15000") || 15000,
  );
  const reportCurrency = computed(
    () => settings.value?.report_currency ?? "SP",
  );

  /** Load (or reload) settings from the store. */
  const loadSettings = async (forceReload = false) => {
    if (!import.meta.client) return;
    if (_loaded.value && !forceReload) return;
    const store = useStore();
    const r = await store.getSettings();
    if (r.ok) {
      settings.value = { ...r.data }; // spread forces Vue reactivity update
      _loaded.value = true;
    }
  };

  const fromSP = (amountSp) =>
    reportCurrency.value === "USD" ? amountSp / dollarRate.value : amountSp;

  const toSP = (amount, currency) =>
    currency === "USD" ? amount * dollarRate.value : amount;

  const toDisplay = (amount, currency) => fromSP(toSP(amount, currency));

  const fmt = (amount, currency = null) => {
    const cur = currency ?? reportCurrency.value;
    if (cur === "USD") {
      return (
        "$" +
        Number(amount ?? 0).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      );
    }
    return (
      Number(amount ?? 0).toLocaleString("en-US", {
        maximumFractionDigits: 0,
      }) + " ل.س"
    );
  };

  const fmtSP = (amountSp) => fmt(fromSP(amountSp));
  const currencyLabel = (cur = null) =>
    (cur ?? reportCurrency.value) === "USD" ? "USD ($)" : "SP (ل.س)";

  return {
    settings,
    dollarRate,
    reportCurrency,
    loadSettings,
    toSP,
    fromSP,
    toDisplay,
    fmt,
    fmtSP,
    currencyLabel,
  };
};
