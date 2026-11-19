// Band Watch by M3vrv: service worker. It lets phones and computers install Band Watch as an app
// and opens the last copy of the page when there's no connection. Live data (/api/) is never cached:
// it always comes straight from the server, so what you see is never out of date without saying so.
"use strict";
const VERSION = "1.39.0";
const CACHE = `bandwatch-${VERSION}`;
const SHELL = ["/", "/install", "/help", "/style.css", "/listen.css", "/nav.css","/install.css", "/favicon.svg", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("bandwatch-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first, so updates show at once; the saved copy is only used when the network fails.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/healthz" || url.pathname.startsWith("/download/")) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && res.type === "basic") {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: req.mode === "navigate" })
      .then((hit) => hit || (req.mode === "navigate" ? caches.match("/") : undefined))
      .then((hit) => hit || Response.error()))
  );
});
