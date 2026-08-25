/* global self, caches */

const CACHE_VERSION = "stor24-shell-__BUILD_VERSION__";
const SHELL_ASSETS = [
  "/offline.html",
  "/offline-workspace.html",
  "/offline-workspace.css",
  "/offline-workspace.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/brand/stor24-logo-dark.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((asset) => cache.add(asset))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("stor24-shell-") && key !== CACHE_VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Authentication, APIs and every business-data request remain network-only.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    if (url.pathname === "/offline-workspace.html") {
      event.respondWith(fetch(request).catch(() => caches.match("/offline-workspace.html")));
      return;
    }
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
    return;
  }

  const shellAsset = SHELL_ASSETS.includes(url.pathname);
  const approvedBrandAsset = url.pathname.startsWith("/brand/") || url.pathname.startsWith("/icons/");

  if (shellAsset || approvedBrandAsset) {
    event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
  }
});
