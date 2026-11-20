// The device's copy of the data: merged changes, the outbox of local changes not yet sent, sealed
// files waiting to upload, and what has been pulled. Every change lands here before any network call.

import {laterClock, nextClock, wallTimeOf, ZERO_CLOCK} from './clock.js';
import {ExistsError} from './remote/errors.js';
import {applyChange, checkEnvelope, recordState} from './state.js';
import {open, seal} from './vault.js';

const LOG_FILE = /^devices\/([0-9A-HJKMNP-TV-Z]{26})\/(\d{8})\.bin$/;
const FIELDS = ['winners', 'outbox', 'sealed', 'seq', 'seen', 'clock', 'head', 'fileProblems', 'conflicts', 'uploads', 'clockAhead'];
const MAX_CONFLICTS = 50;
const MAX_UPLOADS = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

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
 * A change from another device that didn't know about this device's latest edit: it replaced a field ("changed"),
 * deleted the record ("deleted", with its values so it can be restored) or brought back one deleted here ("restored").
 * @typedef {{type?: 'changed' | 'deleted' | 'restored', kind: string, id: string, by: string, field?: string, mine?: unknown,
 *   theirs?: unknown, values?: Record<string, unknown>}} Conflict
 * @typedef {{path: string, bytes: Uint8Array, count: number, last?: string}} Sealed
 * The clock of the newest own change in an uploaded file, and the clock when it was uploaded.
 * @typedef {{last: string, at: string}} Upload
 * @typedef {{winners: import('./types.js').Winners, outbox: Change[], sealed: Sealed[], seq: number, seen: string[],
 *   clock: string, head: string | null, fileProblems: FileProblem[], conflicts: Conflict[], uploads: Upload[],
 *   clockAhead: Record<string, number>}} BookData
 */

