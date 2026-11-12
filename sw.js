/* 讓 App 在沒網路時也能打開（資料本身由 Firestore 離線快取處理） */
const CACHE = "family-ledger-20261112094920";
const SHELL = ["./", "index.html", "app.css", "app.js", "firebase-config.js", "manifest.webmanifest",
  "icons/icon-192.png", "assets/Font/KenneyFuture.ttf"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;   // Firebase 連線不攔截
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).then(r => { caches.open(CACHE).then(c => c.put("index.html", r.clone())); return r; }).catch(() => caches.match("index.html")));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => {
    const net = fetch(e.request).then(r => { if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; }).catch(() => hit);
    return hit || net;
  }));
});
