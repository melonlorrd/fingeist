import assert from 'node:assert/strict';
import {test} from 'node:test';

import {formatMoney} from '../money.js';
import {buildBook} from '../records.js';
import {applyChange} from '../state.js';
import {amountOf, moneyAxis, signedAmountOf} from './amount.js';
import {
    accountBalances,
    budgetStatus,
    CHARTS,
    ledgerView,
    makeScope,
    presetRange,
    run,
    runAll,
    summarize,
    UNCATEGORIZED,
    validateScope,
} from './index.js';
import {filterAccount} from './lines.js';
import {filterRange} from './scope.js';

const a = (minor, text) => {
    const point = text.indexOf('.');
    return {minor, size: Number(minor), negative: minor < 0n, text, whole: text.slice(0, point), fraction: text.slice(point)};
};
let tick = 0;
let seq = 0;
const change = (kind, id, fields) => ({kind, id, op: 'put', clock: `${1000000000000 + tick++}-0000`, device: 'A', fields});

const SETUP = [
    change('category', 'groceries', {name: 'groceries', color: '#111111'}),
    change('category', 'transport', {name: 'transport', color: '#222222'}),
    change('category', 'salary', {name: 'salary', color: '#333333'}),
    change('category', 'old', {name: 'old', color: '#444444', archived: true}),
    change('account', 'cash', {name: 'Cash', kind: 'own'}),
    change('setting', 'project', {thresholds: ['5.00', '20.00']}),
];

/** A transaction record; amount is minor units (cents). */
function txn(time, amount, category = '', extra = {}) {
    return change('txn', extra.id ?? `t${seq++}`, {
        time,
        amount: formatMoney(amount, 2),
        account: 'cash',
        category,
        merchant: '',
        note: '',
        tags: [],
        intent: '',
        ...extra,
    });
}

function transfer(time, amount, from, to, extra = {}) {
    return change('transfer', extra.id ?? `x${seq++}`, {time, amount: formatMoney(amount, 2), from, to, note: '', ...extra});
}

function bookOf(...changes) {
    const winners = {};
    for (const c of [...SETUP, ...changes]) {
        applyChange(winners, c);
    }
    const book = buildBook(winners, {name: 'Home', currency: 'USD', decimals: 2});
    assert.deepEqual(book.problems, []);
    return book;
}

const chart = (type, changes, scope = {}) => run({title: 't', type}, bookOf(...changes), makeScope(scope));

test('monthly_totals', async (t) => {
    const cases = [
        ['no transactions', [], []],
        [
            'income and expenses in one month',
            [
                txn('2026-11-01T10:00:00Z', -1000n, 'groceries'),
                txn('2026-11-30T10:00:00Z', -250n, 'groceries'),
                txn('2026-11-15T10:00:00Z', 500000n, 'salary'),
            ],
            [{month: '2026-11', income: a(500000n, '$5,000.00'), expenses: a(1250n, '$12.50'), net: a(498750n, '$4,987.50')}],
        ],
        [
            'net can be negative',
            [txn('2026-11-01T10:00:00Z', -1000n)],
            [{month: '2026-11', income: a(0n, '$0.00'), expenses: a(1000n, '$10.00'), net: a(-1000n, '−$10.00')}],
        ],
        [
            "month boundary uses the row's own offset",
            [txn('2026-10-31T23:30:00-05:00', -100n), txn('2026-11-01T00:30:00+05:30', -200n)],
            [
                {month: '2026-10', income: a(0n, '$0.00'), expenses: a(100n, '$1.00'), net: a(-100n, '−$1.00')},
                {month: '2026-11', income: a(0n, '$0.00'), expenses: a(200n, '$2.00'), net: a(-200n, '−$2.00')},
            ],
        ],
        [
            'gaps are filled and years roll over',
            [txn('2026-12-15T10:00:00Z', -100n), txn('2027-02-15T10:00:00Z', -300n)],
            [
                {month: '2026-12', income: a(0n, '$0.00'), expenses: a(100n, '$1.00'), net: a(-100n, '−$1.00')},
                {month: '2027-01', income: a(0n, '$0.00'), expenses: a(0n, '$0.00'), net: a(0n, '$0.00')},
                {month: '2027-02', income: a(0n, '$0.00'), expenses: a(300n, '$3.00'), net: a(-300n, '−$3.00')},
            ],
        ],
        [
            'date-only rows count',
            [txn('2026-11-05', -700n)],
            [{month: '2026-11', income: a(0n, '$0.00'), expenses: a(700n, '$7.00'), net: a(-700n, '−$7.00')}],
        ],
        [
            'refunds lower expenses and are not income',
            [txn('2026-11-05', -700n, 'groceries'), txn('2026-11-06', 200n, 'groceries', {refund: true})],
            [{month: '2026-11', income: a(0n, '$0.00'), expenses: a(500n, '$5.00'), net: a(-500n, '−$5.00')}],
        ],
    ];
    for (const [name, changes, want] of cases) {
        await t.test(name, () => assert.deepEqual(chart('monthly_totals', changes).months, want));
    }
});

test('monthly_totals follow the month start day', () => {
    const months = chart('monthly_totals', [
        change('setting', 'project', {monthStart: 25}),
        txn('2026-11-24', -100n),
        txn('2026-11-25', -200n),
    ]).months;
    assert.deepEqual(
        months.map((m) => [m.month, m.expenses.text]),
        [
            ['2026-10', '$1.00'],
            ['2026-11', '$2.00'],
        ],
    );
});

