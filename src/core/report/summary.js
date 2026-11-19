import {basisPoints, divideRounded, formatBasisPoints} from '../money.js';
import {daysBetween} from '../time.js';
import {amountOf} from './amount.js';
import {expenseTxns, incomeOf, spentOf} from './lines.js';
import {filterRange, pastBounds, previousPeriod} from './scope.js';

function sumUp(txns) {
    return {spent: spentOf(txns), income: incomeOf(txns), expenseCount: expenseTxns(txns).length};
}

function changeText(now, before, hasPrevious) {
    if (!hasPrevious) {
        return 'No previous data';
    }
    if (before === 0n && now === 0n) {
        return 'No change';
    }
    if (before === 0n) {
        return 'Up from zero';
    }
    return `${formatBasisPoints(basisPoints(now - before, before < 0n ? -before : before), true)} vs previous period`;
}

/** Which way the value moved, and whether that is good news: more spending is worse, more income is better. */
function trendOf(now, before, hasPrevious, moreIsBetter) {
    if (!hasPrevious || now === before) {
        return {direction: '', trend: ''};
    }
    const up = now > before;
    return {direction: up ? 'up' : 'down', trend: up === moreIsBetter ? 'better' : 'worse'};
}

/**
 * The dashboard cards for the scope, each compared with the previous period of the same length.
 * @param {import('../types.js').Txn[]} txns of the account in view
 * @param {import('../types.js').Project} project
 * @param {import('../types.js').Scope} scope
 */
export function summarize(txns, project, scope) {
    const current = sumUp(filterRange(scope, txns));
    const {start, end, ok} = pastBounds(scope, txns);
    const days = ok ? daysBetween(start, end) + 1 : 1;
    const previous = previousPeriod(scope, txns);
    const earlier = previous ? filterRange(previous, txns) : [];
    const before = sumUp(earlier);
    const hasPrevious = earlier.length > 0;

    const average = (t) => divideRounded(t.spent, days);
    const card = (key, label, now, then, moreIsBetter, detail = '') => ({
        key,
        label,
        value: amountOf(now, project),
        detail,
        change: changeText(now, then, hasPrevious),
        ...trendOf(now, then, hasPrevious, moreIsBetter),
    });
    return {
        cards: [
            card('spent', 'Total spent', current.spent, before.spent, false),
            card('income', 'Total income', current.income, before.income, true),
            card('savings', 'Net savings', current.income - current.spent, before.income - before.spent, true),
            card(
                'average',
                'Average daily spend',
                average(current),
                average(before),
                false,
                `over ${current.expenseCount} expense transactions`,
            ),
        ],
    };
}
