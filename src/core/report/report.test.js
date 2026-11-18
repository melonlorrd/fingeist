import assert from 'node:assert/strict';
import {test} from 'node:test';

import {formatMoney} from '../money.js';
import {buildBook} from '../records.js';
import {applyChange} from '../state.js';
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

const a = (minor, text) => ({minor, text, size: Number(minor), negative: minor < 0n});
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
            [{month: '2026-11', income: a(0n, '$0.00'), expenses: a(1000n, '$10.00'), net: a(-1000n, '-$10.00')}],
        ],
        [
            "month boundary uses the row's own offset",
            [txn('2026-10-31T23:30:00-05:00', -100n), txn('2026-11-01T00:30:00+05:30', -200n)],
            [
                {month: '2026-10', income: a(0n, '$0.00'), expenses: a(100n, '$1.00'), net: a(-100n, '-$1.00')},
                {month: '2026-11', income: a(0n, '$0.00'), expenses: a(200n, '$2.00'), net: a(-200n, '-$2.00')},
            ],
        ],
        [
            'gaps are filled and years roll over',
            [txn('2026-12-15T10:00:00Z', -100n), txn('2027-02-15T10:00:00Z', -300n)],
            [
                {month: '2026-12', income: a(0n, '$0.00'), expenses: a(100n, '$1.00'), net: a(-100n, '-$1.00')},
                {month: '2027-01', income: a(0n, '$0.00'), expenses: a(0n, '$0.00'), net: a(0n, '$0.00')},
                {month: '2027-02', income: a(0n, '$0.00'), expenses: a(300n, '$3.00'), net: a(-300n, '-$3.00')},
            ],
        ],
        [
            'date-only rows count',
            [txn('2026-11-05', -700n)],
            [{month: '2026-11', income: a(0n, '$0.00'), expenses: a(700n, '$7.00'), net: a(-700n, '-$7.00')}],
        ],
        [
            'refunds lower expenses and are not income',
            [txn('2026-11-05', -700n, 'groceries'), txn('2026-11-06', 200n, 'groceries', {refund: true})],
            [{month: '2026-11', income: a(0n, '$0.00'), expenses: a(500n, '$5.00'), net: a(-500n, '-$5.00')}],
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
    assert.deepEqual(categories, [
        {category: 'groceries', name: 'groceries', color: '#111111', spent: a(1200n, '$12.00')},
        {category: 'transport', name: 'transport', color: '#222222', spent: a(1200n, '$12.00')},
        {category: '', name: 'Uncategorized', color: '', spent: a(300n, '$3.00')},
        {category: 'old', name: 'old', color: '#444444', spent: a(50n, '$0.50')},
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
        ['-$600.00'],
        'the whole payment left your account',
    );
    assert.deepEqual(
        accountBalances(b.txns, b.transfers, b.project).map((x) => [x.name, x.kind, x.balance.text]),
        [
            ['Cash', 'own', '-$600.00'],
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
            ['Cash', '-$300.00'],
            ['Rahul', '$0.00'],
        ],
    );
    assert.deepEqual(
        run({type: 'running_balance'}, b, scope).balance.map((p) => p.balance.text),
        ['-$300.00'],
        'only own accounts count; the repayment left cash',
    );
});

test('calendar_heatmap', () => {
    const c = chart('calendar_heatmap', [
        txn('2026-11-07T23:30:00-05:00', -500n),
        txn('2026-11-07T01:00:00-05:00', -250n),
        txn('2026-11-09T09:00:00+09:00', -1000n),
        txn('2026-11-08T00:00:00Z', 9999n),
    ]);
    assert.deepEqual(c.days, [
        {date: '2026-11-07', spent: a(750n, '$7.50')},
        {date: '2026-11-09', spent: a(1000n, '$10.00')},
    ]);
    assert.deepEqual([c.from, c.to, c.max], ['2026-11-07', '2026-11-09', a(1000n, '$10.00')]);
    assert.equal(c.weeks, 2, 'Saturday to Monday spans two Monday-first weeks');
});

