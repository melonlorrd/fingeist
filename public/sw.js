// Keeps the app usable offline. The page is fetched fresh when the network answers quickly, so a new
// deploy is picked up on the next open; built assets have content hashes, so the cached copy is safe,
// and assets the current page no longer uses are dropped.

const CACHE = 'fingeist';
const NAVIGATION_TIMEOUT_MS = 3000;
const STATIC = ['./', './manifest.webmanifest', './icon.svg', './apple-touch-icon.png', './icon-512.png'];

function assetsOf(html) {
    return [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map((m) => m[1]);
}

async function cachePage(cache, response) {
    const html = await response.clone().text();
    await cache.put('./', response.clone());
    const keep = new Set([...STATIC, ...assetsOf(html)].map((path) => new URL(path, self.registration.scope).href));
    await Promise.all(assetsOf(html).map((path) => cache.match(path).then((hit) => hit ?? cache.add(path))));
    for (const request of await cache.keys()) {
        if (!keep.has(request.url) && request.url.includes('/assets/')) {
            await cache.delete(request);
        }
    }
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE);
            await cache.addAll(STATIC);
            await cachePage(cache, await cache.match('./'));
            await self.skipWaiting();
        })(),
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

async function navigate(request) {
    const cache = await caches.open(CACHE);
    try {
        const response = await Promise.race([
            fetch(request),
            new Promise((_, reject) => setTimeout(() => reject(new Error('slow network')), NAVIGATION_TIMEOUT_MS)),
        ]);
        if (response.ok) {
            await cachePage(cache, response.clone());
        }
        return response;
    } catch {
        return (await cache.match('./')) ?? Response.error();
    }
}

async function asset(request) {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(request);
    if (hit) {
        return hit;
    }
    const response = await fetch(request);
    if (response.ok) {
        await cache.put(request, response.clone());
    }
    return response;
}

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
        return;
    }
    event.respondWith(event.request.mode === 'navigate' ? navigate(event.request) : asset(event.request));
});
