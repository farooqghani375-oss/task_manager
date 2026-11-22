/* Service worker: makes the app load offline after the first visit.
   Bump CACHE_VERSION whenever you change any app file, so users get the update. */

const CACHE_VERSION = "task-manager-v11";
const APP_SHELL = [
    "./",
    "./index.html",
    "./style.css",
    "./features.css",
    "./pwa.css",
    "./layout.css",
    "./pages.css",
    "./settings.css",
    "./theme.css",
    "./plan.css",
    "./plan.js",
    "./script.js",
    "./nav.js",
    "./manifest.webmanifest",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "./icons/icon-maskable-512.png",
    "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
    );
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// Network first (so updates arrive), falling back to the cache when offline
self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

    event.respondWith(
        fetch(request)
            .then((response) => {
                const copy = response.clone();
                caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
                return response;
            })
            .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")))
    );
});

// Tapping a notification brings the app back to the front
self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
            if (clients.length) return clients[0].focus();
            return self.clients.openWindow("./index.html");
        })
    );
});
