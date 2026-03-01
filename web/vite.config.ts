import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const devBackendTarget = "http://127.0.0.1:8787";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  server: {
    proxy: {
      "/api": devBackendTarget,
      "/healthz": devBackendTarget,
      "^/[^/]+/[^/]+\\.git(?:/.*)?$": devBackendTarget,
      "^/[^/]+/[^/]+/(?:info/refs|git-upload-pack|git-receive-pack)$": devBackendTarget
    }
  }
});
