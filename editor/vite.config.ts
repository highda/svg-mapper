import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // The autonomous loop points this at its ignored writable runtime directory.
  // Normal local development retains Vite's standard node_modules cache.
  ...(process.env.CODEX_VITE_CACHE_DIR
    ? { cacheDir: process.env.CODEX_VITE_CACHE_DIR }
    : {}),
  plugins: [tailwindcss(), react()],
  server: {
    fs: {
      // Allow importing the renderer build (?raw) from outside the editor root.
      allow: [".."],
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
