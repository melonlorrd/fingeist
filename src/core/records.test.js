import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
    accountFields,
    budgetFields,
    categoryFields,
    parseAmountInput,
    recurringFields,
    settingsFields,
    transferFields,
    txnFields,
} from './fields.js';
import {buildBook} from './records.js';
import {applyChange} from './state.js';

const META = {name: 'Home', currency: 'INR', decimals: 2};
let tick = 0;
const put = (kind, id, fields, device = 'A') => ({kind, id, op: 'put', clock: `${1000000000000 + tick++}-0000`, device, fields});
const del = (kind, id) => ({kind, id, op: 'delete', clock: `${1000000000000 + tick++}-0000`, device: 'A'});

function book(...changes) {
    const winners = {};
    for (const c of changes) {
        applyChange(winners, c);
    }
    return buildBook(winners, META);
}

const coffee = {
    time: '2026-11-07T09:30:00+05:30',
    amount: '-45.50',
    account: 'cash',
    category: 'food',
    merchant: 'Cafe',
    note: '',
    tags: ['morning'],
    intent: 'want',
};
const food = put('category', 'food', {name: 'Food', color: '#AABBCC', archived: false, mergedInto: ''});
const cash = put('account', 'cash', {name: 'Cash', opening: '100.00', kind: 'own', archived: false, mergedInto: ''});

test('buildBook parses every kind', () => {
    const b = book(
        food,
        cash,
        put('account', 'rahul', {name: 'Rahul', opening: '0', kind: 'person', archived: false, mergedInto: ''}),
        put('txn', 't1', coffee),
        put('transfer', 'x1', {time: '2026-11-07', amount: '500.00', from: 'bank', to: 'cash', note: 'ATM'}),
        put('budget', 'food', {amount: '3000.00'}),
        put('recurring', 'r1', {
            entry: 'txn',
            template: {amount: '-20000.00', account: 'cash', category: 'food'},
            every: 'month',
            start: '2026-11-01',
        }),
        put('device', 'D1', {name: 'iphone'}),
    );
    assert.deepEqual(b.problems, []);
    assert.deepEqual(
        [b.txns[0].amount, b.txns[0].date, b.txns[0].hour, b.txns[0].intent, b.txns[0].category],
        [-4550n, '2026-11-07', 9, 'want', 'food'],
    );
    assert.deepEqual(b.txns[0].lines, [
        {amount: -4550n, kind: 'expense', person: '', category: 'food', intent: 'want', item: '', spend: 4550n},
    ]);
    assert.deepEqual([b.transfers[0].amount, b.transfers[0].unknown], [50000n, true]);
    assert.deepEqual(
        b.project.categories.map((c) => [c.id, c.name, c.color]),
        [['food', 'Food', '#aabbcc']],
    );
    assert.deepEqual(
        b.project.accounts.map((a) => [a.name, a.kind, a.opening]),
        [
            ['Cash', 'own', 10000n],
            ['Rahul', 'person', 0n],
        ],
    );
    assert.deepEqual(b.budgets, [{category: 'food', amount: 300000n}]);
    assert.equal(b.recurring[0].every, 'month');
    assert.deepEqual(b.devices, {D1: 'iphone'});
});

test('settings default, and each setting field merges on its own', () => {
    const defaults = book().project;
    assert.deepEqual(
        [defaults.name, defaults.thresholds, defaults.workdays, defaults.monthStart],
        ['Home', [10000n, 25000n, 50000n, 100000n], [1, 2, 3, 4, 5], 1],
    );
    const b = book(
        put('setting', 'project', {name: 'Household'}, 'A'),
        put('setting', 'project', {thresholds: ['500', '50', '50.00'], workdays: ['sat', 'mon'], monthStart: 25}, 'B'),
    );
    assert.deepEqual(
        [b.project.name, b.project.thresholds, b.project.workdays, b.project.monthStart],
        ['Household', [5000n, 50000n], [1, 6], 25],
    );
});

