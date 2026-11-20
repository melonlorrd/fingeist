// The state the app's parts share: this device's settings, its book, and helpers to write changes.

import {openBook} from './book.js';
import {buildBook} from './records.js';
import {dueEntries} from './recurring.js';
import {liveRecord} from './state.js';
import {ulid} from './ulid.js';

// Fields that only make sense together. Writing them as one change gives them one stamp, so a merge takes all of them
// from the same device: a transfer's two accounts, or an entry's amount with the items that add up to it.
const TOGETHER = {
    txn: [['amount', 'splits', 'refund']],
    transfer: [['from', 'to']],
};

/**
 * @typedef {{now(): {ms: number, date: string, clock: string, offset: string}, offsetAt(date: string, clock: string): string}} Clock
 * @typedef {Awaited<ReturnType<typeof openWorkspace>>} Workspace
 */

/**
 * @param {{store: import('./types.js').Store, crypto: Crypto, clock: Clock}} services
 */
export async function openWorkspace({store, crypto, clock}) {
    const random = (/** @type {number} */ n) => crypto.getRandomValues(new Uint8Array(n));
    /** @type {Record<string, any>} */
    const local = await store.load();
    if (!local.deviceId) {
        local.deviceId = ulid(clock.now().ms, random);
        await store.save({deviceId: local.deviceId});
    }
    const book = await openBook(store, local.deviceId);
    /** @type {import('./types.js').Book | null} */
    let cached = null;

    const ws = {
        store,
        crypto,
        clock,
        local,
        book,
        newId: () => ulid(clock.now().ms, random),
        today: () => clock.now().date,
        decimals: () => local.meta.decimals,

        /** The book as the reports see it, rebuilt only after something changed. */
        view() {
            cached ??= buildBook(book.winners, local.meta);
            return cached;
        },

        invalidate() {
            cached = null;
        },

        /** Saves device-only settings, such as the sync config or the last account used. */
        async remember(/** @type {Record<string, unknown>} */ entries) {
            Object.assign(local, entries);
            await store.save(entries);
        },

        put(/** @type {import('./types.js').Kind} */ kind, /** @type {string} */ id, /** @type {Record<string, unknown>} */ fields) {
            cached = null;
            return book.record({kind, id, op: 'put', fields}, clock.now().ms);
        },

        remove(/** @type {import('./types.js').Kind} */ kind, /** @type {string} */ id) {
            cached = null;
            return book.record({kind, id, op: 'delete'}, clock.now().ms);
        },

        /**
         * Writes only the fields that differ from the record as it stands, so other devices' edits to other fields survive.
         * Fields that must agree with each other (TOGETHER) are written as a group when any of them changes.
         * @param {import('./types.js').Kind} kind
         * @param {string} id
         * @param {Record<string, unknown>} fields
         */
        async putChanged(kind, id, fields) {
            const current = liveRecord(book.winners, kind, id);
            const changed = current
                ? Object.fromEntries(Object.entries(fields).filter(([f, v]) => JSON.stringify(current[f]) !== JSON.stringify(v)))
                : fields;
            for (const group of TOGETHER[kind] ?? []) {
                if (group.some((f) => f in changed)) {
                    for (const f of group.filter((f) => f in fields)) {
                        changed[f] = fields[f];
                    }
                }
            }
            if (Object.keys(changed).length > 0) {
                await ws.put(kind, id, changed);
            }
        },

        requireProject() {
            if (!local.meta) {
                throw new Error('Set up a project first');
            }
        },

        /** Creates the repeating entries that are due by today and no device has created yet. */
        async applyDue() {
            if (!local.meta) {
                return;
            }
            for (const entry of dueEntries(book.winners, ws.view().recurring, ws.today())) {
                await ws.put(entry.kind, entry.id, entry.fields);
            }
        },
    };
    return ws;
}

/**
 * The item in the list with this name, ignoring case, other than exceptId.
 * @template {{id: string, name: string}} T
 * @param {T[]} list
 * @param {string} name
 * @param {string} [exceptId]
 */
export function sameName(list, name, exceptId) {
    const wanted = name.trim().toLowerCase();
    return list.find((x) => x.id !== exceptId && x.name.toLowerCase() === wanted);
}
