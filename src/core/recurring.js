// Repeating entries. Each occurrence gets an id made from the repeat's id and its date, so devices
// that create the same occurrence offline write the same record, and a deleted one stays deleted.

import {known} from './state.js';
import {addDays, addMonths, monthOf} from './time.js';

const MAX_OCCURRENCES = 2000;

function daysIn(month) {
    return Number(addDays(`${addMonths(month, 1)}-01`, -1).slice(8, 10));
}

/** The nth date after start, keeping the start's day of the month (clamped to short months). */
function nth(start, every, n) {
    if (every === 'day') {
        return addDays(start, n);
    }
    if (every === 'week') {
        return addDays(start, 7 * n);
    }
    const month = addMonths(monthOf(start), every === 'month' ? n : 12 * n);
    const day = Math.min(Number(start.slice(8, 10)), daysIn(month));
    return `${month}-${String(day).padStart(2, '0')}`;
}

/** The dates of a repeat from its start up to today (and its end date, if any). */
export function occurrences(repeat, today) {
    const last = repeat.until && repeat.until < today ? repeat.until : today;
    const dates = [];
    for (let n = 0; n < MAX_OCCURRENCES; n++) {
        const date = nth(repeat.start, repeat.every, n);
        if (date > last) {
            break;
        }
        dates.push(date);
    }
    return dates;
}

export function occurrenceId(repeatId, date) {
    return `${repeatId}.${date}`;
}

/** The entries due by today that no device has created (or deleted) yet. */
export function dueEntries(winners, repeats, today) {
    return repeats
        .filter((r) => !r.paused)
        .flatMap((r) =>
            occurrences(r, today)
                .map((date) => ({kind: r.entry, id: occurrenceId(r.id, date), fields: {...r.template, time: date, recurring: r.id}}))
                .filter((e) => !known(winners, e.kind, e.id)),
        );
}
