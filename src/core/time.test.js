import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
    addDays,
    addMonths,
    cycleEnd,
    cycleOf,
    cycleStart,
    daysBetween,
    isDate,
    mondayFirst,
    monthOf,
    offsetText,
    parseWhen,
    stamp,
    weekdayOf,
} from './time.js';

test('parseWhen keeps the wall clock of the row', async (t) => {
    const cases = [
        ['offset east', '2026-11-07T14:30:00+05:30', '2026-11-07', 14, Date.UTC(2026, 10, 7, 9, 0)],
        ['offset west', '2026-11-07T23:30:00-05:00', '2026-11-07', 23, Date.UTC(2026, 10, 8, 4, 30)],
        ['utc', '2026-11-07T00:00:00Z', '2026-11-07', 0, Date.UTC(2026, 10, 7)],
        ['fraction', '2026-11-07T10:00:00.5+00:00', '2026-11-07', 10, Date.UTC(2026, 10, 7, 10, 0, 0, 500)],
        ['before a DST change keeps its own offset', '2026-03-08T01:30:00-05:00', '2026-03-08', 1, Date.UTC(2026, 2, 8, 6, 30)],
        ['after a DST change keeps its own offset', '2026-03-08T03:30:00-04:00', '2026-03-08', 3, Date.UTC(2026, 2, 8, 7, 30)],
        ['leap day', '2028-02-29T12:00:00+01:00', '2028-02-29', 12, Date.UTC(2028, 1, 29, 11)],
    ];
    for (const [name, text, date, hour, instant] of cases) {
        await t.test(name, () => {
            const when = parseWhen(text);
            assert.deepEqual([when.date, when.hour, when.unknown, when.instant, when.time], [date, hour, false, instant, text]);
        });
    }
});

test('parseWhen reads a bare date as time unknown, never midnight', () => {
    const when = parseWhen('2026-11-07');
    assert.deepEqual(when, {time: '2026-11-07', date: '2026-11-07', hour: null, minute: null, unknown: true, instant: null});
});

test('parseWhen rejects anything else', () => {
    for (const bad of [
        '',
        'soon',
        '2026-11-7',
        '2026-13-01',
        '2026-02-30',
        '2027-02-29',
        '2026-11-07T14:30+05:30',
        '2026-11-07T14:30:00',
        '2026-11-07 14:30:00+05:30',
        '2026-11-07T24:00:00Z',
        '2026-11-07T10:60:00Z',
        '2026-11-07T10:00:00+24:00',
        ' 2026-11-07',
        '2026-11-07T10:00:00z',
    ]) {
        assert.throws(() => parseWhen(bad), `${bad} should be invalid`);
    }
});

test('calendar math', () => {
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(addDays('2028-03-01', -1), '2028-02-29');
    assert.equal(addDays('1969-12-31', 1), '1970-01-01');
    assert.equal(daysBetween('2026-11-01', '2026-11-30'), 29);
    assert.equal(daysBetween('2026-11-30', '2026-11-01'), -29);
    assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2);
    assert.equal(weekdayOf('2026-11-02'), 1);
    assert.equal(weekdayOf('2026-11-08'), 0);
    assert.equal(weekdayOf('1969-12-28'), 0);
    assert.equal(mondayFirst(0), 6);
    assert.equal(mondayFirst(1), 0);
    assert.equal(monthOf('2026-11-07'), '2026-11');
    assert.equal(addMonths('2026-11', 2), '2027-01');
    assert.equal(addMonths('2026-02', -2), '2025-12');
    assert.equal(isDate('2026-11-07'), true);
    assert.equal(isDate('2026-11-31'), false);
});

test('stamp and offsetText', () => {
    assert.equal(offsetText(330), '+05:30');
    assert.equal(offsetText(-300), '-05:00');
    assert.equal(offsetText(0), '+00:00');
    assert.equal(offsetText(-30), '-00:30');
    assert.equal(stamp('2026-11-07', '09:05', '+05:30'), '2026-11-07T09:05:00+05:30');
    assert.equal(parseWhen(stamp('2026-11-07', '23:59', '-05:00')).hour, 23);
    for (const [date, clock] of [
        ['2026-11-07', '9:05'],
        ['2026-11-07', '25:00'],
        ['2026-11-31', '10:00'],
        ['2026-11-07', ''],
    ]) {
        assert.throws(() => stamp(date, clock, '+00:00'));
    }
});

test('month cycles with a start day', () => {
    assert.equal(cycleOf('2026-11-07'), '2026-11');
    assert.equal(cycleOf('2026-11-24', 25), '2026-10');
    assert.equal(cycleOf('2026-11-25', 25), '2026-11');
    assert.equal(cycleOf('2026-01-03', 5), '2025-12');
    assert.equal(cycleStart('2026-11', 25), '2026-11-25');
    assert.equal(cycleEnd('2026-11', 25), '2026-12-24');
    assert.equal(cycleEnd('2026-02'), '2026-02-28');
    assert.equal(cycleEnd('2026-12'), '2026-12-31');
});