test('by_category', () => {
    const categories = chart('by_category', [
        txn('2026-11-01T10:00:00Z', -500n, 'groceries'),
        txn('2026-11-02T10:00:00Z', -700n, 'groceries'),
        txn('2026-11-03T10:00:00Z', -1200n, 'transport'),
        txn('2026-11-04T10:00:00Z', -100n, 'gifts'),
        txn('2026-11-05T10:00:00Z', -200n, ''),
        txn('2026-11-06T10:00:00Z', 500000n, 'salary'),
        txn('2026-11-07T10:00:00Z', -50n, 'old'),
        txn('2026-11-08T10:00:00Z', -800n, 'transport'),
        txn('2026-11-09T10:00:00Z', 800n, 'transport', {refund: true}),
    ]).categories;
    const none = a(0n, '$0.00');
    assert.deepEqual(categories, [
        {category: 'groceries', name: 'groceries', color: '#111111', spent: a(1200n, '$12.00'), previous: none, change: '', barSize: 10000},
        {category: 'transport', name: 'transport', color: '#222222', spent: a(1200n, '$12.00'), previous: none, change: '', barSize: 10000},
        {category: '', name: 'Uncategorized', color: '', spent: a(300n, '$3.00'), previous: none, change: '', barSize: 2500},
        {category: 'old', name: 'old', color: '#444444', spent: a(50n, '$0.50'), previous: none, change: '', barSize: 417},
    ]);
    assert.deepEqual(chart('by_category', [txn('2026-11-06T10:00:00Z', 100n, 'salary')]).categories, []);
});

test('splits count only your share as spending, per category', () => {
    const dinner = txn('2026-11-07', -60000n, '', {
        splits: [
            {category: 'groceries', person: '', amount: '200.00'},
            {category: '', person: 'rahul', amount: '400.00'},
        ],
    });
    const b = bookOf(change('account', 'rahul', {name: 'Rahul', kind: 'person'}), dinner);
    const scope = makeScope({today: '2026-11-07'});
    assert.deepEqual(
        run({type: 'by_category'}, b, scope).categories.map((c) => [c.name, c.spent.text]),
        [['groceries', '$200.00']],
    );
    assert.equal(summarize(b.txns, b.project, scope).cards[0].value.text, '$200.00');
    assert.deepEqual(
        run({type: 'running_balance'}, b, scope).balance.map((p) => p.balance.text),
        ['−$600.00'],
        'the whole payment left your account',
    );
    assert.deepEqual(
        accountBalances(b.txns, b.transfers, b.project).map((x) => [x.name, x.kind, x.balance.text]),
        [
            ['Cash', 'own', '−$600.00'],
            ['Rahul', 'person', '$400.00'],
        ],
    );
});

test('something a friend paid for you is your spending, and you owe them', () => {
    const b = bookOf(
        change('account', 'rahul', {name: 'Rahul', kind: 'person'}),
        txn('2026-11-07', -30000n, 'transport', {account: 'rahul'}),
        transfer('2026-11-08', 30000n, 'cash', 'rahul'),
    );
    const scope = makeScope({today: '2026-11-08'});
    assert.equal(summarize(b.txns, b.project, scope).cards[0].value.text, '$300.00');
    assert.deepEqual(
        accountBalances(b.txns, b.transfers, b.project).map((x) => [x.name, x.balance.text]),
        [
            ['Cash', '−$300.00'],
            ['Rahul', '$0.00'],
        ],
    );
    assert.deepEqual(
        run({type: 'running_balance'}, b, scope).balance.map((p) => p.balance.text),
        ['−$300.00'],
        'only own accounts count; the repayment left cash',
    );
});

test('spending_calendar shades each day by what was spent', () => {
    const c = chart(
        'spending_calendar',
        [
            txn('2026-11-07T23:30:00-05:00', -500n),
            txn('2026-11-07T01:00:00-05:00', -250n),
            txn('2026-11-09T09:00:00+09:00', -1000n),
            txn('2026-11-10T09:00:00Z', -1n),
            txn('2026-11-08T00:00:00Z', 9999n),
            txn('2026-11-11T09:00:00Z', 300n, '', {refund: true}),
        ],
        {from: '2026-11-01', to: '2026-11-30', today: '2026-11-11'},
    );
    const day = (date) => c.months[0].days.find((d) => d.date === date);
    assert.deepEqual(day('2026-11-07'), {date: '2026-11-07', status: 'spent', spent: a(750n, '$7.50'), level: 3});
    assert.deepEqual(day('2026-11-09'), {date: '2026-11-09', status: 'spent', spent: a(1000n, '$10.00'), level: 4});
    assert.deepEqual([day('2026-11-10').level, day('2026-11-10').spent.text], [1, '$0.01'], 'any spending is at least level 1');
    assert.deepEqual([day('2026-11-08').status, day('2026-11-08').level], ['zero', 0], 'income is not spending');
    assert.deepEqual([day('2026-11-11').status, day('2026-11-11').level], ['zero', 0], 'a refund is not spending');
    assert.deepEqual([day('2026-11-12').status, day('2026-11-12').spent.text], ['future', '$0.00']);
    assert.equal(c.max.text, '$10.00');
});

test('spending_calendar levels follow the biggest day in the range', async (t) => {
    const cases = [
        ['a quarter of the biggest day', -250n, 1],
        ['just over a quarter', -251n, 2],
        ['half', -500n, 2],
        ['three quarters', -750n, 3],
        ['just under the biggest', -999n, 4],
    ];
    for (const [name, amount, level] of cases) {
        await t.test(name, () => {
            const c = chart('spending_calendar', [txn('2026-11-02T10:00:00Z', -1000n), txn('2026-11-03T10:00:00Z', amount)], {
                from: '2026-11-01',
                today: '2026-11-05',
            });
            assert.equal(c.months[0].days[2].level, level);
        });
    }
});

