// Charts about spending habits. They look at expense transactions only: refunds, income and shares
// lent to people are left out.

import {basisPoints, divideRounded, formatBasisPoints} from '../money.js';
import {addDays, mondayFirst, monthOf, weekdayOf} from '../time.js';
import {amountOf, byText, isWorkday, maxBig} from './amount.js';
import {expenseTxns} from './lines.js';
import {pastBounds} from './scope.js';
import {rankCategories} from './totals.js';

const TOP = 5;

function countWorkdays(project, scope, all) {
    const {start, end, ok} = pastBounds(scope, all);
    let count = 0;
    for (let date = start; ok && date <= end; date = addDays(date, 1)) {
        if (isWorkday(project, weekdayOf(date))) {
            count++;
        }
    }
    return count;
}

function merchantOrNote(t) {
    return t.merchant.trim() || t.note.trim();
}

/** Expenses on workdays by wall-clock hour; rows without a time are left out. */
export function workdayRoutine(txns, all, project, scope) {
    const workdays = countWorkdays(project, scope, all);
    const buckets = Array.from({length: 24}, () => ({
        total: 0n,
        count: 0,
        /** @type {Set<string>} */
        days: new Set(),
        /** @type {Map<string, bigint>} */
        categories: new Map(),
        /** @type {Map<string, {total: bigint, count: number}>} */
        merchants: new Map(),
    }));
    for (const t of expenseTxns(txns)) {
        if (t.unknown || !isWorkday(project, weekdayOf(t.date))) {
            continue;
        }
        const b = buckets[t.hour];
        b.total += t.spend;
        b.count++;
        b.days.add(t.date);
        for (const line of t.lines.filter((l) => l.kind === 'expense')) {
            b.categories.set(line.category, (b.categories.get(line.category) ?? 0n) + line.spend);
        }
        const name = merchantOrNote(t);
        if (name !== '') {
            const m = b.merchants.get(name) ?? {total: 0n, count: 0};
            b.merchants.set(name, {total: m.total + t.spend, count: m.count + 1});
        }
    }
    const hours = buckets.map((b, hour) => ({
        hour,
        occurrences: b.count,
        total: amountOf(b.total, project),
        average: amountOf(divideRounded(b.total, b.count), project),
        share: formatBasisPoints(basisPoints(BigInt(b.days.size), BigInt(workdays))),
        categories: rankCategories(b.categories, project).slice(0, TOP),
        merchants: [...b.merchants]
            .map(([name, m]) => ({name, count: m.count, average: amountOf(divideRounded(m.total, m.count), project)}))
            .sort((x, y) => y.count - x.count || byText(x.name, y.name))
            .slice(0, TOP),
    }));
    return {hours, workdays};
}

/** Spending by weekday (Monday = 0) and hour. */
export function weekdayHours(txns, project) {
    /** @type {Map<string, bigint>} */
    const spent = new Map();
    for (const t of expenseTxns(txns)) {
        if (!t.unknown) {
            const key = `${mondayFirst(weekdayOf(t.date))}:${t.hour}`;
            spent.set(key, (spent.get(key) ?? 0n) + t.spend);
        }
    }
    const cells = [...spent]
        .map(([key, total]) => {
            const [weekday, hour] = key.split(':').map(Number);
            return {weekday, hour, spent: amountOf(total, project)};
        })
        .sort((a, b) => a.weekday - b.weekday || a.hour - b.hour);
    return {cells, max: amountOf([...spent.values()].reduce(maxBig, 0n), project)};
}

/** The expenses that the hour charts had to leave out, newest first. */
export function noTimeRefs(txns, project) {
    return expenseTxns(txns)
        .filter((t) => t.unknown)
        .map((t) => ({id: t.id, date: t.date, merchant: t.merchant, amount: amountOf(t.amount, project)}))
        .sort((a, b) => byText(b.date, a.date));
}

/**
 * Each day of the range's calendar months, marked spent or zero-expense. Days before the first
 * transaction or after today never count as zero-expense days.
 */
export function noSpendCalendar(all, scope) {
    if (all.length === 0) {
        return {noSpend: [], currentStreak: 0};
    }
    const {start, end, ok} = pastBounds(scope, all);
    if (!ok) {
        return {noSpend: [], currentStreak: 0};
    }
    const dates = all.map((t) => t.date).sort();
    const first = dates[0];
    const today = scope.today || dates.at(-1);
    const spentOn = new Set(expenseTxns(all).map((t) => t.date));

    const status = (date) => {
        if (date > today) {
            return 'future';
        }
        if (date < first || date < start || date > end) {
            return 'outside';
        }
        return spentOn.has(date) ? 'spent' : 'zero';
    };

    const noSpend = [];
    for (let month = monthOf(start); month <= monthOf(end); month = monthOf(addDays(`${month}-28`, 4))) {
        noSpend.push(buildMonth(month, status));
    }
    let currentStreak = 0;
    for (let date = today; date >= first && !spentOn.has(date); date = addDays(date, -1)) {
        currentStreak++;
    }
    return {noSpend, currentStreak};
}

/**
 * @param {string} month
 * @param {(date: string) => string} status
 */
function buildMonth(month, status) {
    /** @type {{month: string, days: {date: string, status: string}[], zeroDays: number, bestStreak: number}} */
    const result = {month, days: [], zeroDays: 0, bestStreak: 0};
    let run = 0;
    for (let date = `${month}-01`; monthOf(date) === month; date = addDays(date, 1)) {
        const day = {date, status: status(date)};
        result.days.push(day);
        if (day.status === 'zero') {
            result.zeroDays++;
            run++;
            result.bestStreak = Math.max(result.bestStreak, run);
        } else {
            run = 0;
        }
    }
    return result;
}
