// In-memory stand-ins for the browser store and a git remote, shared by the core tests.

import {ExistsError} from './remote/errors.js';

export function memoryStore(initial = {}) {
    const data = structuredClone(initial);
    return {
        data,
        async load() {
            return structuredClone(data);
        },
        async save(entries) {
            Object.assign(data, structuredClone(entries));
        },
        async clear() {
            for (const key of Object.keys(data)) {
                delete data[key];
            }
        },
    };
}

/** A remote holding files in memory; each create is a commit. failNext makes the next call throw. */
export function memoryRemote() {
    const files = new Map();
    let commits = 0;
    let failure = null;
    const maybeFail = () => {
        if (failure) {
            const err = failure;
            failure = null;
            throw err;
        }
    };
    return {
        files,
        failNext(err) {
            failure = err;
        },
        async check() {
            maybeFail();
        },
        async head() {
            maybeFail();
            return commits === 0 ? null : `c${commits}`;
        },
        async list() {
            maybeFail();
            return [...files.keys()].map((path) => ({path, blobId: path}));
        },
        async read(entry) {
            maybeFail();
            return files.get(entry.blobId).slice();
        },
        async create(path, bytes) {
            maybeFail();
            if (files.has(path)) {
                throw new ExistsError(`${path} already exists`);
            }
            files.set(path, bytes.slice());
            commits++;
        },
        async readVault() {
            maybeFail();
            return files.has('vault.json') ? new TextDecoder().decode(files.get('vault.json')) : null;
        },
        async writeVault(text) {
            maybeFail();
            files.set('vault.json', new TextEncoder().encode(text));
            commits++;
        },
    };
}
