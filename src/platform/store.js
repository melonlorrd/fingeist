// A key-value store in IndexedDB: one database, one object store, values kept as structured clones
// (so a non-extractable CryptoKey can be stored as is).

const DB = 'fingeist';
const STORE = 'kv';

function request(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function done(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('The browser stopped a save to local storage'));
    });
}

export async function openStore() {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    const db = await request(open);
    return {
        async load() {
            const tx = db.transaction(STORE, 'readonly');
            const store = tx.objectStore(STORE);
            const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll())]);
            return Object.fromEntries(keys.map((k, i) => [k, values[i]]));
        },
        async save(entries) {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            for (const [key, value] of Object.entries(entries)) {
                store.put(value, key);
            }
            await done(tx);
        },
        async clear() {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).clear();
            await done(tx);
        },
    };
}

/** Asks the browser not to evict local data under storage pressure. */
export async function persistStorage() {
    try {
        await navigator.storage?.persist?.();
    } catch {
        // Older browsers have no persist(); the data still works, it is just evictable.
    }
}
