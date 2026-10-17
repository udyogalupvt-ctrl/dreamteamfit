import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

// Security headers on every response. The Content-Security-Policy is report-only for now: the
// browser console lists anything it would block, nothing is blocked yet (enforce after a clean week).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.googleapis.com wss://*.firebaseio.com https://*.firebaseio.com https://api.cloudinary.com https://res.cloudinary.com",
  "frame-src 'self' https://*.firebaseapp.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
  "Content-Security-Policy-Report-Only": CSP,
};

// This build's version, the same in the browser and the server: a tab left open on an older
// version sees /api/version change and loads the new one (src/routes/__root.tsx).
const APP_BUILD = (process.env["VERCEL_GIT_COMMIT_SHA"] ?? "").slice(0, 12) || `b${Date.now()}`;

export default defineConfig(({ command }) => ({
  define: { __APP_BUILD__: JSON.stringify(command === "build" ? APP_BUILD : "dev") },
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
            routeRules: { "/**": { headers: SECURITY_HEADERS } },
            vercel: {
              // A machine's big upload (hundreds of users) must not be cut off after 10 s.
              functions: { maxDuration: 60 },
              config: {
                version: 3,
                crons: [
                  { path: "/api/cron/morning", schedule: "30 2 * * *" },
                  { path: "/api/cron/night", schedule: "0 16 * * *" },
                  { path: "/api/cron/backup", schedule: "0 17 * * *" },
                  { path: "/api/cron/backup?run=2", schedule: "0 18 * * *" },
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
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  server: { port: 8080 },
}));