test('a renamed category keeps its rows; merged categories redirect, deleted ones become uncategorized', () => {
    const b = book(
        food,
        put('category', 'eats', {name: 'Eating out', color: '', archived: false, mergedInto: ''}),
        put('category', 'snacks', {name: 'Snacks', color: '', archived: false, mergedInto: 'eats'}),
        put('category', 'old', {name: 'Old', color: '', archived: false, mergedInto: 'snacks'}),
        put('category', 'gone', {name: 'Gone', color: '', archived: false, mergedInto: ''}),
        del('category', 'gone'),
        put('category', 'food', {name: 'Groceries'}),
        cash,
        put('txn', 't1', coffee),
        put('txn', 't2', {...coffee, category: 'old'}),
        put('txn', 't3', {...coffee, category: 'gone'}),
        put('txn', 't4', {...coffee, category: 'never-existed'}),
    );
    assert.deepEqual(
        b.txns.map((t) => t.category),
        ['food', 'eats', '', ''],
    );
    assert.deepEqual(
        b.project.categories.map((c) => c.name),
        ['Eating out', 'Groceries'],
    );
    assert.equal(b.project.categoryById.get('snacks').mergedInto, 'eats');
});

test('a merge loop falls back to uncategorized instead of hanging', () => {
    const b = book(
        put('category', 'a', {name: 'A', mergedInto: 'b'}),
        put('category', 'b', {name: 'B', mergedInto: 'a'}),
        cash,
        put('txn', 't1', {...coffee, category: 'a'}),
    );
    assert.equal(b.txns[0].category, '');
});

test('a merged account redirects; a deleted one keeps its id so balances stay whole', () => {
    const b = book(
        cash,
        put('account', 'wallet', {name: 'Wallet', kind: 'own', mergedInto: 'cash'}),
        put('txn', 't1', {...coffee, account: 'wallet'}),
        put('txn', 't2', {...coffee, account: 'lost'}),
    );
    assert.deepEqual(
        b.txns.map((t) => t.account),
        ['cash', 'lost'],
    );
});

test('splits become lines: spending per category and shares lent to people', () => {
    const b = book(
        cash,
        food,
        put('txn', 'dinner', {
            ...coffee,
            amount: '-600.00',
            category: '',
            splits: [
                {category: 'food', person: '', amount: '200.00'},
                {category: '', person: 'rahul', amount: '400.00'},
            ],
        }),
    );
    assert.deepEqual(b.txns[0].lines, [
        {amount: -20000n, kind: 'expense', person: '', category: 'food', intent: 'want', item: '', spend: 20000n},
        {amount: -40000n, kind: 'lent', person: 'rahul', category: '', intent: '', item: '', spend: 0n},
    ]);
});

test('refunds reduce spending in their category and are not income', () => {
    const b = book(cash, food, put('txn', 'r', {...coffee, amount: '20.00', refund: true, intent: 'want'}));
    assert.deepEqual(b.txns[0].lines, [{amount: 2000n, kind: 'refund', person: '', category: 'food', intent: '', item: '', spend: -2000n}]);
    assert.equal(b.txns[0].intent, '');
});

test('split parts carry their own intent, fall back to the entry, and may be a discount', () => {
    const snacks = put('category', 'snacks', {name: 'Snacks', color: '', archived: false, mergedInto: ''});
    const order = (splits, extra = {}) =>
        put('txn', 'order', {...coffee, amount: '-814.00', category: '', intent: 'want', splits, ...extra});
    const b = book(
        cash,
        food,
        snacks,
        order([
            {category: 'food', person: '', amount: '99.00', intent: 'need'},
            {category: 'snacks', person: '', amount: '720.00'},
            {category: '', person: '', amount: '35.00', intent: 'impulse'},
            {category: 'snacks', person: '', amount: '-40.00'},
        ]),
    );
    assert.deepEqual(b.problems, []);
    assert.deepEqual(
        b.txns[0].lines.map((l) => [l.category, l.kind, l.intent, l.spend]),
        [
            ['food', 'expense', 'need', 9900n],
            ['snacks', 'expense', 'want', 72000n],
            ['', 'expense', 'impulse', 3500n],
            ['snacks', 'expense', 'want', -4000n],
        ],
    );

    const income = book(
        cash,
        food,
        put('txn', 'pay', {
            ...coffee,
            amount: '100.00',
            intent: '',
            splits: [
                {category: 'food', person: '', amount: '120.00', intent: 'need'},
                {category: '', person: '', amount: '-20.00'},
            ],
        }),
    );
    assert.deepEqual(
        income.txns[0].lines.map((l) => [l.kind, l.amount, l.intent]),
        [
            ['income', 12000n, ''],
            ['income', -2000n, ''],
        ],
        'income has no intent, and a negative part lowers it',
    );
});