test('unknown types report an error and every chart handles no data', () => {
    assert.ok(chart('pie', []).error);
    for (const def of CHARTS) {
        assert.equal(run(def, bookOf(), makeScope({today: '2026-11-08'})).error, undefined, def.type);
    }
});

test('scope filter and validate', async (t) => {
    const b = bookOf(
        txn('2026-10-31T23:59:59-05:00', 100n),
        txn('2026-11-01T00:00:00+05:30', 200n),
        txn('2026-11-30T23:59:59Z', 300n),
        txn('2026-12-01T00:00:00Z', 400n),
    );
    const cases = [
        ['open range', '', '', [100n, 200n, 300n, 400n]],
        ['from only', '2026-11-01', '', [200n, 300n, 400n]],
        ['to only', '', '2026-10-31', [100n]],
        ['inclusive both ends', '2026-11-01', '2026-11-30', [200n, 300n]],
        ['single day', '2026-12-01', '2026-12-01', [400n]],
        ['empty result', '2027-01-01', '', []],
    ];
    for (const [name, from, to, want] of cases) {
        await t.test(name, () => {
            const scope = makeScope({from, to});
            validateScope(scope);
            assert.deepEqual(
                filterRange(scope, b.txns)
                    .map((x) => x.amount)
                    .sort((p, q) => (p < q ? -1 : 1)),
                want,
            );
        });
    }
    for (const bad of [{from: '11/01/2026'}, {to: 'tomorrow'}, {from: '2026-12-01', to: '2026-11-01'}]) {
        assert.throws(() => validateScope(makeScope(bad)));
    }
});

test('running_balance', async (t) => {
    const changes = [
        txn('2026-11-01T10:00:00Z', 10000n),
        txn('2026-11-02T10:00:00Z', -2500n),
        txn('2026-11-02T20:00:00Z', -500n),
        txn('2026-11-05T10:00:00Z', 1000n),
    ];
    const cases = [
        ['open range ends today', {today: '2026-11-06'}, ['$100.00', '$70.00', '$70.00', '$70.00', '$80.00', '$80.00']],
        ['range starts from the balance before it', {from: '2026-11-02', to: '2026-11-03'}, ['$70.00', '$70.00']],
        ['range after all data keeps the balance', {from: '2026-11-10', to: '2026-11-11', today: '2026-11-12'}, ['$80.00', '$80.00']],
        ['future end is held back', {from: '2026-11-05', to: '2999-01-01', today: '2026-11-06'}, ['$80.00', '$80.00']],
    ];
    for (const [name, scope, want] of cases) {
        await t.test(name, () =>
            assert.deepEqual(
                chart('running_balance', changes, scope).balance.map((p) => p.balance.text),
                want,
            ),
        );
    }
});

test('running_balance starts from the opening balances of the accounts in view; transfers move only those', () => {
    const changes = [
        change('account', 'bank', {name: 'Bank', kind: 'own', opening: '1000.00'}),
        change('account', 'card', {name: 'Card', kind: 'own', opening: '-200.00', archived: true}),
        txn('2026-11-01T10:00:00Z', 10000n, '', {account: 'bank'}),
        txn('2026-11-02T10:00:00Z', -3000n, '', {account: 'card'}),
        transfer('2026-11-03', 5000n, 'bank', 'cash'),
    ];
    const balance = (scope) => chart('running_balance', changes, scope).balance.map((p) => p.balance.text);
    assert.deepEqual(balance({today: '2026-11-03'}), ['$900.00', '$870.00', '$870.00']);
    assert.deepEqual(balance({today: '2026-11-03', account: 'bank'}), ['$1,100.00', '$1,100.00', '$1,050.00']);
    assert.deepEqual(balance({from: '2026-11-02', to: '2026-11-02', account: 'card'}), ['−$230.00']);
    assert.deepEqual(balance({today: '2026-11-03', account: 'cash'}), ['$50.00'], 'the first move into view opens the range');
});

test('transfers never count as income or spending', () => {
    const b = bookOf(txn('2026-11-01', -1000n, 'groceries'), transfer('2026-11-02', 5000n, 'bank', 'cash'));
    const cards = summarize(b.txns, b.project, makeScope({today: '2026-11-03'})).cards;
    assert.deepEqual(
        cards.slice(0, 2).map((c) => c.value.text),
        ['$10.00', '$0.00'],
    );
});

test('the account filter narrows every chart', () => {
    const b = bookOf(txn('2026-11-02T09:00:00Z', -100n, '', {account: 'cash'}), txn('2026-11-02T10:00:00Z', -300n, '', {account: 'card'}));
    for (const [account, want] of [
        ['', '$4.00'],
        ['card', '$3.00'],
        ['nowhere', null],
    ]) {
        assert.equal(run({type: 'monthly_totals'}, b, makeScope({account})).months[0]?.expenses.text ?? null, want, account);
    }
});

test('intent_trends', () => {
    const c = chart('intent_trends', [
        txn('2026-09-05T10:00:00Z', -1000n, '', {intent: 'need'}),
        txn('2026-09-06T10:00:00Z', -500n, '', {intent: 'need'}),
        txn('2026-11-05T10:00:00Z', -300n, '', {intent: 'impulse'}),
        txn('2026-11-06T10:00:00Z', -200n, '', {intent: 'want'}),
        txn('2026-11-07T10:00:00Z', -999n),
        txn('2026-11-08T10:00:00Z', 5000n),
    ]);
    assert.deepEqual(c.intentMonths, [
        {month: '2026-09', need: a(1500n, '$15.00'), want: a(0n, '$0.00'), impulse: a(0n, '$0.00')},
        {month: '2026-10', need: a(0n, '$0.00'), want: a(0n, '$0.00'), impulse: a(0n, '$0.00')},
        {month: '2026-11', need: a(0n, '$0.00'), want: a(200n, '$2.00'), impulse: a(300n, '$3.00')},
    ]);
    assert.equal(c.noIntent, 1);
    assert.deepEqual(c.mix, [
        {intent: 'need', total: a(1500n, '$15.00'), share: '75.00%', shareSize: 7500},
        {intent: 'want', total: a(200n, '$2.00'), share: '10.00%', shareSize: 1000},
        {intent: 'impulse', total: a(300n, '$3.00'), share: '15.00%', shareSize: 1500},
    ]);
    assert.deepEqual(
        chart('intent_trends', []).mix.map((m) => m.share),
        ['0.00%', '0.00%', '0.00%'],
        'no intents, no shares',
    );
});

