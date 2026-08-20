import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // sqlite-wasm 依赖 import.meta.url 相对定位 wasm 资产，esbuild 预打包会破坏它。
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
  server: {
    proxy: {
      "/api": process.env.NARRATIVE_API_PROXY ?? "http://127.0.0.1:4317",
    },
  },
});
