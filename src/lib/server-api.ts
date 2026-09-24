import { auth } from "@/lib/firebase";

/** POST to the app's own server routes (src/server/router.ts) as the signed-in staff member. */
export async function callServer<T>(path: string, body: unknown = {}): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Please sign in again.");
  const response = await fetch(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok)
    throw new Error(
      data.error ??
        (response.status === 500
          ? "The server is not set up yet (FIREBASE_SERVICE_ACCOUNT on Vercel)."
          : `Server error ${response.status}`),
    );
  return data;
}

/** GET from the app's own server routes as the signed-in staff member. */
export async function getServer<T>(path: string): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Please sign in again.");
  const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Server error ${response.status}`);
  return data;
}
