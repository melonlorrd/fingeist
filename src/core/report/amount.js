import {displayMoney} from '../money.js';

/** The category filter value for rows without a category. */
export const UNCATEGORIZED = 'uncategorized';
const UNCATEGORIZED_NAME = 'Uncategorized';

/**
 * A money value for the screen: text is what to show; size is only for drawing bars and cells.
 * @param {bigint} minor
 * @param {{currency: string, decimals: number}} project
 * @returns {import('../types.js').Amount}
 */
export function amountOf(minor, project) {
    return {minor, text: displayMoney(minor, project.currency, project.decimals), size: Number(minor), negative: minor < 0n};
}

/** Like amountOf, with a + on positive values, for amounts where the sign is the point. */
export function signedAmountOf(minor, project) {
    const amount = amountOf(minor, project);
    return {...amount, text: minor > 0n ? `+${amount.text}` : amount.text, positive: minor > 0n};
}

export function compareBig(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}

export function maxBig(a, b) {
    return a > b ? a : b;
}

export function categoryName(project, id) {
    return project.categoryById.get(id)?.name ?? UNCATEGORIZED_NAME;
}

export function categoryColor(project, id) {
    return project.categoryById.get(id)?.color ?? '';
}

export function accountName(project, id) {
    return project.accountById.get(id)?.name ?? 'Deleted account';
}

export function isWorkday(project, weekday) {
    return project.workdays.includes(weekday);
}

export function byText(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
