#!/usr/bin/env node
/**
 * ADMS relay for fingerprint devices whose firmware cannot use HTTPS.
 *
 * Run it on any always-on PC in the gym (same network as the device):
 *   node tools/adms-relay.mjs https://us-central1-<project-id>.cloudfunctions.net/iclock 8081
 *
 * Then on the device set Cloud Server = <this PC's LAN IP>, port 8081, HTTPS off.
 * Every /iclock/... request is forwarded unchanged to the cloud endpoint and the
 * answer is passed back. No dependencies: Node 18+ only.
 */
import http from "node:http";

const target = process.argv[2];
const port = Number(process.argv[3] ?? 8081);
if (!target || !/^https:\/\//.test(target)) {
  console.error("Usage: node tools/adms-relay.mjs https://<region>-<project>.cloudfunctions.net/iclock [port]");
  process.exit(1);
}
const base = target.replace(/\/+$/, "");

http
  .createServer(async (req, res) => {
    try {
      // Device paths look like /iclock/cdata?SN=...; the cloud URL already ends in /iclock.
      const path = (req.url ?? "/").replace(/^\/iclock/i, "");
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const upstream = await fetch(base + path, {
        method: req.method,
        headers: { "content-type": req.headers["content-type"] ?? "text/plain" },
        body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, { "Content-Type": "text/plain" });
      res.end(text);
      console.log(new Date().toISOString(), req.method, req.url, "→", upstream.status);
    } catch (error) {
      console.error(new Date().toISOString(), req.method, req.url, "failed:", error.message);
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("ERROR");
    }
  })
  .listen(port, () => console.log(`ADMS relay listening on :${port} → ${base}`));
