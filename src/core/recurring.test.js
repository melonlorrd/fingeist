import assert from 'node:assert/strict';
import {test} from 'node:test';

import {dueEntries, occurrences} from './recurring.js';
import {applyChange} from './state.js';

const repeat = (every, start, extra = {}) => ({
    id: 'R1',
    entry: 'txn',
    template: {amount: '-500.00', account: 'a1'},
    every,
    start,
    until: '',
    paused: false,
    ...extra,
});

test('occurrences step from the start up to today', () => {
    assert.deepEqual(occurrences(repeat('day', '2026-11-13'), '2026-11-15'), ['2026-11-13', '2026-11-14', '2026-11-15']);
    assert.deepEqual(occurrences(repeat('week', '2026-10-30'), '2026-11-15'), ['2026-10-30', '2026-11-06', '2026-11-13']);
    assert.deepEqual(occurrences(repeat('year', '2024-02-29'), '2026-03-01'), ['2024-02-29', '2025-02-28', '2026-02-28']);
    assert.deepEqual(occurrences(repeat('month', '2026-11-16'), '2026-11-15'), []);
});

test('monthly repeats keep their day, clamped in short months', () => {
    assert.deepEqual(occurrences(repeat('month', '2026-01-31'), '2026-04-30'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});

test('an end date stops the repeat', () => {
    assert.deepEqual(occurrences(repeat('month', '2026-08-01', {until: '2026-09-15'}), '2026-11-15'), ['2026-08-01', '2026-09-01']);
});

test('due entries have stable ids, skip what exists or was deleted, and skip paused repeats', () => {
    const winners = {};
    applyChange(winners, {
        kind: 'txn',
        id: 'R1.2026-09-01',
        op: 'put',
        clock: '1000000000000-0000',
        device: 'A',
        fields: {amount: '-500.00'},
    });
    applyChange(winners, {kind: 'txn', id: 'R1.2026-10-01', op: 'delete', clock: '1000000000000-0000', device: 'A'});
    const due = dueEntries(winners, [repeat('month', '2026-09-01'), repeat('month', '2026-09-01', {id: 'R2', paused: true})], '2026-11-15');
    assert.deepEqual(due, [
        {kind: 'txn', id: 'R1.2026-11-01', fields: {amount: '-500.00', account: 'a1', time: '2026-11-01', recurring: 'R1'}},
    ]);
});
