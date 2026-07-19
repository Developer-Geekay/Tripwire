import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Extension pages are served from chrome-extension://<id>/, so keep paths
// relative and never inline module preloads (MV3 CSP forbids inline scripts).
export default defineConfig({
  plugins: [react()],
  base: "",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      input: {
        panel: resolve(__dirname, "panel.html"),
        tab: resolve(__dirname, "tab.html"),
        background: resolve(__dirname, "src/background/service-worker.ts"),
        // Injected via chrome.scripting.executeScript as a classic script —
        // it must bundle to a single root-level file with no imports/exports.
        picker: resolve(__dirname, "src/content/picker.ts"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "background" || chunk.name === "picker"
            ? "[name].js"
            : "assets/[name]-[hash].js",
      },
    },
  },
});
