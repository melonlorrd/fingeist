import assert from 'node:assert/strict';
import {test} from 'node:test';

import {logPath, openBook} from './book.js';
import {AuthError, RemoteError} from './remote/errors.js';
import {live, liveRecord} from './state.js';
import {memoryRemote, memoryStore} from './testing.js';
import {createVault, open, seal} from './vault.js';

const crypto = globalThis.crypto;
const A = '01JB0000000000000000000AAA';
const B = '01JB0000000000000000000BBB';
const T0 = 1763112600000;

async function setup() {
    const {key} = await createVault({crypto, passphrase: 'correct horse', meta: {currency: 'INR', decimals: 2}, iterations: 1000});
    return {key, remote: memoryRemote()};
}

const row = (id, amount) => ({kind: 'txn', id, op: 'put', fields: {time: '2026-11-07', amount, account: 'Cash'}});

async function sync(book, remote, key) {
    await book.pull(remote, crypto, key);
    await book.seal(crypto, key);
    await book.push(remote);
}

test('a local change is applied and queued at once, and survives reopening', async () => {
    const store = memoryStore();
    const book = await openBook(store, A);
    const change = await book.record(row('t1', '-1.00'), T0);
    assert.deepEqual([change.device, change.clock], [A, '1763112600000-0000']);
    assert.equal(live(book.winners, 'txn').length, 1);
    assert.equal(book.pending, 1);

    const reopened = await openBook(store, A);
    assert.equal(live(reopened.winners, 'txn').length, 1);
    assert.equal(reopened.pending, 1);
});

test('two devices converge through the remote', async () => {
    const {key, remote} = await setup();
    const a = await openBook(memoryStore(), A);
    const b = await openBook(memoryStore(), B);
    await a.record(row('t1', '-1.00'), T0);
    await b.record(row('t2', '-2.00'), T0);
    await b.record(row('t1', '-9.00'), T0 + 5);

    await sync(a, remote, key);
    await sync(b, remote, key);
    await sync(a, remote, key);

    assert.deepEqual([...remote.files.keys()].sort(), [logPath(A, 1), logPath(B, 1)]);
    assert.deepEqual(a.winners, b.winners);
    assert.equal(liveRecord(a.winners, 'txn', 't1').amount, '-9.00');
    assert.deepEqual([a.pending, b.pending], [0, 0]);
});

test('the log file is encrypted, bound to its path, and holds one change per line', async () => {
    const {key, remote} = await setup();
    const book = await openBook(memoryStore(), A);
    await book.record(row('t1', '-1.00'), T0);
    await book.record(row('t2', '-2.00'), T0);
    await sync(book, remote, key);
    const bytes = remote.files.get(logPath(A, 1));
    assert.ok(!new TextDecoder().decode(bytes).includes('Cash'));
    const lines = (await open(crypto, key, logPath(A, 1), bytes))
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
    assert.deepEqual(
        lines.map((c) => [c.id, c.clock]),
        [
            ['t1', '1763112600000-0000'],
            ['t2', '1763112600000-0001'],
        ],
    );
});

test('offline: changes wait in the outbox and the sealed file is kept until it uploads', async () => {
    const {key, remote} = await setup();
    const store = memoryStore();
    const book = await openBook(store, A);
    await book.record(row('t1', '-1.00'), T0);
    await book.seal(crypto, key);
    remote.failNext(new TypeError('Failed to fetch'));
    await assert.rejects(book.push(remote), TypeError);
    assert.equal(book.pending, 1);
    assert.equal(remote.files.size, 0);

    await book.record(row('t2', '-2.00'), T0);
    const reopened = await openBook(store, A);
    await reopened.seal(crypto, key);
    assert.equal(await reopened.push(remote), 2);
    assert.deepEqual([...remote.files.keys()], [logPath(A, 1), logPath(A, 2)]);
    assert.equal(reopened.pending, 0);
});

test('"already exists" on our own path counts as uploaded', async () => {
    const {key, remote} = await setup();
    const book = await openBook(memoryStore(), A);
    await book.record(row('t1', '-1.00'), T0);
    await book.seal(crypto, key);
    remote.files.set(logPath(A, 1), Uint8Array.of(1));
    assert.equal(await book.push(remote), 1);
    assert.equal(book.pending, 0);
});

test('auth and remote errors stop the push and keep everything', async () => {
    const {key, remote} = await setup();
    const book = await openBook(memoryStore(), A);
    await book.record(row('t1', '-1.00'), T0);
    await book.seal(crypto, key);
    for (const err of [new AuthError('revoked'), new RemoteError('500')]) {
        remote.failNext(err);
        await assert.rejects(book.push(remote), err.constructor);
        assert.equal(book.pending, 1);
    }
});

