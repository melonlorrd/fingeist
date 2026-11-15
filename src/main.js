import './ui/style.css';

import {createApp} from './core/app.js';
import {deviceClock} from './platform/clock.js';
import {openStore, persistStorage} from './platform/store.js';
import {startShell} from './ui/shell.js';

async function start() {
    const store = await openStore();
    await persistStorage();
    const app = await createApp({store, crypto: globalThis.crypto, fetch: globalThis.fetch.bind(globalThis), clock: deviceClock});
    startShell(app);
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js');
}

start().catch((err) => {
    const root = document.getElementById('app');
    if (root) {
        root.textContent = `Fingeist could not start: ${err?.message ?? err}`;
    }
});
