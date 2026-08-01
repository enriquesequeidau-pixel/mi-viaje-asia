const CACHE_NAME = 'asia-2026-offline-v5';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './app-icon.png'
];

// Estas dependencias son las que dan estilo e iconos a la app. Se guardan al
// instalarla para que la interfaz siga funcionando sin señal.
const REMOTE_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/lucide@latest',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Noto+Serif:ital,wght@0,400;0,700;1,400&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);

    await Promise.allSettled(REMOTE_ASSETS.map(async (url) => {
      const response = await fetch(new Request(url, { mode: 'no-cors' }));
      if (response) await cache.put(url, response);
    }));

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name === 'asia-trip-v2' || (name.startsWith('asia-2026-offline-') && name !== CACHE_NAME))
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Para el documento principal se busca primero una versión nueva. Si no hay
  // red, se abre la copia que quedó guardada en el teléfono.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put('./index.html', response.clone());
        }
        return response;
      } catch {
        return (await caches.match('./index.html')) || (await caches.match('./'));
      }
    })());
    return;
  }

  // Recursos visuales y scripts: primero la copia local, luego la red. Así la
  // app abre rápido y puede usar Tailwind/Lucide cuando no exista conexión.
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
      const response = await fetch(request);
      if (response && (response.ok || response.type === 'opaque')) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      return new Response('', { status: 503, statusText: 'Sin conexión' });
    }
  })());
});
