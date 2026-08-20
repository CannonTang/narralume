import { resolve } from "node:path";

import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: "../../.tmp/spike-dist",
    rollupOptions: {
      input: resolve(import.meta.dirname, "spike.html"),
    },
  },
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
});