test('a bill may have one item, and a refund may have items of its own', () => {
    const b = book(
        cash,
        food,
        put('txn', 'one', {...coffee, category: '', splits: [{category: 'food', amount: '45.50', intent: 'need', note: 'Lunch'}]}),
        put('txn', 'back', {
            ...coffee,
            amount: '30.00',
            refund: true,
            category: '',
            splits: [
                {category: 'food', amount: '20.00', note: 'Cold coffee'},
                {category: '', amount: '10.00', note: 'Fee'},
            ],
        }),
    );
    assert.deepEqual(b.problems, []);
    assert.deepEqual(
        b.txns.map((t) => t.lines.map((l) => [l.kind, l.category, l.item, l.intent, l.spend])),
        [
            [['expense', 'food', 'Lunch', 'need', 4550n]],
            [
                ['refund', 'food', 'Cold coffee', '', -2000n],
                ['refund', '', 'Fee', '', -1000n],
            ],
        ],
    );
});

test('split parts that break the rules are reported', async (t) => {
    const cases = [
        [
            'a negative share with a person',
            [
                {category: 'food', amount: '-20.00'},
                {person: 'rahul', amount: '-25.50'},
                {category: 'food', amount: '91.00'},
            ],
        ],
        [
            'a zero part',
            [
                {category: 'food', amount: '45.50'},
                {category: 'food', amount: '0.00'},
            ],
        ],
        [
            'an unknown part intent',
            [
                {category: 'food', amount: '20.00', intent: 'hobby'},
                {category: 'food', amount: '25.50'},
            ],
        ],
        [
            'parts that miss the total once the discount is taken off',
            [
                {category: 'food', amount: '45.50'},
                {category: 'food', amount: '-5.00'},
            ],
        ],
    ];
    for (const [name, splits] of cases) {
        await t.test(name, () => {
            const b = book(cash, food, put('txn', 'bad', {...coffee, category: '', splits}));
            assert.deepEqual(b.txns, []);
            assert.equal(b.problems.length, 1);
        });
    }
});

test('malformed records are reported, left out, and never block the rest', () => {
    const b = book(
        cash,
        put('txn', 'good', coffee),
        put('txn', 'bad-amount', {...coffee, amount: '12.345'}),
        put('txn', 'zero', {...coffee, amount: '0'}),
        put('txn', 'bad-time', {...coffee, time: '07/11/2026'}),
        put('txn', 'no-account', {...coffee, account: ' '}),
        put('txn', 'bad-intent', {...coffee, intent: 'hobby'}),
        put('txn', 'bad-split', {...coffee, splits: [{amount: '10.00'}, {amount: '10.00'}]}),
        put('txn', 'split-refund', {
            ...coffee,
            amount: '20.00',
            refund: true,
            splits: [{amount: '10.00'}, {person: 'cash', amount: '10.00'}],
        }),
        put('transfer', 'same', {time: '2026-11-07', amount: '1.00', from: 'cash', to: 'cash'}),
        put('category', 'odd', {name: 'Odd', color: 'red'}),
        put('account', 'kindless', {name: 'X', kind: 'company'}),
        put('budget', 'food', {amount: '-5'}),
        put('recurring', 'r', {entry: 'txn', template: {}, every: 'month', start: '2026-11-01'}),
        put('setting', 'project', {workdays: ['monday']}, 'B'),
    );
    assert.deepEqual(
        b.txns.map((t) => t.id),
        ['good'],
    );
    assert.deepEqual(b.project.workdays, [1, 2, 3, 4, 5]);
    assert.deepEqual(b.problems.map((p) => `${p.kind}:${p.id}`).sort(), [
        'account:kindless',
        'budget:food',
        'category:odd',
        'recurring:r',
        'setting:workdays',
        'transfer:same',
        'txn:bad-amount',
        'txn:bad-intent',
        'txn:bad-split',
        'txn:bad-time',
        'txn:no-account',
        'txn:split-refund',
        'txn:zero',
    ]);
});

