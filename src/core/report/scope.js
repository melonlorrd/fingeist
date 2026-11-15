import {addDays, addMonths, cycleEnd, cycleOf, cycleStart, daysBetween, isDate} from '../time.js';

/**
 * The part of the book a view covers. from and to are inclusive dates, either may be ''. today marks
 * where the future begins. account is '' for all accounts.
 * @param {Partial<import('../types.js').Scope>} [parts]
 * @returns {import('../types.js').Scope}
 */
export function makeScope({from = '', to = '', today = '', account = ''} = {}) {
    return {from, to, today, account};
}

export function validateScope(scope) {
    for (const date of [scope.from, scope.to]) {
        if (date !== '' && !isDate(date)) {
            throw new Error(`invalid date "${date}": use YYYY-MM-DD`);
        }
    }
    if (scope.from !== '' && scope.to !== '' && scope.from > scope.to) {
        throw new Error(`the start date ${scope.from} is after the end date ${scope.to}`);
    }
}

export function inRange(scope, date) {
    return (scope.from === '' || date >= scope.from) && (scope.to === '' || date <= scope.to);
}

/** Rows dated within the range, by their own wall-clock date. */
export function filterRange(scope, rows) {
    return rows.filter((r) => inRange(scope, r.date));
}

/** Open ends resolved: the first row opens the range; today, else the last row, closes it. */
export function bounds(scope, all) {
    let first = '';
    let last = '';
    for (const r of all) {
        if (first === '' || r.date < first) {
            first = r.date;
        }
        if (r.date > last) {
            last = r.date;
        }
    }
    const start = scope.from || first;
    const end = scope.to || scope.today || last;
    return {start, end, ok: start !== '' && end !== '' && start <= end};
}

/** bounds with the end held back to today, since future days have no spending yet. */
export function pastBounds(scope, all) {
    const b = bounds(scope, all);
    const end = b.ok && scope.today !== '' && b.end > scope.today ? scope.today : b.end;
    return {start: b.start, end, ok: b.ok && b.start <= end};
}

/** The period of the same length directly before the scope, or null when it has no start. */
export function previousPeriod(scope, all) {
    const {start, end, ok} = pastBounds(scope, all);
    if (!ok || scope.from === '') {
        return null;
    }
    const days = daysBetween(start, end) + 1;
    return makeScope({from: addDays(start, -days), to: addDays(start, -1)});
}

/** A named range ending today. Months start on monthStart. All time has no bounds. */
export function presetRange(name, today, monthStart = 1) {
    if (!isDate(today)) {
        throw new Error(`invalid date "${today}": use YYYY-MM-DD`);
    }
    const month = cycleOf(today, monthStart);
    switch (name) {
        case 'this_month':
            return {from: cycleStart(month, monthStart), to: today};
        case 'last_month':
            return {from: cycleStart(addMonths(month, -1), monthStart), to: cycleEnd(addMonths(month, -1), monthStart)};
        case 'last_30_days':
            return {from: addDays(today, -29), to: today};
        case 'three_months':
            return {from: cycleStart(addMonths(month, -2), monthStart), to: today};
        case 'year_to_date':
            return {from: `${today.slice(0, 4)}-01-01`, to: today};
        case 'all_time':
            return {from: '', to: ''};
    }
    throw new Error(`unknown range "${name}"`);
}
