import {noSpendCalendar, noTimeRefs, weekdayHours, workdayRoutine} from './habits.js';
import {filterAccount} from './lines.js';
import {filterRange, previousPeriod} from './scope.js';
import {
    byCategory,
    categoryCompare,
    dailySpending,
    intentTrends,
    monthlyTotals,
    runningBalance,
    smallPurchases,
    topMerchants,
} from './totals.js';

export {accountName, categoryName, UNCATEGORIZED} from './amount.js';
export {budgetStatus} from './budgets.js';
export {accountBalances, ledgerView} from './ledger.js';
export {makeScope, presetRange, validateScope} from './scope.js';
export {summarize} from './summary.js';

/** The dashboard's charts, in order. */
export const CHARTS = [
    {title: 'Monthly totals', type: 'monthly_totals'},
    {title: 'Spending by category', type: 'by_category'},
    {title: 'Compared with the previous period', type: 'category_compare'},
    {title: 'Top merchants', type: 'top_merchants'},
    {title: 'Daily spending', type: 'calendar_heatmap'},
    {title: 'Running balance', type: 'running_balance'},
    {title: 'Spending by intent', type: 'intent_trends'},
    {title: 'Small purchases', type: 'small_purchases'},
    {title: 'Workday routine', type: 'workday_routine'},
    {title: 'Weekday and hour', type: 'weekday_hour_heatmap'},
    {title: 'No-spend days', type: 'no_spend_calendar'},
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
            return {...chart, categories: byCategory(inRange, project)};
        case 'category_compare':
            return {...chart, ...categoryCompare(all, project, scope, previousPeriod(scope, all))};
        case 'top_merchants':
            return {...chart, merchants: topMerchants(inRange, project)};
        case 'calendar_heatmap':
            return {...chart, ...dailySpending(inRange, project)};
        case 'running_balance':
            return {...chart, balance: runningBalance(book.txns, book.transfers, project, scope)};
        case 'intent_trends':
            return {...chart, ...intentTrends(inRange, project)};
        case 'small_purchases':
            return {...chart, ...smallPurchases(inRange, project)};
        case 'workday_routine':
            return {...chart, ...workdayRoutine(inRange, all, project, scope), noTime: noTimeRefs(inRange, project)};
        case 'weekday_hour_heatmap':
            return {...chart, ...weekdayHours(inRange, project), noTime: noTimeRefs(inRange, project)};
        case 'no_spend_calendar':
            return {...chart, ...noSpendCalendar(all, scope)};
    }
    return {...chart, error: `unknown chart type "${def.type}"`};
}

export function runAll(defs, book, scope) {
    return defs.map((def) => run(def, book, scope));
}
