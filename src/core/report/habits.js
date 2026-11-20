// Charts about spending habits. They look at expense transactions only: refunds, income and shares
// lent to people are left out.

import {basisPoints, divideRounded, formatBasisPoints} from '../money.js';
import {addDays, daysBetween, mondayFirst, monthOf, weekdayOf} from '../time.js';
import {amountOf, byText, maxBig} from './amount.js';
import {expenseTxns} from './lines.js';
import {pastBounds} from './scope.js';
import {rankCategories} from './totals.js';

const TOP = 5;

function countDays(scope, all) {
    const {start, end, ok} = pastBounds(scope, all);
    return ok ? daysBetween(start, end) + 1 : 0;
}

function merchantOrNote(t) {
    return t.merchant.trim() || t.note.trim();
}

/** Expenses by wall-clock hour on every day of the week; rows without a time are left out. */
export function hourRoutine(txns, all, project, scope) {
    const days = countDays(scope, all);
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
        if (t.unknown) {
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
        share: formatBasisPoints(basisPoints(BigInt(b.days.size), BigInt(days))),
        categories: rankCategories(b.categories, project).slice(0, TOP),
        merchants: [...b.merchants]
            .map(([name, m]) => ({name, count: m.count, average: amountOf(divideRounded(m.total, m.count), project)}))
            .sort((x, y) => y.count - x.count || byText(x.name, y.name))
            .slice(0, TOP),
    }));
    return {hours, days};
}

/** The expenses that the hour charts had to leave out, newest first. */
export function noTimeRefs(txns, project) {
    return expenseTxns(txns)
        .filter((t) => t.unknown)
        .map((t) => ({id: t.id, date: t.date, merchant: t.merchant, amount: amountOf(t.amount, project)}))
        .sort((a, b) => byText(b.date, a.date));
}

/**
 * Each day of the range's calendar months with what was spent, marked spent or zero-expense. Days
 * before the first transaction or after today never count as zero-expense days. level runs from
 * 1 to 4 on spent days, relative to the range's biggest day; lead is how many Monday-first weekdays come before the 1st.
 */
export function spendingCalendar(all, project, scope) {
    const empty = {months: [], currentStreak: 0, max: amountOf(0n, project)};
    if (all.length === 0) {
        return empty;
    }
    const {start, end, ok} = pastBounds(scope, all);
    if (!ok) {
        return empty;
    }
    const dates = all.map((t) => t.date).sort();
    const first = dates[0];
    const today = scope.today || dates.at(-1);
    /** @type {Map<string, bigint>} */
    const spentOn = new Map();
    for (const t of expenseTxns(all)) {
        spentOn.set(t.date, (spentOn.get(t.date) ?? 0n) + t.spend);
    }

    const status = (date) => {
        if (date > today) {
            return 'future';
        }
        if (date < first || date < start || date > end) {
            return 'outside';
        }
        return spentOn.has(date) ? 'spent' : 'zero';
    };
    const max = [...spentOn].filter(([date]) => status(date) === 'spent').reduce((m, [, spent]) => maxBig(m, spent), 0n);
    const day = (date) => {
        const dayStatus = status(date);
        const spent = dayStatus === 'spent' ? (spentOn.get(date) ?? 0n) : 0n;
        return {date, status: dayStatus, spent: amountOf(spent, project), level: heatLevel(spent, max)};
    };

    const months = [];
    for (let month = monthOf(start); month <= monthOf(end); month = monthOf(addDays(`${month}-28`, 4))) {
        months.push(buildMonth(month, day));
    }
    let currentStreak = 0;
    for (let date = today; date >= first && !spentOn.has(date); date = addDays(date, -1)) {
        currentStreak++;
    }
    return {months, currentStreak, max: amountOf(max, project)};
}

/** 0 for no spending, else 1 to 4 in equal steps up to max. */
function heatLevel(spent, max) {
    if (spent <= 0n || max <= 0n) {
        return 0;
    }
    const level = (spent * 4n - 1n) / max + 1n;
    return Number(level);
}

/**
 * @template {{status: string}} Day
 * @param {string} month
 * @param {(date: string) => Day} day
 */
function buildMonth(month, day) {
    /** @type {{month: string, lead: number, days: Day[], zeroDays: number, bestStreak: number}} */
    const result = {month, lead: mondayFirst(weekdayOf(`${month}-01`)), days: [], zeroDays: 0, bestStreak: 0};
    let run = 0;
    for (let date = `${month}-01`; monthOf(date) === month; date = addDays(date, 1)) {
        const d = day(date);
        result.days.push(d);
        if (d.status === 'zero') {
            result.zeroDays++;
            run++;
            result.bestStreak = Math.max(result.bestStreak, run);
        } else {
            run = 0;
        }
    }
    return result;
}
