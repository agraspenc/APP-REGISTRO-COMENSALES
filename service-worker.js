// ============================================================
//  service-worker.js — Registro Escuadrones PWA
//  Estrategia: Cache-First con actualización en segundo plano
// ============================================================

const CACHE_NAME    = 'registro-escuadrones-v1';
const CACHE_OFFLINE = 'registro-escuadrones-offline-v1';

// Archivos que se cachean al instalar el SW
const ASSETS_TO_CACHE = [
  './comensales.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  // Fuentes de Google Fonts (se cachean en runtime si hay conexión)
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=DM+Mono:wght@400;500&family=Newsreader:ital,wght@0,400;0,600;1,400&display=swap'
];

// Página offline de respaldo (se muestra solo si falla todo)
const OFFLINE_FALLBACK = './comensales.html';

// ─────────────────────────────────────────
//  INSTALL — precachea los assets esenciales
// ─────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Instalando — cacheando assets esenciales...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // Cachea los archivos locales (obligatorio)
        // Las fuentes externas se intentan cachear pero no bloquean la instalación
        return cache.addAll([
          './comensales.html',
          './manifest.json'
        ]).then(() => {
          // Intentar cachear fuentes (sin bloquear)
          return cache.add(
            'https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=DM+Mono:wght@400;500&family=Newsreader:ital,wght@0,400;0,600;1,400&display=swap'
          ).catch(() => {
            console.log('[SW] Fuentes no disponibles offline — se usarán fuentes del sistema.');
          });
        });
      })
      .then(() => {
        console.log('[SW] Assets cacheados correctamente.');
        // Activa el nuevo SW sin esperar a que cierren las pestañas
        return self.skipWaiting();
      })
  );
});

// ─────────────────────────────────────────
//  ACTIVATE — limpia caches viejos
// ─────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activando — limpiando caches obsoletos...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME && name !== CACHE_OFFLINE)
          .map(name => {
            console.log(`[SW] Eliminando cache obsoleto: ${name}`);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log('[SW] Cache limpio. SW activo y controlando la app.');
      // Tomar control de todas las páginas abiertas inmediatamente
      return self.clients.claim();
    })
  );
});

// ─────────────────────────────────────────
//  FETCH — estrategia Cache-First
//  1. Busca en cache → devuelve inmediatamente
//  2. Si no está en cache → busca en red y lo guarda
//  3. Si la red falla → devuelve la app cacheada (funciona offline)
// ─────────────────────────────────────────
self.addEventListener('fetch', event => {
  // Solo manejar solicitudes GET
  if (event.request.method !== 'GET') return;

  // Ignorar solicitudes de extensiones del navegador
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {

        // ── Cache hit: devolver desde cache ──
        if (cachedResponse) {
          // En paralelo, actualizar el cache en segundo plano (Stale-While-Revalidate)
          const fetchPromise = fetch(event.request)
            .then(networkResponse => {
              if (networkResponse && networkResponse.status === 200) {
                const responseClone = networkResponse.clone();
                caches.open(CACHE_NAME).then(cache => {
                  cache.put(event.request, responseClone);
                });
              }
              return networkResponse;
            })
            .catch(() => { /* Sin red — no hay problema, ya tenemos cache */ });

          return cachedResponse;
        }

        // ── Cache miss: buscar en red ──
        return fetch(event.request)
          .then(networkResponse => {
            // Validar respuesta antes de cachear
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'error') {
              return networkResponse;
            }

            // Solo cachear recursos del mismo origen y fuentes de Google
            const url = event.request.url;
            const shouldCache =
              url.includes(self.location.origin) ||
              url.includes('fonts.googleapis.com') ||
              url.includes('fonts.gstatic.com');

            if (shouldCache) {
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, responseClone);
              });
            }

            return networkResponse;
          })
          .catch(() => {
            // ── Sin red y sin cache: mostrar app principal cacheada ──
            console.log('[SW] Sin conexión — sirviendo desde cache offline.');
            return caches.match(OFFLINE_FALLBACK);
          });
      })
  );
});

// ─────────────────────────────────────────
//  MESSAGE — comunicación con la app
// ─────────────────────────────────────────
self.addEventListener('message', event => {
  // La app puede pedir forzar la actualización del SW
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Actualización forzada solicitada.');
    self.skipWaiting();
  }

  // La app puede pedir info del cache
  if (event.data && event.data.type === 'GET_CACHE_STATUS') {
    caches.open(CACHE_NAME).then(cache => {
      cache.keys().then(keys => {
        event.ports[0].postMessage({
          cached: keys.map(r => r.url),
          count: keys.length
        });
      });
    });
  }
});
