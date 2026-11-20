import assert from 'node:assert/strict';
import {test} from 'node:test';

import {basisPoints, displayMoney, divideRounded, formatBasisPoints, formatMoney, parseMoney} from './money.js';

const MAX = 2n ** 63n - 1n;

test('parseMoney', async (t) => {
    const cases = [
        ['two decimals', '12.50', 2, 1250n],
        ['negative', '-120.00', 2, -12000n],
        ['explicit plus', '+2500.00', 2, 250000n],
        ['fewer digits than places', '12.5', 2, 1250n],
        ['no point', '12', 2, 1200n],
        ['zero decimals', '1500', 0, 1500n],
        ['three decimals', '-1.005', 3, -1005n],
        ['leading zeros', '007.05', 2, 705n],
        ['zero', '0.00', 2, 0n],
        ['negative zero', '-0', 2, 0n],
        ['max', '9223372036854775807', 0, MAX],
        ['too many digits for places', '1.005', 2, null],
        ['fraction with zero places', '1.0', 0, null],
        ['overflow', '9223372036854775808', 0, null],
        ['overflow with decimals', '92233720368547758.08', 2, null],
        ['empty', '', 2, null],
        ['sign only', '-', 2, null],
        ['double sign', '--1', 2, null],
        ['mixed signs', '+-1', 2, null],
        ['no whole part', '.50', 2, null],
        ['trailing point', '12.', 2, null],
        ['letters', 'abc', 2, null],
        ['thousands separator', '1,000.00', 2, null],
        ['comma decimal', '12,50', 2, null],
        ['spaces', ' 12.50', 2, null],
        ['exponent', '1e3', 2, null],
        ['negative places', '1', -1, null],
        ['too many places', '1', 19, null],
        ['not an integer place count', '1', 1.5, null],
    ];
    for (const [name, text, decimals, want] of cases) {
        await t.test(name, () => {
            if (want === null) {
                assert.throws(() => parseMoney(text, decimals));
            } else {
                assert.equal(parseMoney(text, decimals), want);
            }
        });
    }
});

test('formatMoney', () => {
    const cases = [
        [1250n, 2, '12.50'],
        [-12000n, 2, '-120.00'],
        [0n, 2, '0.00'],
        [5n, 2, '0.05'],
        [-5n, 2, '-0.05'],
        [1500n, 0, '1500'],
        [-1005n, 3, '-1.005'],
        [-(2n ** 63n), 0, '-9223372036854775808'],
        [MAX, 2, '92233720368547758.07'],
    ];
    for (const [minor, decimals, want] of cases) {
        assert.equal(formatMoney(minor, decimals), want, `${minor} with ${decimals}`);
    }
});

test('money round trip', () => {
    for (const decimals of [0, 2, 3]) {
        for (const minor of [0n, 1n, -1n, 99n, 100n, -12345n, MAX, -MAX]) {
            assert.equal(parseMoney(formatMoney(minor, decimals), decimals), minor);
        }
    }
});

test('displayMoney', () => {
    const cases = [
        [88372729n, 'INR', 2, '₹883,727.29'],
        [-123450n, 'INR', 2, '−₹1,234.50'],
        [0n, 'INR', 2, '₹0.00'],
        [5n, 'INR', 2, '₹0.05'],
        [100000n, 'USD', 2, '$1,000.00'],
        [-5n, 'EUR', 2, '−€0.05'],
        [123456789n, 'GBP', 2, '£1,234,567.89'],
        [1500000n, 'JPY', 0, '¥1,500,000'],
        [123456n, 'CHF', 2, 'CHF 1,234.56'],
        [-1234567n, 'KWD', 3, '−KWD 1,234.567'],
        [99900n, 'USD', 2, '$999.00'],
        [100000n, 'USD', 2, '$1,000.00'],
        [-MAX, 'INR', 2, '−₹92,233,720,368,547,758.07'],
    ];
    for (const [minor, currency, decimals, want] of cases) {
        assert.equal(displayMoney(minor, currency, decimals), want);
    }
});

test('basisPoints', () => {
    const cases = [
        [1n, 2n, 5000n],
        [1n, 3n, 3333n],
        [2n, 3n, 6667n],
        [3n, 2n, 15000n],
        [-1n, 3n, -3333n],
        [-2n, 3n, -6667n],
        [1n, -4n, -2500n],
        [5n, 0n, 0n],
        [MAX / 2n, MAX, 5000n],
    ];
    for (const [num, den, want] of cases) {
        assert.equal(basisPoints(num, den), want, `${num}/${den}`);
    }
});

test('formatBasisPoints', () => {
    const cases = [
        [1234n, false, '12.34%'],
        [1234n, true, '+12.34%'],
        [-1234n, true, '−12.34%'],
        [5n, true, '+0.05%'],
        [-5n, false, '−0.05%'],
        [0n, true, '0.00%'],
        [10000n, false, '100.00%'],
    ];
    for (const [bp, plus, want] of cases) {
        assert.equal(formatBasisPoints(bp, plus), want);
    }
});

test('divideRounded', () => {
    const cases = [
        [100n, 3, 33n],
        [200n, 3, 67n],
        [5n, 2, 3n],
        [-5n, 2, -3n],
        [-100n, 3, -33n],
        [100n, 0, 0n],
        [0n, 5, 0n],
    ];
    for (const [minor, n, want] of cases) {
        assert.equal(divideRounded(minor, n), want, `${minor}/${n}`);
    }
});
