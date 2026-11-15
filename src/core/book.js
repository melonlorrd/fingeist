// The device's copy of the data: merged changes, the outbox of local changes not yet sent, sealed
// files waiting to upload, and what has been pulled. Every change lands here before any network call.

import {laterClock, nextClock, ZERO_CLOCK} from './clock.js';
import {ExistsError} from './remote/errors.js';
import {applyChange, checkEnvelope} from './state.js';
import {open, seal} from './vault.js';

const LOG_FILE = /^devices\/([0-9A-HJKMNP-TV-Z]{26})\/(\d{8})\.bin$/;
const FIELDS = ['winners', 'outbox', 'sealed', 'seq', 'seen', 'clock', 'head', 'fileProblems', 'conflicts'];
const MAX_CONFLICTS = 50;

/** @param {string} path @param {string} deviceId */
function isLogOf(path, deviceId) {
    const owner = LOG_FILE.exec(path)?.[1];
    return owner !== undefined && owner !== deviceId;
}

export function logPath(deviceId, seq) {
    return `devices/${deviceId}/${String(seq).padStart(8, '0')}.bin`;
}

/**
 * @typedef {import('./types.js').Change} Change
 * @typedef {{path: string, line: number, message: string}} FileProblem
 * @typedef {{kind: string, id: string, field: string, mine: unknown, theirs: unknown, by: string}} Conflict
 * @typedef {{path: string, bytes: Uint8Array, count: number}} Sealed
 * @typedef {{winners: import('./types.js').Winners, outbox: Change[], sealed: Sealed[], seq: number, seen: string[],
 *   clock: string, head: string | null, fileProblems: FileProblem[], conflicts: Conflict[]}} BookData
 */

/** @returns {BookData} */
function fresh() {
    return {winners: {}, outbox: [], sealed: [], seq: 1, seen: [], clock: ZERO_CLOCK, head: null, fileProblems: [], conflicts: []};
}

/**
 * The book kept in store for this device.
 * @param {import('./types.js').Store} store
 * @param {string} deviceId
 */
export async function openBook(store, deviceId) {
    const saved = await store.load();
    /** @type {BookData} */
    const data = {...fresh(), ...Object.fromEntries(FIELDS.filter((f) => f in saved).map((f) => [f, saved[f]]))};
    /** @param {...keyof BookData} fields */
    const persist = (...fields) => store.save(Object.fromEntries(fields.map((f) => [f, data[f]])));

    // A field this device set, replaced by another device with a different value, is noted so the
    // screens can say what changed.
    /** @param {Change[]} changes */
    function receive(changes) {
        for (const change of changes) {
            data.clock = laterClock(data.clock, change.clock);
            for (const {field, previous} of applyChange(data.winners, change)) {
                if (previous.device === deviceId && JSON.stringify(previous.value) !== JSON.stringify(change.fields?.[field])) {
                    data.conflicts.push({
                        kind: change.kind,
                        id: change.id,
                        field,
                        mine: previous.value,
                        theirs: change.fields?.[field],
                        by: change.device,
                    });
                }
            }
        }
        data.conflicts = data.conflicts.slice(-MAX_CONFLICTS);
    }

    async function pullFile(remote, crypto, key, entry) {
        const bytes = await remote.read(entry);
        try {
            const text = await open(crypto, key, entry.path, bytes);
            /** @type {Change[]} */
            const changes = [];
            text.split('\n').forEach((line, i) => {
                if (line.trim() === '') {
                    return;
                }
                try {
                    changes.push(checkEnvelope(JSON.parse(line)));
                } catch (err) {
                    data.fileProblems.push({path: entry.path, line: i + 1, message: err.message});
                }
            });
            receive(changes);
        } catch (err) {
            data.fileProblems.push({path: entry.path, line: 0, message: err.message});
        }
        data.seen.push(entry.path);
    }

    return {
        get winners() {
            return data.winners;
        },
        get pending() {
            return data.outbox.length + data.sealed.reduce((n, s) => n + s.count, 0);
        },
        get fileProblems() {
            return data.fileProblems;
        },
        get conflicts() {
            return data.conflicts;
        },

        /**
         * Applies a local change at once and queues it for sync. A put carries only the fields it sets.
         * @param {{kind: import('./types.js').Kind, id: string, op: 'put' | 'delete', fields?: Record<string, unknown>}} change
         * @param {number} nowMs
         */
        async record({kind, id, op, fields}, nowMs) {
            data.clock = nextClock(data.clock, nowMs);
            /** @type {Change} */
            const change = {kind, id, op, clock: data.clock, device: deviceId, ...(op === 'put' ? {fields} : {})};
            applyChange(data.winners, change);
            data.outbox.push(change);
            await persist('winners', 'outbox', 'clock');
            return change;
        },

        /** Downloads and merges log files from other devices that haven't been seen yet. */
        async pull(remote, crypto, key) {
            const head = await remote.head();
            if (head === null || head === data.head) {
                return 0;
            }
            const seen = new Set(data.seen);
            const entries = (await remote.list(head))
                .filter((e) => isLogOf(e.path, deviceId) && !seen.has(e.path))
                .sort((a, b) => (a.path < b.path ? -1 : 1));
            for (const entry of entries) {
                await pullFile(remote, crypto, key, entry);
            }
            data.head = head;
            await persist('winners', 'clock', 'seen', 'head', 'fileProblems', 'conflicts');
            return entries.length;
        },

        /** Seals the outbox into the next log file, kept locally until it is uploaded. */
        async seal(crypto, key) {
            if (data.outbox.length === 0) {
                return;
            }
            const path = logPath(deviceId, data.seq);
            const text = `${data.outbox.map((c) => JSON.stringify(c)).join('\n')}\n`;
            data.sealed.push({path, bytes: await seal(crypto, key, path, text), count: data.outbox.length});
            data.seq++;
            data.outbox = [];
            await persist('sealed', 'seq', 'outbox');
        },

        /** Uploads sealed files in order. "Already exists" means an earlier upload got through. */
        async push(remote) {
            let pushed = 0;
            while (data.sealed.length > 0) {
                const file = data.sealed[0];
                try {
                    await remote.create(file.path, file.bytes);
                } catch (err) {
                    if (!(err instanceof ExistsError)) {
                        throw err;
                    }
                }
                data.sealed.shift();
                data.seen.push(file.path);
                pushed++;
                await persist('sealed', 'seen');
            }
            return pushed;
        },

        async dismissConflicts() {
            data.conflicts = [];
            await persist('conflicts');
        },

        /** Forgets what was pulled, so the next pull reads every file again. Local changes are kept. */
        async forgetRemote() {
            data.seen = data.seen.filter((path) => path.startsWith(`devices/${deviceId}/`));
            data.head = null;
            data.fileProblems = [];
            await persist('seen', 'head', 'fileProblems');
        },
    };
}