test('pull skips seen files, our own folder, and other paths; an unchanged head does nothing', async () => {
    const {key, remote} = await setup();
    const a = await openBook(memoryStore(), A);
    const b = await openBook(memoryStore(), B);
    await a.record(row('t1', '-1.00'), T0);
    await sync(a, remote, key);
    remote.files.set('README.md', new TextEncoder().encode('hi'));
    remote.files.set('devices/not-a-device/00000001.bin', Uint8Array.of(1));

    assert.equal(await b.pull(remote, crypto, key), 1);
    assert.equal(await b.pull(remote, crypto, key), 0);
    assert.equal(await a.pull(remote, crypto, key), 0);
    assert.deepEqual(b.fileProblems, []);
});

test('a slow device clock still orders its edit after what it has pulled', async () => {
    const {key, remote} = await setup();
    const fast = await openBook(memoryStore(), A);
    const slow = await openBook(memoryStore(), B);
    await fast.record(row('t1', '-1.00'), T0 + 3600000);
    await sync(fast, remote, key);
    await slow.pull(remote, crypto, key);
    await slow.record(row('t1', '-2.00'), T0);
    await sync(slow, remote, key);
    await sync(fast, remote, key);
    assert.equal(liveRecord(fast.winners, 'txn', 't1').amount, '-2.00');
});

test('tampered files and malformed lines are reported, the rest still merges', async () => {
    const {key, remote} = await setup();
    const book = await openBook(memoryStore(), A);
    const good = `${JSON.stringify({kind: 'txn', id: 't1', op: 'put', clock: '1763112600000-0000', device: B, fields: {x: 1}})}\n`;
    const lines = `${good}not json\n${JSON.stringify({kind: 'holding', id: 'h', op: 'put', clock: '1763112600000-0000', device: B, fields: {x: 1}})}\n`;
    await remote.create(logPath(B, 1), await seal(crypto, key, logPath(B, 1), lines));
    await remote.create(logPath(B, 2), await seal(crypto, key, logPath(B, 1), good));

    assert.equal(await book.pull(remote, crypto, key), 2);
    assert.equal(live(book.winners, 'txn').length, 1);
    assert.deepEqual(
        book.fileProblems.map((p) => [p.path, p.line]),
        [
            [logPath(B, 1), 2],
            [logPath(B, 1), 3],
            [logPath(B, 2), 0],
        ],
    );
});

test('a network failure during pull leaves the file unseen for next time', async () => {
    const {key, remote} = await setup();
    const a = await openBook(memoryStore(), A);
    await a.record(row('t1', '-1.00'), T0);
    await sync(a, remote, key);
    const b = await openBook(memoryStore(), B);
    const flaky = {
        ...remote,
        read: async () => {
            throw new TypeError('Failed to fetch');
        },
    };
    await assert.rejects(b.pull(flaky, crypto, key), TypeError);
    assert.equal(await b.pull(remote, crypto, key), 1);
});

test('forgetRemote makes the next pull read everything again', async () => {
    const {key, remote} = await setup();
    const a = await openBook(memoryStore(), A);
    await a.record(row('t1', '-1.00'), T0);
    await sync(a, remote, key);
    const b = await openBook(memoryStore(), B);
    await b.pull(remote, crypto, key);
    await b.forgetRemote();
    assert.equal(await b.pull(remote, crypto, key), 1);
});

test('only changes made without knowing about an edit here are noted', async (t) => {
    // Each case: the mac writes t1 and syncs, the phone syncs; then each does its part before they sync again.
    const cases = [
        [
            'a later edit by a device that had seen ours is not a conflict',
            async (_mac, phone, sync) => {
                await phone.record({kind: 'txn', id: 't1', op: 'put', fields: {note: 'x'}}, T0 + 10);
                await sync(phone);
            },
            [],
        ],
        [
            'an edit made while ours was still waiting to upload replaces it and is noted',
            async (mac, phone, sync) => {
                await mac.record({kind: 'txn', id: 't1', op: 'put', fields: {amount: '-3.00'}}, T0 + 5);
                await phone.record({kind: 'txn', id: 't1', op: 'put', fields: {amount: '-2.00'}}, T0 + 10);
                await sync(phone);
            },
            [{type: 'changed', kind: 'txn', id: 't1', field: 'amount', mine: '-3.00', theirs: '-2.00', by: B}],
        ],
        [
            'a delete of a record we were editing is noted with its values, so it can be restored',
            async (mac, phone, sync) => {
                await mac.record({kind: 'txn', id: 't1', op: 'put', fields: {note: 'mine'}}, T0 + 5);
                await phone.record({kind: 'txn', id: 't1', op: 'delete'}, T0 + 10);
                await sync(phone);
            },
            [
                {
                    type: 'deleted',
                    kind: 'txn',
                    id: 't1',
                    by: B,
                    values: {account: 'Cash', amount: '-1.00', note: 'mine', time: '2026-11-07'},
                },
            ],
        ],
        [
            'an edit that brings back a record we deleted is noted',
            async (mac, phone, sync) => {
                await mac.record({kind: 'txn', id: 't1', op: 'delete'}, T0 + 5);
                await phone.record({kind: 'txn', id: 't1', op: 'put', fields: {note: 'still here'}}, T0 + 10);
                await sync(phone);
            },
            [{type: 'restored', kind: 'txn', id: 't1', by: B}],
        ],
    ];
    for (const [name, act, want] of cases) {
        await t.test(name, async () => {
            const {key, remote} = await setup();
            const mac = await openBook(memoryStore(), A);
            const phone = await openBook(memoryStore(), B);
            const syncBook = (book) => sync(book, remote, key);
            await mac.record(row('t1', '-1.00'), T0);
            await syncBook(mac);
            await syncBook(phone);
            await act(mac, phone, syncBook);
            await mac.pull(remote, crypto, key);
            assert.deepEqual(mac.conflicts, want);
        });
    }
});

