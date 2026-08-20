import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // The Go SSR response references these two entry assets directly. Keep
    // chunks/media hashed, but give the entry JS/CSS stable names; nginx
    // serves only these two with revalidation instead of immutable caching.
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: "assets/app.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith(".css")
            ? "assets/app.css"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_BASE_URL ?? "http://localhost:8080",
        changeOrigin: true,
      },
      // OneMap tile passthrough — same path shape as nginx in prod, but no
      // caching here (dev only). Rewrites /tiles/onemap/15/x/y.png →
      // /maps/tiles/Default/15/x/y.png on www.onemap.gov.sg.
      "/tiles/onemap": {
        target: "https://www.onemap.gov.sg",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/tiles\/onemap/, "/maps/tiles/Default"),
      },
    },
  },
});
