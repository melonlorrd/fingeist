import assert from 'node:assert/strict';
import {test} from 'node:test';

import {isClock, laterClock, nextClock, ZERO_CLOCK} from './clock.js';

test('nextClock follows the wall clock when it moves forward', () => {
    assert.equal(nextClock(ZERO_CLOCK, 1763112600000), '1763112600000-0000');
    assert.equal(nextClock('1763112600000-0003', 1763112600001), '1763112600001-0000');
});

test('nextClock never goes back when the wall clock is behind or stuck', () => {
    assert.equal(nextClock('1763112600000-0000', 1763112600000), '1763112600000-0001');
    assert.equal(nextClock('1763112600000-0005', 1000), '1763112600000-0006');
    assert.equal(nextClock('1763112600000-9999', 1000), '1763112600001-0000');
});

test('a device with a slow clock still orders after what it has seen', () => {
    const seenFromFastDevice = '1999999999999-0000';
    const mine = nextClock(laterClock('1763112600000-0000', seenFromFastDevice), 1763112600500);
    assert.ok(mine > seenFromFastDevice);
});

test('clocks compare as strings', () => {
    assert.ok('1763112600000-0002' > '1763112600000-0001');
    assert.ok('1763112600001-0000' > '1763112600000-9999');
    assert.equal(laterClock('1763112600000-0001', '1763112600000-0002'), '1763112600000-0002');
    assert.equal(isClock('1763112600000-0001'), true);
    assert.equal(isClock('176311260000-0001'), false);
    assert.equal(isClock(42), false);
});