test('a change from an older app, without base, is a conflict only if it was made before ours was uploaded', async () => {
    const {key, remote} = await setup();
    const mac = await openBook(memoryStore(), A);
    await mac.record(row('t1', '-1.00'), T0);
    await sync(mac, remote, key);
    await mac.record({kind: 'txn', id: 't1', op: 'put', fields: {note: 'waiting'}}, T0 + 100);
    const old = (clock, note) => JSON.stringify({kind: 'txn', id: 't1', op: 'put', clock, device: B, fields: {note}});
    // Our note is still waiting to upload, so an older app's change to the same field cannot have seen it.
    const lines = `${old('1763112600200-0000', 'from old phone')}\n`;
    await remote.create(logPath(B, 1), await seal(crypto, key, logPath(B, 1), lines));
    await mac.pull(remote, crypto, key);
    assert.deepEqual(
        mac.conflicts.map((c) => [c.type, c.field, c.mine, c.theirs]),
        [['changed', 'note', 'waiting', 'from old phone']],
    );
});

test('a device whose clock is more than a day ahead is noted until its changes look right again', async () => {
    const {key, remote} = await setup();
    const mac = await openBook(memoryStore(), A);
    const phone = await openBook(memoryStore(), B);
    const day = 24 * 60 * 60 * 1000;
    await phone.record(row('t1', '-1.00'), T0 + 3 * day);
    await sync(phone, remote, key);
    await mac.pull(remote, crypto, key, T0);
    assert.deepEqual(mac.clockAhead, {[B]: 3 * day});
    // The phone's clock is fixed: its next change carries on from its own last stamp instead of reading a new time.
    await phone.record(row('t2', '-1.00'), T0 + 60000);
    await sync(phone, remote, key);
    await mac.pull(remote, crypto, key, T0 + 120000);
    assert.deepEqual(mac.clockAhead, {});
    // The mac carried on from the phone's clock too, so its stamps are ahead, but it isn't blamed; a device reading
    // the whole history ends where the phone's latest file leaves it.
    await mac.record(row('t3', '-1.00'), T0 + 180000);
    await sync(mac, remote, key);
    const third = await openBook(memoryStore(), '01JB0000000000000000000CCC');
    await third.pull(remote, crypto, key, T0 + 240000);
    assert.deepEqual(third.clockAhead, {});
});

test('notes can be dismissed for one record or all at once', async () => {
    const {key, remote} = await setup();
    const mac = await openBook(memoryStore(), A);
    const phone = await openBook(memoryStore(), B);
    await mac.record(row('t1', '-1.00'), T0);
    await mac.record(row('t2', '-1.00'), T0);
    await sync(mac, remote, key);
    await sync(phone, remote, key);
    await mac.record({kind: 'txn', id: 't1', op: 'put', fields: {note: 'a'}}, T0 + 5);
    await mac.record({kind: 'txn', id: 't2', op: 'put', fields: {note: 'a'}}, T0 + 5);
    await phone.record({kind: 'txn', id: 't1', op: 'put', fields: {note: 'b'}}, T0 + 10);
    await phone.record({kind: 'txn', id: 't2', op: 'put', fields: {note: 'b'}}, T0 + 10);
    await sync(phone, remote, key);
    await mac.pull(remote, crypto, key);
    await mac.dismissConflicts('txn', 't1');
    assert.deepEqual(
        mac.conflicts.map((c) => c.id),
        ['t2'],
    );
    await mac.dismissConflicts();
    assert.deepEqual(mac.conflicts, []);
});