/** @returns {BookData} */
function fresh() {
    return {
        winners: {},
        outbox: [],
        sealed: [],
        seq: 1,
        seen: [],
        clock: ZERO_CLOCK,
        head: null,
        fileProblems: [],
        conflicts: [],
        uploads: [],
        clockAhead: {},
    };
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
    // A book from before uploads were recorded: everything already sent counts as sent long ago.
    if (!('uploads' in saved)) {
        data.uploads = [{last: data.clock, at: ZERO_CLOCK}];
    }

    /** When the own change with this clock was uploaded, or null while it is still waiting to go. */
    function uploadedAt(clock) {
        return data.uploads.find((u) => u.last >= clock)?.at ?? null;
    }

    // Whether another device's change was made without knowing this device's value of a field. Its base says which
    // version it replaced; a change from an older app has none, so only its timing can tell: it was made before
    // this device's value was uploaded.
    function unseen(mine, field, theirs) {
        if (!mine || mine.device !== deviceId) {
            return false;
        }
        if (theirs.base) {
            return (theirs.base[field] ?? ZERO_CLOCK) < mine.clock;
        }
        const at = uploadedAt(mine.clock);
        return at === null || theirs.clock < at;
    }

    // A change made without knowing this device's latest edit is noted, so the screens can say what happened:
    // a field it replaced, a record it deleted, or a record deleted here that it brought back.
    // A device that stamped a change with its own time more than a day after this device's has its clock set ahead.
    // Its stamps still count (adopting them is what lets later edits here win), but the screens say so, so it can be
    // fixed. Devices that only carried on from its clock are not blamed: their stamps read no time of their own.
    /** @param {Change[]} changes @param {number} nowMs */
    function noteClocks(changes, nowMs) {
        /** @type {Map<string, number>} */
        const ahead = new Map();
        for (const c of changes) {
            const wall = wallTimeOf(c.clock);
            const by = wall === null ? 0 : wall - nowMs;
            ahead.set(c.device, Math.max(ahead.get(c.device) ?? 0, by));
        }
        for (const [device, by] of ahead) {
            if (nowMs > 0 && by > DAY_MS) {
                data.clockAhead[device] = by;
            } else {
                delete data.clockAhead[device];
            }
        }
    }

    /** @param {Change[]} changes */
    function receive(changes) {
        for (const change of changes) {
            data.clock = laterClock(data.clock, change.clock);
            const before = recordState(data.winners, change.kind, change.id);
            const replaced = applyChange(data.winners, change);
            const after = recordState(data.winners, change.kind, change.id);
            const note = (details) => data.conflicts.push({kind: change.kind, id: change.id, by: change.device, ...details});
            if (before?.live && !after?.live) {
                if (Object.entries(before.stamps).some(([field, stamp]) => unseen(stamp, field, change))) {
                    note({type: 'deleted', values: before.values});
                }
                continue;
            }
            // Nobody edits a record they saw deleted, so bringing back one deleted here always went unseen.
            if (before && !before.live && after?.live && before.tomb?.device === deviceId) {
                note({type: 'restored'});
            }
            for (const {field, previous} of replaced) {
                if (unseen(previous, field, change) && JSON.stringify(previous.value) !== JSON.stringify(change.fields?.[field])) {
                    note({type: 'changed', field, mine: previous.value, theirs: change.fields?.[field]});
                }
            }
        }
        data.conflicts = data.conflicts.slice(-MAX_CONFLICTS);
    }

    // Old uploads fold into one that counts as sent long ago, so the list stays short.
    function recordUpload(last, at) {
        data.uploads.push({last, at});
        if (data.uploads.length > MAX_UPLOADS) {
            const dropped = data.uploads.splice(0, data.uploads.length - MAX_UPLOADS + 1);
            data.uploads.unshift({last: dropped[dropped.length - 1].last, at: ZERO_CLOCK});
        }
    }

    async function pullFile(remote, crypto, key, entry, nowMs) {
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
            noteClocks(changes, nowMs);
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
        /** Devices whose clock is more than a day ahead of this one's, by how many ms. */
        get clockAhead() {
            return data.clockAhead;
        },

        /**
         * Applies a local change at once and queues it for sync. A put carries only the fields it sets.
         * @param {{kind: import('./types.js').Kind, id: string, op: 'put' | 'delete', fields?: Record<string, unknown>}} change
         * @param {number} nowMs
         */
        async record({kind, id, op, fields}, nowMs) {
            data.clock = nextClock(data.clock, nowMs);
            // base: the version of each field this change replaces (every field, for a delete), so other devices can
            // tell an edit made on top of theirs from one made without seeing it.
            const seen = recordState(data.winners, kind, id)?.stamps ?? {};
            const replaces = op === 'delete' ? Object.keys(seen) : Object.keys(fields ?? {}).filter((f) => f in seen);
            const base = Object.fromEntries(replaces.map((f) => [f, seen[f].clock]));
            /** @type {Change} */
            const change = {
                kind,
                id,
                op,
                clock: data.clock,
                device: deviceId,
                ...(op === 'put' ? {fields} : {}),
                ...(replaces.length > 0 ? {base} : {}),
            };
            applyChange(data.winners, change);
            data.outbox.push(change);
            await persist('winners', 'outbox', 'clock');
            return change;
        },

        /** Downloads and merges log files from other devices that haven't been seen yet. */
        async pull(remote, crypto, key, nowMs = 0) {
            const head = await remote.head();
            if (head === null || head === data.head) {
                return 0;
            }
            const seen = new Set(data.seen);
            const entries = (await remote.list(head))
                .filter((e) => isLogOf(e.path, deviceId) && !seen.has(e.path))
                .sort((a, b) => (a.path < b.path ? -1 : 1));
            for (const entry of entries) {
                await pullFile(remote, crypto, key, entry, nowMs);
            }
            data.head = head;
            await persist('winners', 'clock', 'seen', 'head', 'fileProblems', 'conflicts', 'clockAhead');
            return entries.length;
        },

        /** Seals the outbox into the next log file, kept locally until it is uploaded. */
        async seal(crypto, key) {
            if (data.outbox.length === 0) {
                return;
            }
            const path = logPath(deviceId, data.seq);
            const text = `${data.outbox.map((c) => JSON.stringify(c)).join('\n')}\n`;
            data.sealed.push({
                path,
                bytes: await seal(crypto, key, path, text),
                count: data.outbox.length,
                last: data.outbox.at(-1)?.clock,
            });
            data.seq++;
            data.outbox = [];
            await persist('sealed', 'seq', 'outbox');
        },

        /** Uploads sealed files in order, noting when each went. "Already exists" means an earlier upload got through. */
        async push(remote, nowMs = 0) {
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
                recordUpload(file.last ?? data.clock, nextClock(data.clock, nowMs));
                pushed++;
                await persist('sealed', 'seen', 'uploads');
            }
            return pushed;
        },

        /** Forgets the notes about one record, or every note. */
        async dismissConflicts(kind = '', id = '') {
            data.conflicts = kind ? data.conflicts.filter((c) => c.kind !== kind || c.id !== id) : [];
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
