// Keeps the app usable offline. The page is revalidated with the server on every open and is cached even
// when it arrives too late for that open, so a new deploy is picked up on the next one at the latest; the
// app also asks for a check when it comes back to the foreground (iOS resumes a home screen app without
// reloading it) and offers a reload. Built assets have content hashes, so the cached copy is safe, and
// assets the current page no longer uses are dropped.

const CACHE = 'fingeist';
const NAVIGATION_TIMEOUT_MS = 3000;
const STATIC = ['./', './manifest.webmanifest', './icon.svg', './apple-touch-icon.png', './icon-512.png', './icon-maskable-512.png'];

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

// no-cache revalidates with the server instead of trusting the HTTP cache, which may be minutes old.
async function freshPage(url) {
    const response = await fetch(url, {cache: 'no-cache'});
    if (response.ok) {
        await cachePage(await caches.open(CACHE), response.clone());
    }
    return response;
}

async function navigate(event) {
    const refresh = freshPage(event.request.url);
    event.waitUntil(refresh.catch(() => {}));
    try {
        return await Promise.race([
            refresh,
            new Promise((_, reject) => setTimeout(() => reject(new Error('slow network')), NAVIGATION_TIMEOUT_MS)),
        ]);
    } catch {
        return (await (await caches.open(CACHE)).match('./')) ?? Response.error();
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
    event.respondWith(event.request.mode === 'navigate' ? navigate(event) : asset(event.request));
});

// The app asks after opening and on coming back to the foreground; the reply lists the assets of the newest page.
self.addEventListener('message', (event) => {
    if (event.data !== 'check-update') {
        return;
    }
    event.waitUntil(
        freshPage('./')
            .then(async (response) => {
                if (response.ok) {
                    event.source?.postMessage({type: 'page', assets: assetsOf(await response.text())});
                }
            })
            .catch(() => {}),
    );
});
