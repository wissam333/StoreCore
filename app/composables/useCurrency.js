// store-app/composables/useCurrency.js
export const useCurrency = () => {
  const settings = useState("currencySettings", () => ({}));
  const _loaded = useState("currencyLoaded", () => false);

  const dollarRate = computed(
    () => parseFloat(settings.value?.dollar_rate ?? "15000") || 15000,
  );
  const reportCurrency = computed(
    () => settings.value?.report_currency ?? "SP",
  );

  const loadSettings = async (forceReload = false) => {
    if (!import.meta.client) return;
    if (_loaded.value && !forceReload) return;
    const store = useStore();
    const r = await store.getSettings();
    if (r.ok) {
      settings.value = { ...r.data };
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

  // ── For REPORTS only ───────────────────────────────────────────────────────
  // Aggregated SP values (revenue totals, charts, dashboard). Uses current
  // rate for SP→USD conversion. Acceptable because reports summarise across
  // time, not a specific transaction.
  const fmtSP = (amountSp) => fmt(fromSP(amountSp));

  // ── For TRANSACTIONS (orders, payments, dues) ──────────────────────────────
  // Never re-derives a frozen value. Rule:
  //   report=SP  → always show frozen amount_sp (never touches current rate)
  //   report=USD, source=USD → show frozen amount (exact, rate-independent)
  //   report=USD, source=SP  → amount_sp ÷ current rate (only live calc allowed)
  const fmtTx = (amount, currency, amountSp) => {
    if (reportCurrency.value === "SP") {
      // Use the frozen SP equivalent stored at creation time
      const sp = amountSp ?? (currency === "SP" ? amount : null);
      if (sp == null) return fmt(amount, currency); // last-resort fallback
      return fmt(sp, "SP");
    }
    // Displaying in USD
    if (currency === "USD") {
      return fmt(amount, "USD"); // frozen USD amount — never changes
    }
    // Source is SP, display in USD: only acceptable live conversion
    const sp = amountSp ?? amount;
    return fmt(sp / dollarRate.value, "USD");
  };

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
    fmtSP, // reports only
    fmtTx, // transactions: orders, payments, dues
    currencyLabel,
  };
};
