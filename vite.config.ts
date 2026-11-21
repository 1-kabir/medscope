import { defineConfig } from "vite";
import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Two pages: the landing at "/" and the app at "/app.html". Visitors see the
  // landing first; installed PWAs and returning devices open straight into the
  // app via the manifest start_url.
  build: {
    rollupOptions: {
      input: {
        landing: path.resolve(__dirname, "index.html"),
        app: path.resolve(__dirname, "app.html"),
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "MedScope",
        short_name: "MedScope",
        description: "Offline-first medicine reminders in Bengali",
        lang: "bn",
        display: "standalone",
        background_color: "#0f172a",
        theme_color: "#0f172a",
        start_url: "/app.html",
        scope: "/",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,wasm,png,svg,woff2}"],
        navigateFallback: "/app.html",
      },
    }),
  ],
});
