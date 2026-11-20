// The service worker that keeps the app offline, and the check for a newer deploy than the page that is running.

const ASSETS = '[src^="./assets/"], [href^="./assets/"]';

function fingerprint(paths) {
    return [...paths].sort().join(' ');
}

/** Registers the service worker; onReady is called when a newer version is cached and a reload would show it. */
export function watchForUpdates(onReady) {
    if (!('serviceWorker' in navigator)) {
        return;
    }
    navigator.serviceWorker.register('./sw.js');
    const running = fingerprint(
        [...document.querySelectorAll(ASSETS)].map((node) => node.getAttribute('src') ?? node.getAttribute('href')),
    );
    navigator.serviceWorker.addEventListener('message', (event) => {
        const assets = event.data?.type === 'page' ? event.data.assets : [];
        if (assets.length > 0 && fingerprint(assets) !== running) {
            onReady();
        }
    });
    const check = async () => {
        const registration = await navigator.serviceWorker.ready;
        registration.update().catch(() => {});
        registration.active?.postMessage('check-update');
    };
    check();
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            check();
        }
    });
}
