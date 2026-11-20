// Money is a BigInt of minor units (cents for 2 decimals). Negative is an expense.

const MAX_DECIMALS = 18;
const MAX_MINOR = 2n ** 63n - 1n;

const CURRENCY_SYMBOLS = {INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥'};

/** Reads an exact decimal such as "-12.50" into minor units, using the given decimal places. */
export function parseMoney(text, decimals) {
    const invalid = () => new Error(`invalid amount "${text}"`);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
        throw new Error(`unsupported decimal places ${decimals}`);
    }
    const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(String(text));
    if (!match || (match[3] ?? '').length > decimals) {
        throw invalid();
    }
    const [, sign, whole, fraction = ''] = match;
    const minor = BigInt(whole + fraction.padEnd(decimals, '0'));
    if (minor > MAX_MINOR) {
        throw invalid();
    }
    return sign === '-' ? -minor : minor;
}

/** Renders minor units with exactly the given decimal places, e.g. "-12.50". */
export function formatMoney(minor, decimals) {
    const sign = minor < 0n ? '-' : '';
    const digits = (minor < 0n ? -minor : minor).toString();
    if (decimals === 0) {
        return sign + digits;
    }
    const padded = digits.padStart(decimals + 1, '0');
    return `${sign}${padded.slice(0, -decimals)}.${padded.slice(-decimals)}`;
}

function currencyPrefix(currency) {
    return CURRENCY_SYMBOLS[currency] ?? `${currency} `;
}

/** The sign for negative amounts and percentages on screen: a true minus (U+2212), as wide as + and never read as a hyphen. */
export const MINUS = '\u2212';

/** Formats for display, with the currency symbol, thousands grouping and a true minus, e.g. "−₹1,234.50". Never stored or parsed. */
export function displayMoney(minor, currency, decimals) {
    const text = formatMoney(minor, decimals);
    const sign = text.startsWith('-') ? MINUS : '';
    const [whole, fraction] = text.replace('-', '').split('.');
    return sign + currencyPrefix(currency) + groupThousands(whole) + (fraction === undefined ? '' : `.${fraction}`);
}

function groupThousands(digits) {
    return digits.replace(/\B(?=(\d{3})+$)/g, ',');
}

/** Divides by a whole count, rounding half away from zero; dividing by zero or less gives 0. */
export function divideRounded(minor, count) {
    const n = BigInt(count);
    if (n <= 0n) {
        return 0n;
    }
    const quotient = minor / n;
    const remainder = minor % n;
    const twice = (remainder < 0n ? -remainder : remainder) * 2n;
    if (twice >= n) {
        return minor < 0n ? quotient - 1n : quotient + 1n;
    }
    return quotient;
}

/** num/den in hundredths of a percent, rounded half away from zero. */
export function basisPoints(num, den) {
    const numerator = BigInt(num) * 10000n;
    const denominator = BigInt(den);
    if (denominator === 0n) {
        return 0n;
    }
    const quotient = numerator / denominator;
    const remainder = numerator % denominator;
    const twice = (remainder < 0n ? -remainder : remainder) * 2n;
    if (twice >= (denominator < 0n ? -denominator : denominator)) {
        return numerator < 0n !== denominator < 0n ? quotient - 1n : quotient + 1n;
    }
    return quotient;
}

/** Renders hundredths of a percent for display as "12.34%", with a true minus, or a leading + when showPlus is set. */
export function formatBasisPoints(bp, showPlus = false) {
    let sign = '';
    if (bp < 0n) {
        sign = MINUS;
        bp = -bp;
    } else if (showPlus && bp > 0n) {
        sign = '+';
    }
    return `${sign}${bp / 100n}.${String(bp % 100n).padStart(2, '0')}%`;
}
