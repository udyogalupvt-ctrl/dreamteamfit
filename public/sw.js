/*
 * REBUILD FITNESS service worker: makes the web app installable ("Install app"), shows a simple
 * page when there is no internet, and shows the phone notifications of the member app / trainer
 * app (renewal and payment reminders, trainer chat, announcements). It never caches the app
 * itself, so every visit (and every installed window) always gets the latest version.
 */
const CACHE = "rf-offline-v3";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([OFFLINE, "/icons/icon-192.png", "/icons/badge-96.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Only page loads: straight to the network. A short blip (Wi-Fi switching, a dropped
// connection) is tried again twice before the offline page, which then reloads by itself when
// the internet is back.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function loadPage(request) {
  for (let i = 0; i < 3; i += 1) {
    try {
      return await fetch(request);
    } catch {
      if (i < 2) await wait(700 * (i + 1));
    }
  }
  return (await caches.match(OFFLINE)) || Response.error();
}
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(loadPage(event.request));
});

// A notification from the gym's server: { title, body, url, tag }.
self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(d.title || "REBUILD FITNESS", {
      body: d.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: d.tag || undefined,
      renotify: Boolean(d.tag),
      data: { url: d.url || "/" },
    }),
  );
});

// Tapping it opens the app on the right page (the already-open window when there is one).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const mine = wins.find((w) => new URL(w.url).pathname === url.pathname);
      if (mine)
        return mine
          .focus()
          .then(() => mine.navigate(url.href))
          .catch(() => undefined);
      return self.clients.openWindow(url.href);
    }),
  );
});