test('intent_trends and the ledger follow the intent of each split part', () => {
    const order = txn('2026-11-05T10:00:00Z', -81400n, '', {
        id: 'order',
        intent: 'want',
        splits: [
            {category: 'groceries', person: '', amount: '99.00', intent: 'need'},
            {category: 'transport', person: '', amount: '720.00'},
            {category: '', person: '', amount: '35.00'},
            {category: 'transport', person: '', amount: '-40.00'},
        ],
    });
    const c = chart('intent_trends', [order]);
    assert.deepEqual(c.intentMonths, [{month: '2026-11', need: a(9900n, '$99.00'), want: a(71500n, '$715.00'), impulse: a(0n, '$0.00')}]);
    assert.equal(c.noIntent, 0);
    assert.deepEqual(
        chart('by_category', [order]).categories.map((x) => [x.name, x.spent.text]),
        [
            ['transport', '$680.00'],
            ['groceries', '$99.00'],
            ['Uncategorized', '$35.00'],
        ],
        'the discount comes off its own category',
    );

    const b = bookOf(order);
    const all = ledgerView(b.txns, b.transfers, b.project);
    assert.deepEqual([all.spent.text, all.days[0].rows[0].intents], ['$814.00', ['need', 'want']]);
    const needs = ledgerView(b.txns, b.transfers, b.project, {filter: 'need'});
    assert.deepEqual([needs.count, needs.spent.text], [1, '$99.00']);
    assert.equal(ledgerView(b.txns, b.transfers, b.project, {filter: 'impulse'}).count, 0);

    const untagged = chart('intent_trends', [
        txn('2026-11-05T10:00:00Z', -2000n, '', {
            splits: [
                {category: 'groceries', person: '', amount: '10.00', intent: 'need'},
                {category: 'groceries', person: '', amount: '10.00'},
            ],
        }),
    ]);
    assert.deepEqual([untagged.intentMonths[0].need.text, untagged.noIntent], ['$10.00', 1]);
});

test('small_purchases', () => {
    const c = chart('small_purchases', [
        txn('2026-11-01T10:00:00Z', -100n),
        txn('2026-11-02T10:00:00Z', -500n),
        txn('2026-11-03T10:00:00Z', -501n),
        txn('2026-11-04T10:00:00Z', -2000n),
        txn('2026-11-05T10:00:00Z', -7899n),
        txn('2026-11-06T10:00:00Z', 100000n),
        txn('2026-11-06T11:00:00Z', 100n, '', {refund: true}),
    ]);
    assert.deepEqual([c.expenseCount, c.expenseTotal.text], [5, '$110.00']);
    assert.deepEqual(c.small, [
        {threshold: a(500n, '$5.00'), count: 2, total: a(600n, '$6.00'), share: '5.45%', shareBp: 545n, shareSize: 545},
        {threshold: a(2000n, '$20.00'), count: 4, total: a(3101n, '$31.01'), share: '28.19%', shareBp: 2819n, shareSize: 2819},
    ]);
});

test('hour_routine', () => {
    // 2026-11-02 is a Monday; 2026-11-07 is a Saturday.
    const c = chart(
        'hour_routine',
        [
            txn('2026-11-02T09:15:00+05:30', -1000n, 'groceries', {merchant: 'Cafe'}),
            txn('2026-11-02T09:45:00+05:30', -3000n, 'transport', {merchant: 'Cafe'}),
            txn('2026-11-03T09:05:00+05:30', -500n, 'groceries', {merchant: 'Cafe'}),
            txn('2026-11-03T09:30:00+05:30', -200n, '', {merchant: 'Kiosk'}),
            txn('2026-11-03T23:50:00-05:00', -100n, 'groceries'),
            txn('2026-11-07T09:10:00+05:30', -9999n, 'groceries', {merchant: 'Cafe'}),
            txn('2026-11-04T09:10:00+05:30', 7777n, 'salary', {merchant: 'Boss'}),
            txn('2026-11-04', -400n, 'groceries'),
        ],
        {from: '2026-11-02', to: '2026-11-08', today: '2026-11-08'},
    );

    assert.deepEqual([c.days, c.hours.length], [7, 24]);
    const nine = c.hours[9];
    assert.deepEqual(
        [nine.occurrences, nine.total.text, nine.average.text, nine.share],
        [5, '$146.99', '$29.40', '42.86%'],
        'weekends count like any other day',
    );
    assert.deepEqual(
        nine.categories.map((x) => x.name),
        ['groceries', 'transport', 'Uncategorized'],
    );
    assert.deepEqual(nine.merchants, [
        {name: 'Cafe', count: 4, average: a(3625n, '$36.25')},
        {name: 'Kiosk', count: 1, average: a(200n, '$2.00')},
    ]);
    assert.deepEqual([c.hours[23].occurrences, c.hours[23].total.text], [1, '$1.00']);
    assert.deepEqual([c.hours[0].occurrences, c.hours[0].total.text, c.hours[0].average.text], [0, '$0.00', '$0.00']);
    assert.deepEqual(
        c.noTime.map((r) => [r.date, r.amount.text]),
        [['2026-11-04', '−$4.00']],
    );
});