test('parseAmountInput accepts grouping, a currency symbol, sums and differences', () => {
    const cases = [
        ['1,200', 120000n],
        ['₹ 450.5', 45050n],
        ['120+45.50', 16550n],
        [' 10 + 20 ', 3000n],
        ['$5', 500n],
        ['-5', -500n],
        ['720-40', 68000n],
        ['25+10-5', 3000n],
        ['₹1,200 - 200.50', 99950n],
        ['-40+10', -3000n],
        ['40-720', -68000n],
        ['+5', 500n],
    ];
    for (const [input, want] of cases) {
        assert.equal(parseAmountInput(input, 2), want, input);
    }
    for (const bad of ['', 'abc', '1+', '+', '1.234', '1e3', '12,5.5.5', '720-', '--5', '5-+3', '-', '5--3', '5-x']) {
        assert.throws(() => parseAmountInput(bad, 2), bad);
    }
});

test('field builders normalise and check form input', () => {
    assert.deepEqual(
        txnFields(
            {time: '2026-11-07', amount: -1250n, account: 'cash', category: 'food', merchant: ' Cafe ', tags: 'a; b ;;', intent: 'need'},
            2,
        ),
        {
            time: '2026-11-07',
            amount: '-12.50',
            account: 'cash',
            category: 'food',
            merchant: 'Cafe',
            note: '',
            tags: ['a', 'b'],
            intent: 'need',
            refund: false,
            splits: [],
        },
    );
    assert.equal(txnFields({time: '2026-11-07', amount: 500n, account: 'cash', intent: 'want', refund: true}, 0).refund, true);
    assert.throws(
        () => txnFields({time: '2026-11-07', amount: -100n, account: 'cash', splits: [{amount: 30n}, {amount: 30n}]}, 2),
        /add up to 0.60, not 1.00/,
    );
    assert.deepEqual(transferFields({time: '2026-11-07', amount: 50000n, from: 'bank', to: 'cash', note: ' ATM '}, 2), {
        time: '2026-11-07',
        amount: '500.00',
        from: 'bank',
        to: 'cash',
        note: 'ATM',
    });
    assert.deepEqual(accountFields({name: ' Card ', opening: '-1,200'}, 2), {name: 'Card', opening: '-1200.00', kind: 'own'});
    assert.throws(() => accountFields({name: 'x', kind: 'bank'}, 2), /unknown account kind/);
    assert.deepEqual(categoryFields({name: ' Food ', color: '#112233'}), {name: 'Food', color: '#112233'});
    assert.throws(() => categoryFields({name: '', color: ''}), /category name/);
    assert.deepEqual(budgetFields({amount: '3,000'}, 2), {amount: '3000.00'});
    assert.throws(() => budgetFields({amount: '0'}, 2), /more than zero/);
    assert.throws(
        () => recurringFields({entry: 'txn', template: {amount: '-1.00', account: 'cash'}, every: 'fortnight', start: '2026-11-01'}, 2),
        /unknown repeat/,
    );
    assert.deepEqual(settingsFields({name: ' Home ', thresholds: ['250', ' 100 ', ''], workdays: ['mon', 'sun'], monthStart: '25'}, 2), {
        name: 'Home',
        thresholds: ['100.00', '250.00'],
        workdays: ['sun', 'mon'],
        monthStart: 25,
    });
    assert.throws(() => settingsFields({name: 'x', thresholds: [], workdays: [], monthStart: 31}, 2), /day from 1 to 28/);
});
