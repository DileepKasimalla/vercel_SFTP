import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the FastAPI server runs separately on :8000; the proxy keeps
// the frontend calling the same /api paths it uses in production on Vercel.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