test('hour_routine falls back to the note', () => {
    const c = chart('hour_routine', [txn('2026-11-07T10:00:00Z', -100n, '', {note: 'Weekend brunch'})], {
        from: '2026-11-02',
        to: '2026-11-08',
        today: '2026-11-08',
    });
    assert.deepEqual([c.hours[10].occurrences, c.hours[10].merchants[0].name], [1, 'Weekend brunch']);
});

test('the day count of hour_routine stops at today', () => {
    assert.equal(
        chart('hour_routine', [txn('2026-11-02T10:00:00Z', -100n)], {from: '2026-11-01', to: '2026-11-30', today: '2026-11-04'}).days,
        4,
    );
});

test('spending_calendar marks zero-expense days', () => {
    const c = chart(
        'spending_calendar',
        [
            txn('2026-10-30T10:00:00Z', -100n),
            txn('2026-11-02T10:00:00Z', -100n),
            txn('2026-11-03T10:00:00Z', 5000n),
            txn('2026-11-07T10:00:00Z', -100n),
        ],
        {from: '2026-11-01', today: '2026-11-09'},
    );
    const november = c.months[0];
    const status = Object.fromEntries(november.days.map((d) => [d.date, d.status]));
    const checks = {
        '2026-11-01': 'zero',
        '2026-11-02': 'spent',
        '2026-11-03': 'zero',
        '2026-11-04': 'zero',
        '2026-11-07': 'spent',
        '2026-11-08': 'zero',
        '2026-11-09': 'zero',
        '2026-11-10': 'future',
        '2026-11-30': 'future',
    };
    for (const [date, want] of Object.entries(checks)) {
        assert.equal(status[date], want, date);
    }
    assert.deepEqual([c.months.length, november.days.length, november.zeroDays, november.bestStreak, c.currentStreak], [1, 30, 7, 4, 2]);
    assert.equal(november.lead, 6, 'November 2026 starts on a Sunday');
});

test('spending_calendar edges', async (t) => {
    await t.test('days before the first transaction are not zero-expense days', () => {
        const c = chart('spending_calendar', [txn('2026-11-05T10:00:00Z', -100n)], {today: '2026-11-06'});
        assert.deepEqual([c.months[0].days[0].status, c.months[0].zeroDays], ['outside', 1]);
    });
    await t.test('spending today ends the streak', () => {
        assert.equal(
            chart('spending_calendar', [txn('2026-11-01T10:00:00Z', 100n), txn('2026-11-06T10:00:00Z', -100n)], {today: '2026-11-06'})
                .currentStreak,
            0,
        );
    });
    await t.test('range spanning three months', () => {
        const c = chart('spending_calendar', [txn('2026-10-20T10:00:00Z', -100n)], {
            from: '2026-10-25',
            to: '2026-12-05',
            today: '2026-12-31',
        });
        assert.deepEqual(
            c.months.map((m) => [m.month, m.lead]),
            [
                ['2026-10', 3],
                ['2026-11', 6],
                ['2026-12', 1],
            ],
        );
        assert.deepEqual([c.months[0].days[23].status, c.months[0].zeroDays], ['outside', 7]);
    });
});

test('by_category compares with the previous period, and top_merchants', () => {
    const changes = [
        txn('2026-10-10', -1000n, 'groceries', {merchant: 'Market'}),
        txn('2026-10-12', -500n, 'transport'),
        txn('2026-11-10', -1500n, 'groceries', {merchant: 'Market'}),
        txn('2026-11-11', -300n, 'groceries', {merchant: 'Bakery'}),
        txn('2026-11-12', -200n, '', {note: 'parking'}),
    ];
    const c = chart('by_category', changes, {from: '2026-11-01', to: '2026-11-30', today: '2026-11-30'});
    assert.deepEqual([c.previousFrom, c.previousTo], ['2026-10-02', '2026-10-31']);
    assert.deepEqual(
        c.categories.map((r) => [r.name, r.spent.text, r.previous.text, r.change, r.barSize]),
        [
            ['groceries', '$18.00', '$10.00', '+80.00%', 10000],
            ['Uncategorized', '$2.00', '$0.00', 'New', 1111],
            ['transport', '$0.00', '$5.00', '−100.00%', 0],
        ],
        'a category spent on only before still shows, with no bar',
    );
    const allTime = chart('by_category', changes, {today: '2026-11-30'});
    assert.deepEqual([allTime.categories[0].change, allTime.previousFrom], ['', ''], 'no comparison for all time');
    const top = chart('top_merchants', changes, {from: '2026-11-01'}).merchants;
    assert.deepEqual(
        top.map((m) => [m.name, m.count, m.spent.text]),
        [
            ['Market', 1, '$15.00'],
            ['Bakery', 1, '$3.00'],
            ['parking', 1, '$2.00'],
        ],
    );
});

test('summarize', () => {
    const b = bookOf(
        txn('2026-10-24T10:00:00Z', -1000n),
        txn('2026-10-25T10:00:00Z', 2000n),
        txn('2026-11-02T10:00:00Z', -1500n),
        txn('2026-11-05T10:00:00Z', -500n),
        txn('2026-11-06T10:00:00Z', 4000n),
    );
    const cards = Object.fromEntries(
        summarize(b.txns, b.project, makeScope({from: '2026-11-01', today: '2026-11-08'})).cards.map((c) => [c.key, c]),
    );
    assert.deepEqual([cards.spent.value.text, cards.spent.change], ['$20.00', '+100.00% vs previous period']);
    assert.deepEqual([cards.income.value.text, cards.income.change], ['$40.00', '+100.00% vs previous period']);
    assert.deepEqual([cards.savings.value.text, cards.savings.change], ['$20.00', '+100.00% vs previous period']);
    assert.deepEqual([cards.average.value.text, cards.average.detail], ['$2.50', 'over 2 expense transactions']);
});

