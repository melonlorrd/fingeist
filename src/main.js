import './ui/style.css';

import {createApp} from './core/app.js';
import {deviceClock} from './platform/clock.js';
import {openStore, persistStorage} from './platform/store.js';
import {watchForUpdates} from './platform/updates.js';
import {startShell} from './ui/shell.js';

let offerUpdate = () => {};

async function start() {
    const store = await openStore();
    await persistStorage();
    const app = await createApp({store, crypto: globalThis.crypto, fetch: globalThis.fetch.bind(globalThis), clock: deviceClock});
    const shell = startShell(app);
    offerUpdate = () => shell.notify('A new version of Fingeist is ready.', false, {label: 'Reload', run: () => location.reload()});
}

if (import.meta.env.PROD) {
    watchForUpdates(() => offerUpdate());
}

start().catch((err) => {
    const root = document.getElementById('app');
    if (root) {
        root.textContent = `Fingeist could not start: ${err?.message ?? err}`;
    }
});
