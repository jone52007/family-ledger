/* 讓 App 在沒網路時也能打開（資料本身由 Firestore 離線快取處理） */
const CACHE = "family-ledger-20261113120433";
const SHELL = ["./", "index.html", "app.css", "app.js", "firebase-config.js", "manifest.webmanifest",
  "icons/icon-192.png", "assets/Font/KenneyFuture.ttf"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;   // Firebase 連線不攔截
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(url.pathname, {cache:"no-cache"}).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put("index.html", c)); return r; }).catch(() => caches.match("index.html")));
    return;
  }
  // 有網路時抓最新版，沒網路才用快取（避免要重新整理兩次才更新）
  e.respondWith(fetch(new Request(e.request, {cache:"no-cache"})).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request)));
});

/* ---------- 推播通知 ---------- */
self.addEventListener("push", e => {
  let d = {};
  try { const j = e.data ? e.data.json() : {}; d = j.data || j.notification || j; } catch(err) { d = {body: e.data ? e.data.text() : ""}; }
  const title = d.title || "家庭記帳本";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || "", tag: d.tag || undefined, icon: "icons/icon-192.png", badge: "icons/icon-192.png",
    data: {url: d.url || "./#overview"}
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "./#overview", self.registration.scope).href;
  e.waitUntil(clients.matchAll({type: "window", includeUncontrolled: true}).then(list => {
    for (const c of list) { if (c.url.startsWith(self.registration.scope)) { c.navigate(url); return c.focus(); } }
    return clients.openWindow(url);
  }));
});