test('average daily spend counts the days of the period up to today', async (t) => {
    const b = bookOf(txn('2026-11-18T10:00:00Z', -1800n));
    const cases = [
        ['this month so far: 1st to the 18th', {from: '2026-11-01', to: '2026-11-18', today: '2026-11-18'}, '$1.00'],
        ['future days of the period are left out', {from: '2026-11-01', to: '2026-11-30', today: '2026-11-18'}, '$1.00'],
        ['a past period counts every day', {from: '2026-11-01', to: '2026-11-30', today: '2026-12-05'}, '$0.60'],
        ['all time starts at the first entry', {today: '2026-11-20'}, '$6.00'],
    ];
    for (const [name, scope, expected] of cases) {
        await t.test(name, () => {
            const average = summarize(b.txns, b.project, makeScope(scope)).cards.find((c) => c.key === 'average');
            assert.equal(average?.value.text, expected);
        });
    }
});

test('summarize comparisons', async (t) => {
    const spent = (changes, scope) => {
        const b = bookOf(...changes);
        return summarize(b.txns, b.project, makeScope(scope)).cards[0];
    };
    const base = [txn('2026-11-02T10:00:00Z', -1000n), txn('2026-11-03T10:00:00Z', 100n)];
    const cases = [
        ['all time has no previous', base, {today: '2026-11-08'}, '$10.00', 'No previous data'],
        ['previous period empty', base, {from: '2026-11-01', today: '2026-11-08'}, '$10.00', 'No previous data'],
        ['empty range with data before', base, {from: '2026-11-10', to: '2026-11-12', today: '2026-11-15'}, '$0.00', 'No previous data'],
        [
            'previous period had income only',
            [txn('2026-10-30T10:00:00Z', 500n), txn('2026-11-02T10:00:00Z', -1000n)],
            {from: '2026-11-01', to: '2026-11-02', today: '2026-11-08'},
            '$10.00',
            'Up from zero',
        ],
        [
            'spending went down',
            [txn('2026-10-31T10:00:00Z', -2000n), txn('2026-11-01T10:00:00Z', -500n)],
            {from: '2026-11-01', to: '2026-11-01', today: '2026-11-08'},
            '$5.00',
            '−75.00% vs previous period',
        ],
    ];
    for (const [name, changes, scope, value, changeText] of cases) {
        await t.test(name, () => {
            const card = spent(changes, scope);
            assert.deepEqual([card.value.text, card.change], [value, changeText]);
        });
    }
});

test('summarize trends: more spending is worse, more income or savings is better', async (t) => {
    const scope = makeScope({from: '2026-11-01', to: '2026-11-01', today: '2026-11-08'});
    const trends = (...changes) => {
        const b = bookOf(...changes);
        return Object.fromEntries(summarize(b.txns, b.project, scope).cards.map((c) => [c.key, [c.direction, c.trend]]));
    };
    const cases = [
        [
            'spending and income both went up',
            [
                txn('2026-10-31T10:00:00Z', -100n),
                txn('2026-10-31T11:00:00Z', 100n),
                txn('2026-11-01T10:00:00Z', -500n),
                txn('2026-11-01T11:00:00Z', 900n),
            ],
            {spent: ['up', 'worse'], income: ['up', 'better'], savings: ['up', 'better'], average: ['up', 'worse']},
        ],
        [
            'spending went down, income gone',
            [txn('2026-10-31T10:00:00Z', -500n), txn('2026-10-31T11:00:00Z', 900n), txn('2026-11-01T10:00:00Z', -100n)],
            {spent: ['down', 'better'], income: ['down', 'worse'], savings: ['down', 'worse'], average: ['down', 'better']},
        ],
        [
            'nothing changed',
            [txn('2026-10-31T10:00:00Z', -100n), txn('2026-11-01T10:00:00Z', -100n)],
            {spent: ['', ''], income: ['', ''], savings: ['', ''], average: ['', '']},
        ],
        [
            'no previous data',
            [txn('2026-11-01T10:00:00Z', -100n)],
            {spent: ['', ''], income: ['', ''], savings: ['', ''], average: ['', '']},
        ],
    ];
    for (const [name, changes, want] of cases) {
        await t.test(name, () => assert.deepEqual(trends(...changes), want));
    }
});

