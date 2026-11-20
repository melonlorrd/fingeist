import {basisPoints, formatBasisPoints} from '../money.js';
import {cycleEnd, cycleOf, cycleStart, daysBetween} from '../time.js';
import {amountOf, byText, categoryColor, categoryName} from './amount.js';
import {spendingLines} from './lines.js';

/** A budget this used up, or more, is close to its limit. */
const NEAR_PERCENT = 85n;

/**
 * Each budget against this month's spending in its category, across all accounts. Months start on
 * the project's month start day.
 * @param {import('../types.js').Book} book
 * @param {string} today
 */
export function budgetStatus(book, today) {
    const {project} = book;
    const month = cycleOf(today, project.monthStart);
    const from = cycleStart(month, project.monthStart);
    const to = cycleEnd(month, project.monthStart);
    /** @type {Map<string, bigint>} */
    const spent = new Map();
    for (const line of spendingLines(book.txns)) {
        if (line.date >= from && line.date <= to) {
            spent.set(line.category, (spent.get(line.category) ?? 0n) + line.spend);
        }
    }
    const rows = book.budgets
        .map((b) => {
            const used = spent.get(b.category) ?? 0n;
            const bp = basisPoints(used, b.amount);
            return {
                category: b.category,
                name: categoryName(project, b.category),
                color: categoryColor(project, b.category),
                budget: amountOf(b.amount, project),
                spent: amountOf(used, project),
                left: amountOf(b.amount - used, project),
                share: formatBasisPoints(bp),
                shareSize: Number(bp > 10000n ? 10000n : bp < 0n ? 0n : bp),
                over: used > b.amount,
                near: used <= b.amount && used * 100n >= b.amount * NEAR_PERCENT,
            };
        })
        .sort((a, b) => Number(b.over) - Number(a.over) || byText(a.name, b.name));
    const budgeted = book.budgets.reduce((sum, b) => sum + b.amount, 0n);
    const used = rows.reduce((sum, r) => sum + r.spent.minor, 0n);
    return {
        month,
        from,
        to,
        daysLeft: Math.max(0, daysBetween(today, to) + 1),
        rows,
        total: {budget: amountOf(budgeted, project), spent: amountOf(used, project), left: amountOf(budgeted - used, project)},
    };
}
