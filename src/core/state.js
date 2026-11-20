// Merged state, kept per field: for each (kind, id) and each field, the value with the highest stamp
// (clock, then device id) wins. A delete is a tombstone stamp; the record is live while some field
// is newer than its tombstone, so a later edit brings it back.

import {isClock} from './clock.js';

export const KINDS = ['txn', 'transfer', 'category', 'account', 'budget', 'recurring', 'setting', 'device'];

/** Throws when a change record is not shaped like one; its fields are checked later, in records.js. */
export function checkEnvelope(change) {
    const ok =
        change &&
        typeof change === 'object' &&
        KINDS.includes(change.kind) &&
        typeof change.id === 'string' &&
        change.id !== '' &&
        isClock(change.clock) &&
        typeof change.device === 'string' &&
        change.device !== '' &&
        (change.op === 'delete' || (change.op === 'put' && isFields(change.fields))) &&
        (change.base === undefined || isBase(change.base));
    if (!ok) {
        throw new Error('not a change record');
    }
    return change;
}

// base: for each field the change replaced, the clock of the value its device had (see README, Data format).
function isBase(base) {
    return base !== null && typeof base === 'object' && !Array.isArray(base) && Object.values(base).every(isClock);
}

function isFields(fields) {
    return fields !== null && typeof fields === 'object' && !Array.isArray(fields) && Object.keys(fields).length > 0;
}

function keyOf(kind, id) {
    return `${kind}:${id}`;
}

function newer(a, b) {
    return !b || a.clock > b.clock || (a.clock === b.clock && a.device > b.device);
}

/**
 * Merges one change into winners (a plain object keyed by keyOf). Returns the fields it replaced,
 * each with the stamped value it replaced, so callers can notice overwrites.
 * @param {import('./types.js').Winners} winners
 * @param {import('./types.js').Change} change
 * @returns {{field: string, previous: import('./types.js').Stamped}[]}
 */
export function applyChange(winners, change) {
    const key = keyOf(change.kind, change.id);
    winners[key] ??= {kind: change.kind, id: change.id, fields: {}, tomb: null};
    const entry = winners[key];
    const stamp = {clock: change.clock, device: change.device};
    if (change.op === 'delete') {
        if (newer(stamp, entry.tomb)) {
            entry.tomb = stamp;
        }
        return [];
    }
    const replaced = [];
    for (const [field, value] of Object.entries(change.fields ?? {})) {
        const current = entry.fields[field];
        if (newer(stamp, current)) {
            if (current) {
                replaced.push({field, previous: current});
            }
            entry.fields[field] = {value, ...stamp};
        }
    }
    return replaced;
}

function latestField(entry) {
    return Object.values(entry.fields).reduce((latest, f) => (newer(f, latest) ? f : latest), null);
}

function isLive(entry) {
    const latest = latestField(entry);
    return Boolean(latest) && newer(latest, entry.tomb);
}

/** The record's current field values. */
function valuesOf(entry) {
    return Object.fromEntries(
        Object.keys(entry.fields)
            .sort()
            .map((field) => [field, entry.fields[field].value]),
    );
}

/** The live records of one kind, as {id, data, device}, device being who wrote its latest field. */
export function live(winners, kind) {
    return Object.values(winners)
        .filter((entry) => entry.kind === kind && isLive(entry))
        .map((entry) => ({id: entry.id, data: valuesOf(entry), device: latestField(entry).device}));
}

/** One live record's values, or null. */
export function liveRecord(winners, kind, id) {
    const entry = winners[keyOf(kind, id)];
    return entry && isLive(entry) ? valuesOf(entry) : null;
}

/**
 * A record's merged state: whether it is live, its values, each field's stamp and its tombstone.
 * @returns {{live: boolean, values: Record<string, unknown>, stamps: Record<string, {clock: string, device: string}>,
 *   tomb: {clock: string, device: string} | null} | null}
 */
export function recordState(winners, kind, id) {
    const entry = winners[keyOf(kind, id)];
    if (!entry) {
        return null;
    }
    const stamps = Object.fromEntries(Object.entries(entry.fields).map(([f, {clock, device}]) => [f, {clock, device}]));
    return {live: isLive(entry), values: valuesOf(entry), stamps, tomb: entry.tomb};
}

/** Whether the record was ever written or deleted, on any device. */
export function known(winners, kind, id) {
    return keyOf(kind, id) in winners;
}