test('calendar_heatmap week columns', async (t) => {
    const cases = [
        ['no spending', [], 0],
        ['one day', ['2026-11-18'], 1],
        ['Monday to Sunday', ['2026-11-16', '2026-11-22'], 1],
        ['Sunday to Monday', ['2026-11-15', '2026-11-16'], 2],
        ['a whole year', ['2026-01-01', '2026-12-31'], 53],
    ];
    for (const [name, dates, weeks] of cases) {
        await t.test(name, () => {
            const c = chart(
                'calendar_heatmap',
                dates.map((d) => txn(`${d}T10:00:00Z`, -100n)),
            );
            assert.equal(c.weeks, weeks);
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
    assert.deepEqual(balance({from: '2026-11-02', to: '2026-11-02', account: 'card'}), ['-$230.00']);
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

test('workday_routine', () => {
    // 2026-11-02 is a Monday; 2026-11-07 is a Saturday.
    const c = chart(
        'workday_routine',
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

    assert.deepEqual([c.workdays, c.hours.length], [5, 24]);
    const nine = c.hours[9];
    assert.deepEqual([nine.occurrences, nine.total.text, nine.average.text, nine.share], [4, '$47.00', '$11.75', '40.00%']);
    assert.deepEqual(
        nine.categories.map((x) => x.name),
        ['transport', 'groceries', 'Uncategorized'],
    );
    assert.deepEqual(nine.merchants, [
        {name: 'Cafe', count: 3, average: a(1500n, '$15.00')},
        {name: 'Kiosk', count: 1, average: a(200n, '$2.00')},
    ]);
    assert.deepEqual([c.hours[23].occurrences, c.hours[23].total.text], [1, '$1.00']);
    assert.deepEqual([c.hours[0].occurrences, c.hours[0].total.text, c.hours[0].average.text], [0, '$0.00', '$0.00']);
    assert.deepEqual(
        c.noTime.map((r) => [r.date, r.amount.text]),
        [['2026-11-04', '-$4.00']],
    );
});

test('workday_routine falls back to the note and honours the workdays setting', () => {
    const c = chart(
        'workday_routine',
        [
            change('setting', 'project', {workdays: ['sat']}),
            txn('2026-11-07T10:00:00Z', -100n, '', {note: 'Weekend brunch'}),
            txn('2026-11-02T10:00:00Z', -100n, '', {note: 'Standup donuts'}),
        ],
        {from: '2026-11-02', to: '2026-11-08', today: '2026-11-08'},
    );
    assert.deepEqual([c.workdays, c.hours[10].occurrences, c.hours[10].merchants[0].name], [1, 1, 'Weekend brunch']);
});

test('the workday count stops at today', () => {
    assert.equal(
        chart('workday_routine', [txn('2026-11-02T10:00:00Z', -100n)], {from: '2026-11-01', to: '2026-11-30', today: '2026-11-04'})
            .workdays,
        3,
    );
});

test('weekday_hour_heatmap', () => {
    const c = chart('weekday_hour_heatmap', [
        txn('2026-11-02T09:15:00Z', -100n),
        txn('2026-11-09T09:45:00Z', -300n),
        txn('2026-11-08T22:00:00+05:30', -700n),
        txn('2026-11-02T09:15:00Z', 5000n),
        txn('2026-11-03', -999n),
    ]);
    assert.deepEqual(c.cells, [
        {weekday: 0, hour: 9, spent: a(400n, '$4.00')},
        {weekday: 6, hour: 22, spent: a(700n, '$7.00')},
    ]);
    assert.deepEqual([c.max.text, c.noTime.length], ['$7.00', 1]);
});

test('no_spend_calendar', () => {
    const c = chart(
        'no_spend_calendar',
        [
            txn('2026-10-30T10:00:00Z', -100n),
            txn('2026-11-02T10:00:00Z', -100n),
            txn('2026-11-03T10:00:00Z', 5000n),
            txn('2026-11-07T10:00:00Z', -100n),
        ],
        {from: '2026-11-01', today: '2026-11-09'},
    );
    const november = c.noSpend[0];
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
    assert.deepEqual([c.noSpend.length, november.days.length, november.zeroDays, november.bestStreak, c.currentStreak], [1, 30, 7, 4, 2]);
});

test('no_spend_calendar edges', async (t) => {
    await t.test('days before the first transaction are not zero-expense days', () => {
        const c = chart('no_spend_calendar', [txn('2026-11-05T10:00:00Z', -100n)], {today: '2026-11-06'});
        assert.deepEqual([c.noSpend[0].days[0].status, c.noSpend[0].zeroDays], ['outside', 1]);
    });
    await t.test('spending today ends the streak', () => {
        assert.equal(
            chart('no_spend_calendar', [txn('2026-11-01T10:00:00Z', 100n), txn('2026-11-06T10:00:00Z', -100n)], {today: '2026-11-06'})
                .currentStreak,
            0,
        );
    });
    await t.test('range spanning three months', () => {
        const c = chart('no_spend_calendar', [txn('2026-10-20T10:00:00Z', -100n)], {
            from: '2026-10-25',
            to: '2026-12-05',
            today: '2026-12-31',
        });
        assert.deepEqual(
            c.noSpend.map((m) => m.month),
            ['2026-10', '2026-11', '2026-12'],
        );
        assert.deepEqual([c.noSpend[0].days[23].status, c.noSpend[0].zeroDays], ['outside', 7]);
    });
});

test('category_compare and top_merchants', () => {
    const changes = [
        txn('2026-10-10', -1000n, 'groceries', {merchant: 'Market'}),
        txn('2026-10-12', -500n, 'transport'),
        txn('2026-11-10', -1500n, 'groceries', {merchant: 'Market'}),
        txn('2026-11-11', -300n, 'groceries', {merchant: 'Bakery'}),
        txn('2026-11-12', -200n, '', {note: 'parking'}),
    ];
    const c = chart('category_compare', changes, {from: '2026-11-01', to: '2026-11-30', today: '2026-11-30'});
    assert.deepEqual([c.previousFrom, c.previousTo], ['2026-10-02', '2026-10-31']);
    assert.deepEqual(
        c.compare.map((r) => [r.name, r.current.text, r.previous.text, r.change]),
        [
            ['groceries', '$18.00', '$10.00', '+80.00%'],
            ['Uncategorized', '$2.00', '$0.00', 'New'],
            ['transport', '$0.00', '$5.00', '-100.00%'],
        ],
    );
    assert.equal(chart('category_compare', changes, {today: '2026-11-30'}).compare[0].change, '', 'no comparison for all time');
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
            '-75.00% vs previous period',
        ],
    ];
    for (const [name, changes, scope, value, changeText] of cases) {
        await t.test(name, () => {
            const card = spent(changes, scope);
            assert.deepEqual([card.value.text, card.change], [value, changeText]);
        });
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
        [data.count, data.days.length, data.months, data.spent.text, data.income.text],
        [5, 3, ['2026-11', '2026-10'], '$17.50', '$1,000.00'],
    );
    const day = data.days[0];
    assert.deepEqual([day.date, day.total.text], ['2026-11-07', '$983.50']);
    assert.deepEqual(
        day.rows.map((r) => r.time),
        ['13:00', '09:30', ''],
        'newest first, unknown times last',
    );
    const coffee = day.rows[1];
    assert.deepEqual(
        [coffee.category, coffee.categoryColor, coffee.intents, coffee.amount.text, coffee.account],
        ['groceries', '#111111', ['want'], '-$4.50', 'Cash'],
    );
    assert.equal(day.rows[0].category, 'Uncategorized');
    assert.deepEqual([data.days[1].rows[0].refund, data.days[1].total.text], [true, '$2.00']);

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
        assert.deepEqual([groceries.spent.text, groceries.income.text], ['$2.50', '$0.00']);
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
    assert.equal(all.days[0].total.text, '-$1.00');
    const atm = all.days[0].rows[1];
    assert.deepEqual([atm.kind, atm.account, atm.amount.text, atm.signed], ['transfer', 'Bank → Cash', '$50.00', false]);
    const dinner = all.days[1].rows[0];
    assert.deepEqual(
        [dinner.category, dinner.split, dinner.people, all.days[1].total.text],
        ['groceries', true, ['Rahul owes $400.00'], '-$200.00'],
    );
    assert.equal(all.days[2].rows[0].account, 'Paid by Rahul');

    const cash = ledgerView(b.txns, b.transfers, b.project, {account: 'cash'});
    assert.deepEqual([cash.count, cash.days[0].total.text, cash.days[0].rows[1].amount.text], [2, '$49.00', '$50.00']);
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
        txn('2026-11-02', -8000n, 'groceries'),
        txn('2026-11-03', -1000n, 'groceries', {account: 'card'}),
        txn('2026-11-04', 500n, 'groceries', {refund: true}),
        txn('2026-10-30', -9000n, 'groceries'),
        txn('2026-11-05', -6000n, 'transport'),
    );
    const status = budgetStatus(b, '2026-11-15');
    assert.deepEqual([status.month, status.from, status.to, status.daysLeft], ['2026-11', '2026-11-01', '2026-11-30', 16]);
    assert.deepEqual(
        status.rows.map((r) => [r.name, r.spent.text, r.left.text, r.share, r.over, r.shareSize]),
        [
            ['transport', '$60.00', '-$10.00', '120.00%', true, 10000],
            ['groceries', '$85.00', '$15.00', '85.00%', false, 8500],
        ],
    );
    assert.deepEqual([status.total.budget.text, status.total.spent.text], ['$150.00', '$145.00']);
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
