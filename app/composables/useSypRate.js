// composables/useSypRate.js
import { Capacitor } from "@capacitor/core";

export const useSypRate = () => {
  const loading = ref(false);
  const error = ref(null);

  const getLiveRate = async () => {
    loading.value = true;
    error.value = null;
    let html = "";

    try {
      const targetUrl = "https://sp-today.com/en/currency/us-dollar";

      // 1. ENVIRONMENT DETECTION
      if (window.electronAPI) {
        html = await window.electronAPI.nativeFetch(targetUrl);
      } else if (Capacitor.isNativePlatform()) {
        const response = await fetch(targetUrl);
        html = await response.text();
      } else {
        const response = await fetch(
          `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
        );
        html = await response.text();
      }

      // 2. PARSING LOGIC
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      // LOGIC A: Try the most common table structure for SP-Today
      // They usually have a table where the first row of data is the USD rate
      let buyPrice = "";
      let sellPrice = "";

      // Try selecting by the data-label or specific table cells
      const cells = doc.querySelectorAll("td");

      if (cells.length > 0) {
        // We look for cells that contain "SYP" or specific patterns
        const rateCells = Array.from(cells).filter(
          (c) =>
            c.textContent.includes("SYP") || /[\d,]{4,}/.test(c.textContent),
        );

        if (rateCells.length >= 2) {
          buyPrice = rateCells[0].textContent.replace(/[^0-9]/g, "");
          sellPrice = rateCells[1].textContent.replace(/[^0-9]/g, "");
        }
      }

      // LOGIC B: Fallback to your original .value selector if Logic A failed
      if (!sellPrice) {
        const values = doc.querySelectorAll(".value");
        if (values.length >= 2) {
          buyPrice = values[0].textContent.replace(/[^0-9]/g, "");
          sellPrice = values[1].textContent.replace(/[^0-9]/g, "");
        }
      }

      if (!sellPrice || isNaN(parseInt(sellPrice))) {
        // DEBUG: Log a bit of the HTML to your console to see what changed
        console.warn("HTML Snippet received:", html.substring(0, 500));
        throw new Error(
          "Unable to parse rates. Website layout might have changed.",
        );
      }

      return {
        rate: parseInt(sellPrice),
        buy: parseInt(buyPrice),
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      console.error("[useSypRate Error]:", err.message);
      error.value = err.message;
      return null;
    } finally {
      loading.value = false;
    }
  };

  return { getLiveRate, loading, error };
};
