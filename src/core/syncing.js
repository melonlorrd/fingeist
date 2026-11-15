// Setting up sync, joining from another device, and running a sync.

import {AuthError} from './remote/errors.js';
import {changePassphrase, createVault, openVault} from './vault.js';

/**
 * @param {import('./workspace.js').Workspace} ws
 * @param {(config: {repo: string, token: string}) => import('./types.js').Remote} makeRemote
 */
export function syncApi(ws, makeRemote) {
    const {local, book, crypto} = ws;
    /** @type {{state: 'local' | 'idle' | 'syncing' | 'offline' | 'paused' | 'error', message: string, lastSync: number | null}} */
    let status = {state: local.remote ? 'idle' : 'local', message: '', lastSync: null};
    /** @type {Promise<typeof status> | null} */
    let running = null;

    async function runSync() {
        if (!local.remote || !local.key) {
            return status;
        }
        status = {...status, state: 'syncing', message: ''};
        try {
            const r = makeRemote(local.remote);
            await book.pull(r, crypto, local.key);
            ws.invalidate();
            await ws.applyDue();
            await book.seal(crypto, local.key);
            await book.push(r);
            status = {state: 'idle', message: '', lastSync: ws.clock.now().ms};
        } catch (err) {
            if (err instanceof AuthError) {
                status = {...status, state: 'paused', message: err.message};
            } else if (err instanceof TypeError) {
                status = {...status, state: 'offline', message: 'Offline. Changes are saved on this device and will sync later.'};
            } else {
                status = {...status, state: 'error', message: err.message};
            }
        }
        return status;
    }

    async function connectRemote(config) {
        const r = makeRemote(config);
        await r.check();
        return {r, vaultText: await r.readVault()};
    }

    async function finishConnect(config, key, name) {
        await ws.remember({remote: config, key});
        await ws.put('device', local.deviceId, {name: String(name ?? '').trim() || 'This device'});
        status = {state: 'idle', message: '', lastSync: null};
        return runSync();
    }

    const configOf = (repo, token) => ({repo: String(repo).trim(), token: String(token).trim()});

    return {
        syncStatus() {
            return {
                ...status,
                connected: Boolean(local.remote),
                repo: local.remote?.repo ?? '',
                pending: book.pending,
                deviceName: local.meta ? (ws.view().devices[local.deviceId] ?? '') : '',
            };
        },

        /** Starts syncing this device's project to an empty repo, creating its vault. */
        async connect({repo, token, deviceName, passphrase, iterations}) {
            ws.requireProject();
            const config = configOf(repo, token);
            const {r, vaultText} = await connectRemote(config);
            if (vaultText !== null) {
                throw new Error('That repository already holds Fingeist data. To use it here, erase this device and join it instead.');
            }
            const vault = await createVault({crypto, passphrase, meta: local.meta, iterations});
            await r.writeVault(vault.vaultText);
            return finishConnect(config, vault.key, deviceName);
        },

        /** Sets up this (empty) device from a repo that already has a vault. */
        async join({repo, token, deviceName, passphrase}) {
            if (local.meta) {
                throw new Error('This device already has a project. Erase it first to join another.');
            }
            const config = configOf(repo, token);
            const {vaultText} = await connectRemote(config);
            if (vaultText === null) {
                throw new Error('That repository has no Fingeist data yet. Create a project on your first device and connect it there.');
            }
            const {key, meta} = await openVault({crypto, passphrase, vaultText});
            await ws.remember({meta});
            ws.invalidate();
            return finishConnect(config, key, deviceName);
        },

        async updateToken(token) {
            if (!local.remote) {
                throw new Error('Sync is not set up');
            }
            const config = {...local.remote, token: String(token).trim()};
            await makeRemote(config).check();
            await ws.remember({remote: config});
            return runSync();
        },

        async changePassphrase(oldPassphrase, newPassphrase, iterations) {
            if (!local.remote) {
                throw new Error('Sync is not set up');
            }
            const r = makeRemote(local.remote);
            const vaultText = await r.readVault();
            if (vaultText === null) {
                throw new Error('The repository has no vault.json');
            }
            await r.writeVault(await changePassphrase({crypto, oldPassphrase, newPassphrase, vaultText, iterations}));
        },

        /** Runs one sync; concurrent calls share the run in progress. */
        sync() {
            running ??= runSync().finally(() => {
                running = null;
            });
            return running;
        },
    };
}
