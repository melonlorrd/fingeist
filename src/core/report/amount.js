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
/** whole and fraction split text at the decimal point ("₹24,302" and ".00"), so a large figure can show its minor units smaller. */
export function amountOf(minor, project) {
    return withText({minor, size: Number(minor), negative: minor < 0n}, displayMoney(minor, project.currency, project.decimals));
}

/** Like amountOf, with a + on positive values, for amounts where the sign is the point. */
export function signedAmountOf(minor, project) {
    const amount = amountOf(minor, project);
    return {...withText(amount, minor > 0n ? `+${amount.text}` : amount.text), positive: minor > 0n};
}

function withText(amount, text) {
    const point = text.indexOf('.');
    return {...amount, text, whole: point === -1 ? text : text.slice(0, point), fraction: point === -1 ? '' : text.slice(point)};
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

export function byText(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A value axis for amounts: round steps (1, 2 or 5 × a power of ten, at least one whole unit) giving about three
 * intervals around the values, each tick with its label. Sizes are for drawing only.
 * @param {bigint[]} values
 */
export function moneyAxis(values, project) {
    if (values.length === 0) {
        return {min: 0, max: 0, interval: 0, ticks: []};
    }
    const low = values.reduce((a, b) => (b < a ? b : a));
    /** @type {bigint} */
    const high = values.reduce(maxBig);
    const step = roundStep((high - low) / 3n, 10n ** BigInt(project.decimals));
    const min = floorTo(low, step);
    const max = high === min ? min + step : -floorTo(-high, step);
    const ticks = [];
    for (let v = min; v <= max; v += step) {
        ticks.push({size: Number(v), text: amountOf(v, project).whole});
    }
    return {min: Number(min), max: Number(max), interval: Number(step), ticks};
}

/** @param {bigint} raw @param {bigint} unit @returns {bigint} */
function roundStep(raw, unit) {
    const target = raw > unit ? raw : unit;
    let power = unit;
    while (power * 10n <= target) {
        power *= 10n;
    }
    return [1n, 2n, 5n, 10n].map((m) => power * m).find((step) => step >= target) ?? power * 10n;
}

/** @param {bigint} value @param {bigint} step @returns {bigint} */
function floorTo(value, step) {
    const quotient = value / step;
    return (value % step < 0n ? quotient - 1n : quotient) * step;
}
