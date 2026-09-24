/**
 * Server endpoints that live inside the same Vercel deployment as the app (one function on the
 * free plan). src/server.ts sends every /api/* and /iclock/* request here.
 */
import { handleCron } from "./automation";
import { handleIclock } from "./biometric";
import { handleStaff } from "./staff";
import { handleMemberPhoto } from "./member-photo";
import { json, serverHealth, text } from "./admin";
import { handleWhatsApp } from "./whatsapp";

export async function handleServerRoute(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  try {
    if (path === "/api/health") return json(await serverHealth());
    if (/^\/iclock(\/|$)/i.test(path)) return await handleIclock(request, url);
    if (path.startsWith("/api/whatsapp/")) return await handleWhatsApp(request, url);
    if (path.startsWith("/api/cron/")) return await handleCron(request, url);
    if (path.startsWith("/api/staff/")) return await handleStaff(request, url);
    if (path === "/api/member-photo") return await handleMemberPhoto(request, url);
    return text("Not found", 404);
  } catch (error) {
    console.error("server route failed", path, error);
    return text(
      String(error).includes("FIREBASE_SERVICE_ACCOUNT")
        ? "Server is not configured (open /api/health)"
        : "Server error (open /api/health)",
      500,
    );
  }
}
