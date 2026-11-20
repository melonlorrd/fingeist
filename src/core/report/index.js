import {hourRoutine, noTimeRefs, spendingCalendar} from './habits.js';
import {filterAccount} from './lines.js';
import {filterRange, previousPeriod} from './scope.js';
import {byCategory, intentTrends, monthlyTotals, runningBalance, smallPurchases, topMerchants} from './totals.js';

export {accountName, categoryName, UNCATEGORIZED} from './amount.js';
export {budgetStatus} from './budgets.js';
export {accountBalances, ledgerView} from './ledger.js';
export {makeScope, presetRange, validateScope} from './scope.js';
export {summarize} from './summary.js';

/** The dashboard's charts, in order. */
export const CHARTS = [
    {title: 'Running balance', type: 'running_balance'},
    {title: 'Monthly totals', type: 'monthly_totals'},
    {title: 'Spending by category', type: 'by_category'},
    {title: 'Top merchants', type: 'top_merchants'},
    {title: 'Spending calendar', type: 'spending_calendar'},
    {title: 'Time of day', type: 'hour_routine'},
    {title: 'Spending by intent', type: 'intent_trends'},
    {title: 'Small purchases', type: 'small_purchases'},
];

/**
 * The data of one chart. The scope picks the range and account.
 * @param {{title?: string, type: string}} def
 * @param {import('../types.js').Book} book
 * @param {import('../types.js').Scope} scope
 */
export function run(def, book, scope) {
    const {project} = book;
    const all = filterAccount(scope, book.txns);
    const inRange = filterRange(scope, all);
    const chart = {title: def.title, type: def.type};
    switch (def.type) {
        case 'monthly_totals':
            return {...chart, months: monthlyTotals(inRange, project)};
        case 'by_category':
            return {...chart, ...byCategory(all, project, scope, previousPeriod(scope, all))};
        case 'top_merchants':
            return {...chart, merchants: topMerchants(inRange, project)};
        case 'spending_calendar':
            return {...chart, ...spendingCalendar(all, project, scope)};
        case 'running_balance':
            return {...chart, balance: runningBalance(book.txns, book.transfers, project, scope)};
        case 'intent_trends':
            return {...chart, ...intentTrends(inRange, project)};
        case 'small_purchases':
            return {...chart, ...smallPurchases(inRange, project)};
        case 'hour_routine':
            return {...chart, ...hourRoutine(inRange, all, project, scope), noTime: noTimeRefs(inRange, project)};
    }
    return {...chart, error: `unknown chart type "${def.type}"`};
}

export function runAll(defs, book, scope) {
    return defs.map((def) => run(def, book, scope));
}
