// What the screens call, put together from its parts. Browser services come in as parameters so all
// of it runs under node --test.

import {catalogApi} from './catalog.js';
import {entriesApi} from './entries.js';
import {githubRemote} from './remote/github.js';
import {syncApi} from './syncing.js';
import {viewsApi} from './views.js';
import {openWorkspace} from './workspace.js';

export {NEW_PREFIX} from './catalog.js';

/**
 * store: async key-value store (load, save, clear). crypto: WebCrypto. clock: now() gives
 * {ms, date, clock, offset}; offsetAt(date, clock) gives the device's offset then, e.g. "+05:30".
 * @param {{store: import('./types.js').Store, crypto: Crypto, fetch?: typeof globalThis.fetch,
 *   clock: import('./workspace.js').Clock,
 *   makeRemote?: (config: {repo: string, token: string}) => import('./types.js').Remote}} services
 */
export async function createApp({store, crypto, fetch, clock, makeRemote = (config) => githubRemote({fetch, ...config})}) {
    const ws = await openWorkspace({store, crypto, clock});
    const views = viewsApi(ws);
    const sync = syncApi(ws, makeRemote);
    await ws.applyDue();

    return {
        ...views,
        ...entriesApi(ws),
        ...catalogApi(ws),
        ...sync,

        boot() {
            const status = sync.syncStatus();
            return ws.local.meta ? {...views.bootData(), sync: status} : {needsSetup: true, today: ws.today(), sync: status};
        },

        async createProject({name, currency, decimals}) {
            if (ws.local.meta) {
                throw new Error('A project already exists on this device');
            }
            const meta = {
                name: String(name).trim(),
                currency: String(currency).trim().toUpperCase(),
                decimals: Number(decimals),
                created: ws.today(),
            };
            const valid =
                meta.name &&
                /^[A-Z]{3,8}$/.test(meta.currency) &&
                Number.isInteger(meta.decimals) &&
                meta.decimals >= 0 &&
                meta.decimals <= 4;
            if (!valid) {
                throw new Error('Enter a project name, a currency code such as INR, and 0 to 4 decimal places');
            }
            ws.invalidate();
            await ws.remember({meta});
        },

        /** Removes everything this app stored on this device; the remote is untouched. Start a new app afterwards. */
        async eraseDevice() {
            await store.clear();
        },
    };
}
