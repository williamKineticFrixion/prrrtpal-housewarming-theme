import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";


export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Pr\u00b3Tpal \u2014 Fontanez Housewarming",
        short_name: "Housewarming",
        description: "Private housewarming invite \u2014 RSVP, potluck, photos, games, and registry.",
        theme_color: "#C96F4A",
        background_color: "#F7F1E6",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png"
          }
        ]
      }
    })
  ],
  server: { port: 5173 },
});
