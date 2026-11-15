import assert from 'node:assert/strict';
import {test} from 'node:test';

import {ulid} from './ulid.js';

const random = (n) => new Uint8Array(n);

test('ulid encodes the time first, so ids sort by creation', () => {
    assert.equal(ulid(0, random), '00000000000000000000000000');
    assert.equal(ulid(1763112600000, random).slice(0, 10), '01KA0V6GE0');
    assert.ok(ulid(1763112600001, random) > ulid(1763112600000, random));
    assert.match(
        ulid(Date.UTC(2026, 10, 15), (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))),
        /^[0-9A-HJKMNP-TV-Z]{26}$/,
    );
});