test('ledgerView', async (t) => {
    const b = bookOf(
        change('account', 'card', {name: 'Card', kind: 'own'}),
        txn('2026-11-07T09:30:00+05:30', -450n, 'groceries', {
            id: 'coffee',
            merchant: 'Cafe Mocha',
            tags: ['morning', 'treat'],
            intent: 'want',
        }),
        txn('2026-11-07T13:00:00+05:30', -1200n, '', {id: 'lunch', note: 'team lunch', account: 'card'}),
        txn('2026-11-07', 100000n, 'salary', {id: 'pay'}),
        txn('2026-10-30T10:00:00Z', -300n, 'old', {id: 'older'}),
        txn('2026-10-31', 200n, 'groceries', {id: 'refund', refund: true}),
    );
    const data = ledgerView(b.txns, b.transfers, b.project);
    assert.deepEqual(
        [data.count, data.days.length, data.months, data.spent.text, data.income.text, data.net.text],
        [5, 3, ['2026-11', '2026-10'], '$17.50', '$1,000.00', '+$982.50'],
    );
    const day = data.days[0];
    assert.deepEqual([day.date, day.total.text], ['2026-11-07', '+$983.50']);
    assert.equal(day.rows[2].amount.text, '+$1,000.00', 'money in carries a plus');
    assert.deepEqual(
        day.rows.map((r) => r.time),
        ['13:00', '09:30', ''],
        'newest first, unknown times last',
    );
    const coffee = day.rows[1];
    assert.deepEqual(
        [coffee.category, coffee.categoryColors, coffee.intents, coffee.amount.text, coffee.account],
        ['groceries', ['#111111'], ['want'], '−$4.50', 'Cash'],
    );
    assert.equal(day.rows[0].category, 'Uncategorized');
    assert.deepEqual([data.days[1].rows[0].refund, data.days[1].total.text], [true, '+$2.00']);

    const filters = [
        ['search merchant', {search: 'mocha'}, 1],
        ['search note', {search: '  TEAM '}, 1],
        ['search category', {search: 'salary'}, 1],
        ['search tag', {search: 'morning'}, 1],
        ['search account', {search: 'card'}, 1],
        ['month', {month: '2026-10'}, 2],
        ['date range', {from: '2026-10-31', to: '2026-11-07'}, 4],
        ['category', {category: 'groceries'}, 2],
        ['uncategorized', {category: UNCATEGORIZED}, 1],
        ['account', {account: 'card'}, 1],
        ['expenses', {filter: 'expense'}, 3],
        ['income', {filter: 'income'}, 1],
        ['refunds', {filter: 'refund'}, 1],
        ['wants', {filter: 'want'}, 1],
        ['transfers', {filter: 'transfer'}, 0],
        ['combined', {filter: 'expense', month: '2026-11', search: 'cafe'}, 1],
    ];
    for (const [name, query, want] of filters) {
        await t.test(name, () => assert.equal(ledgerView(b.txns, b.transfers, b.project, query).count, want));
    }
    await t.test('totals follow the filter', () => {
        const groceries = ledgerView(b.txns, b.transfers, b.project, {category: 'groceries'});
        assert.deepEqual([groceries.spent.text, groceries.income.text, groceries.net.text], ['$2.50', '$0.00', '−$2.50']);
    });
});

test('ledgerView shows transfers and shares; transfers count in day totals only for one account', () => {
    const b = bookOf(
        change('account', 'bank', {name: 'Bank', kind: 'own'}),
        change('account', 'rahul', {name: 'Rahul', kind: 'person'}),
        txn('2026-11-07T09:00:00Z', -100n, '', {account: 'cash'}),
        transfer('2026-11-07T08:00:00Z', 5000n, 'bank', 'cash', {note: 'ATM'}),
        txn('2026-11-06', -60000n, '', {
            account: 'bank',
            merchant: 'Dinner',
            splits: [
                {category: 'groceries', person: '', amount: '200.00'},
                {category: '', person: 'rahul', amount: '400.00'},
            ],
        }),
        txn('2026-11-05', -30000n, 'transport', {account: 'rahul', merchant: 'Movie'}),
    );
    const all = ledgerView(b.txns, b.transfers, b.project);
    assert.equal(all.days[0].total.text, '−$1.00');
    const atm = all.days[0].rows[1];
    assert.deepEqual([atm.kind, atm.account, atm.amount.text, atm.signed], ['transfer', 'Bank → Cash', '$50.00', false]);
    const dinner = all.days[1].rows[0];
    assert.deepEqual(
        [dinner.category, dinner.split, dinner.people, all.days[1].total.text],
        ['groceries', true, ['Rahul owes $400.00'], '−$200.00'],
    );
    assert.equal(all.days[2].rows[0].account, 'Paid by Rahul');

    const cash = ledgerView(b.txns, b.transfers, b.project, {account: 'cash'});
    assert.deepEqual([cash.count, cash.days[0].total.text, cash.days[0].rows[1].amount.text], [2, '+$49.00', '+$50.00']);
    assert.equal(ledgerView(b.txns, b.transfers, b.project, {account: 'rahul'}).count, 2);
    assert.equal(ledgerView(b.txns, b.transfers, b.project, {search: 'atm'}).count, 1);
    assert.equal(ledgerView(b.txns, b.transfers, b.project, {search: 'rahul'}).count, 2);
});

test("the ledger groups by the row's own date and limits days but counts everything", () => {
    const own = bookOf(txn('2026-11-07T23:30:00-05:00', -100n), txn('2026-11-08T00:30:00+05:30', -200n));
    assert.deepEqual(
        ledgerView(own.txns, [], own.project).days.map((d) => d.date),
        ['2026-11-08', '2026-11-07'],
    );

    const rows = [];
    for (let day = 1; day <= 10; day++) {
        const d = String(day).padStart(2, '0');
        rows.push(txn(`2026-11-${d}T10:00:00Z`, -100n), txn(`2026-11-${d}T12:00:00Z`, -200n));
    }
    const b = bookOf(...rows);
    const data = ledgerView(b.txns, [], b.project, {limit: 3});
    assert.deepEqual(
        [data.days.length, data.totalDays, data.count, data.days[0].date, data.days[0].rows.length],
        [3, 10, 20, '2026-11-10', 2],
    );
    assert.equal(ledgerView(b.txns, [], b.project, {limit: 0}).days.length, 10);
});

