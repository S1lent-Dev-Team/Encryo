import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // auf allen Interfaces lauschen (Tunnel/Reverse-Proxy)
    port: 5173,
    // Tunnel-/Proxy-Domains, die auf den Dev-Server zeigen dürfen.
    allowedHosts: ["encryo.s1lent.dev", ".s1lent.dev", "localhost"],
    // Im Dev leitet Vite API-Aufrufe an den Express-Server weiter.
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
