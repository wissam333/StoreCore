// composables/useTheme.js
export const useTheme = () => {
  const primaryColor = useState("primaryColor", () => "#d32f2f");
  const isDark = useState("isDark", () => false);

  const palettes = [
    { label: "Red", value: "#d32f2f" },
    { label: "Navy", value: "#0c1739" },
    { label: "Indigo", value: "#4338ca" },
    { label: "Blue", value: "#2563eb" },
    { label: "Teal", value: "#0d9488" },
    { label: "Green", value: "#16a34a" },
    { label: "Purple", value: "#7c3aed" },
    { label: "Slate", value: "#475569" },
  ];

  const hexToRgba = (hex, alpha) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const applyTheme = (color, dark) => {
    if (!import.meta.client) return;
    const root = document.documentElement;

    root.style.setProperty("--primary", color);
    root.style.setProperty("--primary-soft", hexToRgba(color, 0.1));
    root.style.setProperty("--primary-mid", hexToRgba(color, 0.2));
    root.style.setProperty("--secondary", "#0c1739");
    root.style.setProperty("--secondary-soft", "rgba(12, 23, 57, 0.1)");
    root.style.setProperty("--secondary-mid", "rgba(12, 23, 57, 0.2)");

    if (dark) {
      root.style.setProperty("--bg-page", "#0f1117");
      root.style.setProperty("--bg-surface", "#1a1d27");
      root.style.setProperty("--bg-elevated", "#22263a");
      root.style.setProperty("--border-color", "#2e3347");
      root.style.setProperty("--text-primary", "#f1f5f9");
      root.style.setProperty("--text-muted", "#64748b");
      root.style.setProperty("--text-sub", "#94a3b8");
      root.classList.add("dark");
    } else {
      root.style.setProperty("--bg-page", "#f1f5f9");
      root.style.setProperty("--bg-surface", "#ffffff");
      root.style.setProperty("--bg-elevated", "#f8fafc");
      root.style.setProperty("--border-color", "#e2e8f0");
      root.style.setProperty("--text-primary", "#0c1739");
      root.style.setProperty("--text-muted", "#94a3b8");
      root.style.setProperty("--text-sub", "#64748b");
      root.classList.remove("dark");
    }

    localStorage.setItem("theme-color", color);
    localStorage.setItem("theme-dark", String(dark));
  };

  const setColor = (color) => {
    primaryColor.value = color;
    applyTheme(color, isDark.value);
  };

  const toggleDark = () => {
    isDark.value = !isDark.value;
    applyTheme(primaryColor.value, isDark.value);
  };

  const init = () => {
    if (!import.meta.client) return;
    const savedColor = localStorage.getItem("theme-color") || "#d32f2f";
    const savedDark = localStorage.getItem("theme-dark") === "true";
    primaryColor.value = savedColor;
    isDark.value = savedDark;
    applyTheme(savedColor, savedDark);
  };

  return { primaryColor, isDark, palettes, setColor, toggleDark, init };
};