test("budgetStatus compares this month's spending with each budget", () => {
    const b = bookOf(
        change('budget', 'groceries', {amount: '100.00'}),
        change('budget', 'transport', {amount: '50.00'}),
        change('budget', 'gone', {amount: '50.00'}),
        change('budget', 'salary', {amount: '100.00'}),
        txn('2026-11-06', -8499n, 'salary'),
        txn('2026-11-02', -8000n, 'groceries'),
        txn('2026-11-03', -1000n, 'groceries', {account: 'card'}),
        txn('2026-11-04', 500n, 'groceries', {refund: true}),
        txn('2026-10-30', -9000n, 'groceries'),
        txn('2026-11-05', -6000n, 'transport'),
    );
    const status = budgetStatus(b, '2026-11-15');
    assert.deepEqual([status.month, status.from, status.to, status.daysLeft], ['2026-11', '2026-11-01', '2026-11-30', 16]);
    assert.deepEqual(
        status.rows.map((r) => [r.name, r.spent.text, r.left.text, r.share, r.over, r.near, r.shareSize]),
        [
            ['transport', '$60.00', '−$10.00', '120.00%', true, false, 10000],
            ['groceries', '$85.00', '$15.00', '85.00%', false, true, 8500],
            ['salary', '$84.99', '$15.01', '84.99%', false, false, 8499],
        ],
    );
    assert.deepEqual([status.total.budget.text, status.total.spent.text], ['$250.00', '$229.99']);
});

test('presetRange', () => {
    const cases = [
        ['this_month', '2026-11-08', 1, {from: '2026-11-01', to: '2026-11-08'}],
        ['last_month', '2026-11-08', 1, {from: '2026-10-01', to: '2026-10-31'}],
        ['last_30_days', '2026-11-08', 1, {from: '2026-10-10', to: '2026-11-08'}],
        ['three_months', '2026-11-08', 1, {from: '2026-09-01', to: '2026-11-08'}],
        ['three_months', '2026-02-10', 1, {from: '2025-12-01', to: '2026-02-10'}],
        ['year_to_date', '2026-11-08', 1, {from: '2026-01-01', to: '2026-11-08'}],
        ['all_time', '2026-11-08', 1, {from: '', to: ''}],
        ['this_month', '2026-11-08', 25, {from: '2026-10-25', to: '2026-11-08'}],
        ['last_month', '2026-11-26', 25, {from: '2026-10-25', to: '2026-11-24'}],
    ];
    for (const [name, today, start, want] of cases) {
        assert.deepEqual(presetRange(name, today, start), want, `${name} ${today} ${start}`);
    }
    assert.throws(() => presetRange('last_week', '2026-11-08'));
    assert.throws(() => presetRange('this_month', 'soon'));
});

test('runAll matches running each chart', () => {
    const b = bookOf(
        txn('2026-10-30T10:00:00Z', -100n, 'groceries'),
        txn('2026-11-02T09:15:00Z', -700n, 'transport'),
        txn('2026-11-04', -300n),
    );
    const scope = makeScope({from: '2026-11-01', today: '2026-11-08'});
    const defs = [...CHARTS, {title: 'f', type: 'pie'}];
    for (const [i, c] of runAll(defs, b, scope).entries()) {
        assert.deepEqual(c, run(defs[i], b, scope));
    }
    assert.equal(filterAccount(makeScope({account: 'cash'}), b.txns).length, 3);
});

test('amounts for the screen split into whole and minor units, signs included', () => {
    const inr = {currency: 'INR', decimals: 2};
    const jpy = {currency: 'JPY', decimals: 0};
    const cases = [
        ['negative', amountOf(-2430250n, inr), ['−₹24,302.50', '−₹24,302', '.50']],
        ['zero', amountOf(0n, inr), ['₹0.00', '₹0', '.00']],
        ['signed positive', signedAmountOf(100n, inr), ['+₹1.00', '+₹1', '.00']],
        ['signed negative', signedAmountOf(-100n, inr), ['−₹1.00', '−₹1', '.00']],
        ['no minor units', amountOf(-1500n, jpy), ['−¥1,500', '−¥1,500', '']],
    ];
    for (const [name, amount, want] of cases) {
        assert.deepEqual([amount.text, amount.whole, amount.fraction], want, name);
    }
});

test('moneyAxis spans the values in about three round steps, with a label for each tick', () => {
    const usd = {currency: 'USD', decimals: 2};
    const jpy = {currency: 'JPY', decimals: 0};
    const axis = (values, project = usd) => {
        const a = moneyAxis(values, project);
        return [a.min, a.max, a.interval, a.ticks.map((t) => t.text)];
    };
    const cases = [
        ['falling balance', [10000n, 7000n, 8000n], [7000, 10000, 1000, ['$70', '$80', '$90', '$100']]],
        [
            'a large balance moving a little',
            [16000000n, 15760900n],
            [15700000, 16000000, 100000, ['$157,000', '$158,000', '$159,000', '$160,000']],
        ],
        ['flat gets one step of height', [5000n, 5000n], [5000, 5100, 100, ['$50', '$51']]],
        ['below zero', [-23000n, -20000n], [-23000, -20000, 1000, ['−$230', '−$220', '−$210', '−$200']]],
        ['crossing zero', [-1500n, 4000n], [-2000, 4000, 2000, ['−$20', '$0', '$20', '$40']]],
        [
            'no minor units',
            [1500000n, 900000n],
            [800000, 1600000, 200000, ['¥800,000', '¥1,000,000', '¥1,200,000', '¥1,400,000', '¥1,600,000']],
        ],
        ['no values', [], [0, 0, 0, []]],
    ];
    for (const [name, values, want] of cases) {
        assert.deepEqual(axis(values, name === 'no minor units' ? jpy : usd), want, name);
    }
    assert.deepEqual(
        chart('running_balance', [txn('2026-11-01T10:00:00Z', 10000n)], {today: '2026-11-02'}).axis.ticks.map((t) => t.text),
        ['$100', '$101'],
        'the running balance chart carries its axis',
    );
});
