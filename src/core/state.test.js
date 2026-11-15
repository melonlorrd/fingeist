import assert from 'node:assert/strict';
import {test} from 'node:test';

import {applyChange, checkEnvelope, known, live, liveRecord} from './state.js';

const put = (id, clock, device, fields) => ({kind: 'txn', id, op: 'put', clock: `100000000000${clock}-0000`, device, fields});
const del = (id, clock, device) => ({kind: 'txn', id, op: 'delete', clock: `100000000000${clock}-0000`, device});

function merge(changes) {
    const winners = {};
    for (const c of changes) {
        applyChange(winners, c);
    }
    return winners;
}

function permutations(items) {
    if (items.length <= 1) {
        return [items];
    }
    return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

test('each field keeps its own latest value', () => {
    const winners = merge([
        put('a', 0, 'A', {amount: '-1.00', note: 'x', category: 'c1'}),
        put('a', 2, 'B', {category: 'c2'}),
        put('a', 1, 'C', {note: 'fixed', category: 'c3'}),
    ]);
    assert.deepEqual(liveRecord(winners, 'txn', 'a'), {amount: '-1.00', note: 'fixed', category: 'c2'});
});

test('an offline note edit and a recategorise on another device both survive', () => {
    const base = put('a', 0, 'A', {amount: '-1.00', note: 'x', category: 'food'});
    const phone = put('a', 1, 'P', {note: 'dinner'});
    const mac = put('a', 2, 'M', {category: 'eating out'});
    for (const order of permutations([base, phone, mac])) {
        assert.deepEqual(liveRecord(merge(order), 'txn', 'a'), {amount: '-1.00', note: 'dinner', category: 'eating out'});
    }
});

test('the device id breaks a tie on the same clock', () => {
    assert.equal(liveRecord(merge([put('a', 0, 'B', {v: 'b'}), put('a', 0, 'A', {v: 'a'})]), 'txn', 'a').v, 'b');
});

test('every order of arrival gives the same result', () => {
    const changes = [
        put('a', 0, 'A', {x: 1, y: 1}),
        put('a', 3, 'B', {y: 2}),
        del('a', 2, 'C'),
        put('b', 1, 'A', {x: 1}),
        del('b', 1, 'B'),
    ];
    const result = (order) => JSON.stringify(live(merge(order), 'txn').sort((p, q) => (p.id < q.id ? -1 : 1)));
    const expected = result(changes);
    for (const order of permutations(changes)) {
        assert.equal(result(order), expected);
    }
});

test('a later delete hides the record; a later edit of any field brings it back', () => {
    const deleted = merge([put('a', 0, 'A', {x: 1, y: 1}), del('a', 1, 'B')]);
    assert.equal(liveRecord(deleted, 'txn', 'a'), null);
    assert.equal(known(deleted, 'txn', 'a'), true);
    assert.deepEqual(liveRecord(merge([put('a', 0, 'A', {x: 1, y: 1}), del('a', 1, 'B'), put('a', 2, 'A', {y: 2})]), 'txn', 'a'), {
        x: 1,
        y: 2,
    });
    assert.equal(liveRecord(merge([del('a', 2, 'B'), put('a', 1, 'A', {x: 1})]), 'txn', 'a'), null);
});

test('applyChange reports the fields it replaced, and nothing when applied twice', () => {
    const winners = {};
    assert.deepEqual(applyChange(winners, put('a', 0, 'A', {x: 1})), []);
    const second = put('a', 1, 'B', {x: 2, y: 1});
    assert.deepEqual(applyChange(winners, second), [{field: 'x', previous: {value: 1, clock: '1000000000000-0000', device: 'A'}}]);
    assert.deepEqual(applyChange(winners, {...second}), []);
    assert.deepEqual(applyChange(winners, put('a', 0, 'Z', {x: 9})), [], 'older changes replace nothing');
});

test('live gives values and the device of the latest field', () => {
    const records = live(
        merge([put('a', 0, 'A', {x: 1}), put('a', 1, 'B', {y: 1}), {...put('c', 0, 'A', {x: 1}), kind: 'category'}]),
        'txn',
    );
    assert.deepEqual(records, [{id: 'a', data: {x: 1, y: 1}, device: 'B'}]);
});

test('checkEnvelope rejects broken records', () => {
    assert.doesNotThrow(() => checkEnvelope(put('a', 0, 'A', {x: 1})));
    assert.doesNotThrow(() => checkEnvelope(del('a', 0, 'A')));
    for (const bad of [
        null,
        'x',
        {},
        {...put('a', 0, 'A', {x: 1}), kind: 'holding'},
        put('', 0, 'A', {x: 1}),
        {...put('a', 0, 'A', {x: 1}), clock: 'yesterday'},
        put('a', 0, '', {x: 1}),
        put('a', 0, 'A', {}),
        put('a', 0, 'A', null),
        put('a', 0, 'A', [1]),
        {...put('a', 0, 'A', {x: 1}), op: 'edit'},
    ]) {
        assert.throws(() => checkEnvelope(bad));
    }
});
