import assert from 'node:assert/strict';
import {test} from 'node:test';

import {fromUtf8, utf8} from '../bytes.js';
import {AuthError, ExistsError, RemoteError} from './errors.js';
import {githubRemote} from './github.js';

const API = 'https://api.test';

function respond(status, body, headers = {}) {
    const bytes = body instanceof Uint8Array ? body : utf8(typeof body === 'string' ? body : JSON.stringify(body ?? {}));
    return new Response(status === 204 ? null : bytes, {status, headers});
}

/** A fake fetch that answers from a table of "METHOD path" handlers and records every call. */
function fakeFetch(routes) {
    const calls = [];
    const fetch = async (url, init) => {
        const path = url.slice(`${API}/repos/me/data`.length);
        const key = `${init.method} ${path}`;
        calls.push({key, init});
        const handler = routes[key];
        if (!handler) {
            throw new Error(`unexpected request ${key}`);
        }
        return handler(init);
    };
    return {fetch, calls};
}

const remote = (fetch) => githubRemote({fetch, repo: 'me/data', token: 'tok', api: API});
const repoInfo = {'GET ': () => respond(200, {default_branch: 'main'})};

test('requests carry the token and skip the HTTP cache', async () => {
    const {fetch, calls} = fakeFetch({...repoInfo});
    await remote(fetch).check();
    assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
    assert.equal(calls[0].init.cache, 'no-store');
});

test('head is the default branch tip, or null for an empty repo', async () => {
    const full = fakeFetch({...repoInfo, 'GET /git/ref/heads/main': () => respond(200, {object: {sha: 'abc'}})});
    assert.equal(await remote(full.fetch).head(), 'abc');
    const empty = fakeFetch({...repoInfo, 'GET /git/ref/heads/main': () => respond(409, {message: 'Git Repository is empty.'})});
    assert.equal(await remote(empty.fetch).head(), null);
});

test('list returns blobs only and refuses a truncated tree', async () => {
    const {fetch} = fakeFetch({
        'GET /git/trees/abc?recursive=1': () =>
            respond(200, {
                truncated: false,
                tree: [
                    {path: 'devices', type: 'tree', sha: 't1'},
                    {path: 'devices/D/00000001.bin', type: 'blob', sha: 'b1'},
                    {path: 'vault.json', type: 'blob', sha: 'b2'},
                ],
            }),
    });
    assert.deepEqual(await remote(fetch).list('abc'), [
        {path: 'devices/D/00000001.bin', blobId: 'b1'},
        {path: 'vault.json', blobId: 'b2'},
    ]);
    const truncated = fakeFetch({'GET /git/trees/abc?recursive=1': () => respond(200, {truncated: true, tree: []})});
    await assert.rejects(remote(truncated.fetch).list('abc'), RemoteError);
});

test('read returns the raw bytes of a blob', async () => {
    const {fetch, calls} = fakeFetch({'GET /git/blobs/b1': () => respond(200, Uint8Array.of(1, 2, 255))});
    assert.deepEqual(await remote(fetch).read({path: 'x', blobId: 'b1'}), Uint8Array.of(1, 2, 255));
    assert.equal(calls[0].init.headers.Accept, 'application/vnd.github.raw+json');
});

test('create sends base64 content without a sha', async () => {
    let sent;
    const {fetch} = fakeFetch({
        'PUT /contents/devices/D/00000001.bin': (init) => {
            sent = JSON.parse(init.body);
            return respond(201, {});
        },
    });
    await remote(fetch).create('devices/D/00000001.bin', Uint8Array.of(1, 2, 3));
    assert.deepEqual(sent, {message: 'Add devices/D/00000001.bin', content: 'AQID'});
});

test('create throws ExistsError when the file is already there, RemoteError otherwise', async () => {
    const exists = fakeFetch({
        'PUT /contents/a.bin': () => respond(422, {message: '"sha" wasn\'t supplied.'}),
        'GET /contents/a.bin': () => respond(200, {sha: 'old'}),
    });
    await assert.rejects(remote(exists.fetch).create('a.bin', Uint8Array.of(1)), ExistsError);
    const invalid = fakeFetch({
        'PUT /contents/a.bin': () => respond(422, {message: 'invalid'}),
        'GET /contents/a.bin': () => respond(404, {}),
    });
    await assert.rejects(remote(invalid.fetch).create('a.bin', Uint8Array.of(1)), RemoteError);
    const conflict = fakeFetch({'PUT /contents/a.bin': () => respond(409, {})});
    await assert.rejects(remote(conflict.fetch).create('a.bin', Uint8Array.of(1)), RemoteError);
});

test('auth failures become AuthError, rate limits and server errors RemoteError', async () => {
    const cases = [
        [respond(401, {}), AuthError],
        [respond(403, {}), AuthError],
        [respond(404, {}), AuthError],
        [respond(403, {}, {'x-ratelimit-remaining': '0'}), RemoteError],
        [respond(500, {}), RemoteError],
    ];
    for (const [response, kind] of cases) {
        const {fetch} = fakeFetch({'GET ': () => response});
        await assert.rejects(remote(fetch).check(), kind);
    }
});

test('offline: the fetch failure is passed through as is', async () => {
    const fetch = async () => {
        throw new TypeError('Failed to fetch');
    };
    await assert.rejects(remote(fetch).check(), TypeError);
});

test('readVault returns the text, or null when missing; writeVault updates with the sha', async () => {
    const missing = fakeFetch({'GET /contents/vault.json': () => respond(404, {})});
    assert.equal(await remote(missing.fetch).readVault(), null);
    const present = fakeFetch({'GET /contents/vault.json': () => respond(200, '{"format":1}')});
    assert.equal(await remote(present.fetch).readVault(), '{"format":1}');

    let sent;
    const update = fakeFetch({
        'GET /contents/vault.json': () => respond(200, {sha: 'v1'}),
        'PUT /contents/vault.json': (init) => {
            sent = JSON.parse(init.body);
            return respond(200, {});
        },
    });
    await remote(update.fetch).writeVault('{}');
    assert.deepEqual([sent.sha, fromUtf8(Uint8Array.from(atob(sent.content), (c) => c.charCodeAt(0)))], ['v1', '{}']);
});

test('the repo must be owner/name', () => {
    for (const bad of ['', 'me', 'me/data/x', 'https://github.com/me/data']) {
        assert.throws(() => githubRemote({fetch: () => {}, repo: bad, token: 't'}));
    }
});
