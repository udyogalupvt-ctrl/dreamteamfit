/**
 * Cloudflare Worker relay for fingerprint machines that cannot use HTTPS (e.g. ZKTeco MB360).
 * Free, always on, no PC needed.
 *
 * Cloudflare dashboard → Workers & Pages → Create → Worker → Deploy → Edit code → paste this
 * file → Deploy. The worker's address looks like rf-door.<your-name>.workers.dev.
 *
 * On the machine (Menu → Comm. → Cloud Server Setting): Server Mode ADMS, Enable Domain Name ON,
 * Server Address = the worker's address, Server Port 80, Proxy OFF.
 *
 * Every /iclock/... request is passed to the app unchanged and the answer comes back as plain
 * text with a fixed length (what these machines expect).
 */
const APP = "https://dreamteamfit.vercel.app";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (!url.pathname.toLowerCase().startsWith("/iclock/")) return new Response("OK");
    const upstream = await fetch(APP + url.pathname + url.search, {
      method: request.method,
      headers: { "content-type": request.headers.get("content-type") ?? "text/plain" },
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": "text/plain" },
    });
  },
};
