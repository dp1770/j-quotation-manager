const CACHE_NAME = 'qm-quotes-v3.5.3';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/custom.css',
  './js/app.js',
  './js/storage.js',
  './js/auth.js',
  './js/csv-helper.js',
  './js/calculations.js',
  './js/pdf-generator.js',
  './js/default-data.js',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/sample-banner.svg',
  './assets/sample-signature.svg',
  './assets/header-roof-logo.svg',
  './assets/product-gallery-page7.svg',
  './assets/profile-indradhanus.svg',
  './assets/profile-crimping.svg',
  './assets/profile-polycarbonate.svg',
  './assets/profile-gutter.svg'
];

const EXTERNAL_CDNS = [
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      const localPromise = cache.addAll(ASSETS_TO_CACHE);
      const cdnPromises = EXTERNAL_CDNS.map((url) =>
        fetch(url, { mode: 'cors' })
          .then((response) => {
            if (response.ok) {
              return cache.put(url, response);
            }
          })
          .catch((err) => console.log('CDN pre-cache skipped:', url))
      );
      return Promise.all([localPromise, ...cdnPromises]);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('Purging old service worker cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Network-First strategy for local scripts & HTML, Cache-First for CDNs & fallback for offline
self.addEventListener('fetch', (event) => {
  // Only process standard http and https requests (ignore chrome-extension://, file://, etc.)
  if (!event.request.url.startsWith('http://') && !event.request.url.startsWith('https://')) {
    return;
  }

  const requestUrl = new URL(event.request.url);

  // If request is Cloudflare Worker API endpoint, network-first with offline JSON fallback
  if (requestUrl.pathname.startsWith('/api') || requestUrl.hostname.includes('workers.dev')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({
            success: false,
            status: 'offline',
            message: 'Network offline. Operating with local database.'
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // Network-First for local HTML & JS files so updates reflect immediately
  const isLocalFile = event.request.url.startsWith(self.location.origin) || event.request.mode === 'navigate';
  if (isLocalFile) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (event.request.method === 'GET' && networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            if (cached) return cached;
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html');
            }
          });
        })
    );
    return;
  }

  // Stale-While-Revalidate for external CDN libraries
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (event.request.method === 'GET' && networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      }).catch(() => null);

      return cachedResponse || fetchPromise;
    })
  );
});
