/* App shell cache: the app opens instantly and works offline.
   Data goes straight to Supabase (never cached here). Bump VERSION on every deploy. */
const VERSION = "lc-v5";
const SHELL = ["./", "index.html", "app.css", "paper.jpg", "manifest.webmanifest",
  "vendor/supabase.js", "js/util.js", "js/db.js", "js/calendar.js", "js/tasks.js", "js/notes.js", "js/home.js", "js/main.js",
  "fonts/SKFPogo-Regular.otf", "fonts/SKFMush-Light.otf", "icons/icon48.png", "icons/icon128.png", "icons/icon192.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  /* network first (so updates arrive), cache as fallback when offline */
  e.respondWith(fetch(e.request).then(res => {
    const copy = res.clone();
    caches.open(VERSION).then(c => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
});
