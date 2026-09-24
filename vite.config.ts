import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ command }) => ({
  plugins: [
    tailwindcss(),
    tsConfigPaths(),
    tanstackStart({
      // src/server.ts wraps the SSR entry with a friendly error page.
      server: { entry: "server" },
      // Server-only modules can never be bundled into the browser.
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
    }),
    // Production server bundle (.output/). Nitro auto-detects Vercel / Netlify / Cloudflare,
    // and otherwise builds a Node server: `npm run build && npm start`.
    // Vercel free plan: one function for the whole app, and 2 daily cron jobs (times in UTC;
    // the free plan fires somewhere inside the hour). 02:30 UTC = 8 AM IST, 16:00 UTC = 9:30 PM IST.
    ...(command === "build"
      ? [
          nitro({
            // Firebase Admin loads its gRPC / proto files from disk, so it ships as plain
            // node_modules instead of being bundled.
            traceDeps: ["firebase-admin*", "@google-cloud/firestore*", "google-gax*"],
            vercel: {
              config: {
                version: 3,
                crons: [
                  { path: "/api/cron/morning", schedule: "30 2 * * *" },
                  { path: "/api/cron/night", schedule: "0 16 * * *" },
                ],
              },
            },
          }),
        ]
      : []),
    viteReact(),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  server: { port: 8080 },
}));
