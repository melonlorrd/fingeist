import assert from 'node:assert/strict';
import {test} from 'node:test';

import {createApp} from './app.js';
import {AuthError} from './remote/errors.js';
import {memoryRemote, memoryStore} from './testing.js';

const crypto = globalThis.crypto;

function fakeClock(start = Date.UTC(2026, 10, 15, 4, 0)) {
    let ms = start;
    return {
        advance(n) {
            ms += n;
        },
        now: () => ({ms, date: new Date(ms + 330 * 60000).toISOString().slice(0, 10), clock: '09:30', offset: '+05:30'}),
        offsetAt: () => '+05:30',
    };
}

async function newApp(remote = memoryRemote(), store = memoryStore(), clock = fakeClock()) {
    const app = await createApp({store, crypto, clock, makeRemote: () => remote});
    return {app, remote, store, clock};
}

async function withProject() {
    const env = await newApp();
    await env.app.createProject({name: 'Home', currency: 'inr', decimals: 2});
    return env;
}

const expense = {
    type: 'expense',
    amount: '120.5',
    account: 'new:Cash',
    category: 'new:Food',
    merchant: 'Market',
    note: '',
    tags: 'weekly',
    intent: 'need',
    date: '2026-11-15',
    clock: '09:30',
};
const SYNC = {repo: 'me/data', token: 't', deviceName: 'mac', passphrase: 'correct horse', iterations: 1000};
const ids = (app) => Object.fromEntries([...app.boot().accounts, ...app.boot().categories].map((x) => [x.name, x.id]));

test('a new project starts with no categories and no accounts', async () => {
    const {app} = await newApp();
    assert.equal(app.boot().needsSetup, true);
    await app.createProject({name: 'Home', currency: 'inr', decimals: 2});
    const boot = app.boot();
    assert.deepEqual([boot.projectName, boot.currency, boot.categories, boot.accounts], ['Home', 'INR', [], []]);
    assert.deepEqual(boot.settings, {
        name: 'Home',
        currency: 'INR',
        thresholds: ['100.00', '250.00', '500.00', '1000.00'],
        workdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
        monthStart: 1,
    });
    await assert.rejects(app.createProject({name: 'Again', currency: 'INR', decimals: 2}), /already exists/);
    for (const bad of [
        {name: '', currency: 'INR', decimals: 2},
        {name: 'x', currency: 'rupees!', decimals: 2},
        {name: 'x', currency: 'INR', decimals: 9},
    ]) {
        await assert.rejects((await newApp()).app.createProject(bad), /project name/);
    }
});

test('an expense creates its new account and category inline, and is signed from the type', async () => {
    const {app} = await withProject();
    await app.saveEntry(expense);
    const boot = app.boot();
    assert.deepEqual(
        boot.accounts.map((a) => [a.name, a.kind, a.balance.text]),
        [['Cash', 'own', '-₹120.50']],
    );
    assert.deepEqual(
        boot.categories.map((c) => c.name),
        ['Food'],
    );
    const row = app.ledger().days[0].rows[0];
    assert.deepEqual([row.amount.text, row.time, row.intents, row.category, row.account], ['-₹120.50', '09:30', ['need'], 'Food', 'Cash']);
    assert.equal(boot.lastAccount, ids(app).Cash);
    assert.deepEqual(app.getEntry(row.id), {
        id: row.id,
        time: '2026-11-15T09:30:00+05:30',
        date: '2026-11-15',
        clock: '09:30',
        amount: '120.50',
        note: '',
        type: 'expense',
        account: ids(app).Cash,
        category: ids(app).Food,
        merchant: 'Market',
        tags: 'weekly',
        intent: 'need',
        splits: [],
    });
    await app.saveEntry({...expense, account: 'new:cash', category: 'new:FOOD'});
    assert.equal(app.boot().accounts.length, 1, 'a "new" name that exists reuses it');
});

test('amounts accept grouping, a currency sign and sums', async () => {
    const {app} = await withProject();
    await app.saveEntry({...expense, amount: '₹ 1,200 + 45.50'});
    assert.equal(app.ledger().days[0].rows[0].amount.text, '-₹1,245.50');
});

test('income, refunds and a cleared time', async () => {
    const {app} = await withProject();
    await app.saveEntry(expense);
    await app.saveEntry({...expense, type: 'refund', amount: '20', clock: ''});
    await app.saveEntry({...expense, type: 'income', amount: '1000', category: ''});
    const {summary} = app.dashboard();
    assert.deepEqual(
        summary.cards.slice(0, 2).map((c) => c.value.text),
        ['₹100.50', '₹1,000.00'],
    );
    const refund = app.ledger({filter: 'refund'}).days[0].rows[0];
    const entry = app.getEntry(refund.id);
    assert.deepEqual([entry.type, entry.intent, entry.time, entry.clock], ['refund', '', '2026-11-15', '']);
});

test('editing writes only changed fields and keeps the original time unless it was changed', async () => {
    const {app} = await withProject();
    await app.saveEntry(expense);
    const id = app.ledger().days[0].rows[0].id;
    const entry = app.getEntry(id);
    const original = {originalTime: '2026-11-15T09:30:00-05:00', originalDate: entry.date, originalClock: entry.clock};
    await app.saveEntry({...entry, id, ...original, note: 'fixed'});
    assert.deepEqual([app.getEntry(id).time, app.getEntry(id).note], ['2026-11-15T09:30:00-05:00', 'fixed']);
    await app.saveEntry({...entry, id, ...original, clock: '10:00'});
    assert.equal(app.getEntry(id).time, '2026-11-15T10:00:00+05:30');
});

test('bad form input is refused with a message and saves nothing', async () => {
    const {app} = await withProject();
    await assert.rejects(app.saveEntry({...expense, amount: '0'}), /more than zero/);
    await assert.rejects(app.saveEntry({...expense, amount: '40-720'}), /more than zero/);
    await assert.rejects(app.saveEntry({...expense, amount: '1.234'}), /invalid amount/);
    await assert.rejects(app.saveEntry({...expense, account: ''}), /account is required/);
    await assert.rejects(app.saveEntry({...expense, date: '2026-02-30'}), /invalid date/);
    assert.equal(app.ledger().count, 0);
});

test('splits with a friend, the friend paying for you, and settling up', async () => {
    const {app} = await withProject();
    await app.saveEntry({
        ...expense,
        amount: '600',
        category: '',
        splits: [
            {category: 'new:Food', amount: '200'},
            {person: 'new:Rahul', amount: '400'},
        ],
    });
    await app.saveEntry({...expense, amount: '300', account: ids(app).Rahul, category: 'new:Movies'});
    let boot = app.boot();
    assert.deepEqual(
        boot.accounts.map((a) => [a.name, a.kind, a.balance.text, a.settle]),
        [
            ['Cash', 'own', '-₹600.00', '600.00'],
            ['Rahul', 'person', '₹100.00', '100.00'],
        ],
    );
    assert.equal(app.dashboard().summary.cards[0].value.text, '₹500.00');
    await app.saveEntry({
        type: 'transfer',
        amount: '100',
        from: ids(app).Rahul,
        to: ids(app).Cash,
        note: 'settle',
        date: '2026-11-15',
        clock: '',
    });
    boot = app.boot();
    assert.deepEqual(
        boot.accounts.map((a) => a.balance.text),
        ['-₹500.00', '₹0.00'],
    );
    await assert.rejects(
        app.saveEntry({
            ...expense,
            amount: '100',
            splits: [
                {category: '', amount: '30'},
                {category: '', amount: '-30'},
            ],
        }),
        /add up to more than zero/,
    );
});

test('an itemised bill: named items with their own intent, a fee and a discount, totalled for you', async () => {
    const {app} = await withProject();
    await app.saveEntry({
        ...expense,
        amount: 'ignored while itemising',
        category: '',
        intent: 'want',
        splits: [
            {category: 'new:Essentials', amount: '99', intent: 'need', note: ' Nail clipper '},
            {category: 'new:Snacks', amount: '720', intent: '', note: 'White Monster x6'},
            {category: 'new:Delivery', amount: '25+10', intent: '', note: ''},
            {category: 'new:Snacks', amount: '720-760', intent: '', note: 'Coupon'},
        ],
    });
    const [row] = app.ledger().days[0].rows;
    assert.deepEqual(
        [row.amount.text, row.intents, row.split, row.category],
        ['-₹814.00', ['need', 'want'], true, 'Snacks, Essentials +1 · 4 items'],
    );
    assert.equal(row.categoryColors.length, 3);
    assert.deepEqual(
        app.getEntry(row.id).splits.map((s) => [s.amount, s.intent, s.note]),
        [
            ['99.00', 'need', 'Nail clipper'],
            ['720.00', '', 'White Monster x6'],
            ['35.00', '', ''],
            ['-40.00', '', 'Coupon'],
        ],
    );
    assert.equal(app.ledger({search: 'monster'}).count, 1, 'search covers item names');
    assert.match(app.exportCsv(), /,Snacks,White Monster x6,Market,/);
    assert.deepEqual(
        [app.itemsTotal(['99', '720', '25+10', '-40']), app.itemsTotal(['99', '']), app.itemsTotal([])],
        ['814.00', '', '0.00'],
    );
    assert.equal(app.boot().accounts[0].balance.text, '-₹814.00');
    await assert.rejects(
        app.saveEntry({
            ...expense,
            amount: '50',
            category: '',
            splits: [
                {category: '', amount: '100'},
                {person: 'new:Rahul', amount: '-50'},
            ],
        }),
        /more than zero/,
    );
});

test('the form always sends items: one unnamed item is an ordinary entry, a named one keeps its name', async () => {
    const {app} = await withProject();
    await app.saveEntry({
        ...expense,
        amount: '',
        category: '',
        intent: '',
        splits: [{category: 'new:Food', amount: '120+5', intent: 'need', note: ' '}],
    });
    await app.saveEntry({
        ...expense,
        amount: '',
        category: '',
        intent: '',
        merchant: 'Shop',
        splits: [{category: 'new:Home', amount: '99', intent: 'need', note: 'Nail clipper'}],
    });
    await app.saveEntry({
        ...expense,
        type: 'income',
        amount: '',
        category: '',
        intent: '',
        merchant: 'Pay',
        splits: [{category: '', amount: '500', intent: 'want'}],
    });
    const rows = app.ledger().days[0].rows;
    const [pay, shop, market] = ['Pay', 'Shop', 'Market'].map((name) => rows.find((r) => r.merchant === name));
    assert.deepEqual(
        [market.category, market.intents, market.amount.text, app.getEntry(market.id).splits, app.getEntry(market.id).intent],
        ['Food', ['need'], '-₹125.00', [], 'need'],
    );
    assert.deepEqual([shop.category, shop.intents, app.getEntry(shop.id).splits.map((s) => s.note)], ['Home', ['need'], ['Nail clipper']]);
    assert.deepEqual([pay.amount.text, pay.intents, app.getEntry(pay.id).intent], ['+₹500.00', [], '']);
    await assert.rejects(app.saveEntry({...expense, splits: [{category: '', amount: '-5'}]}), /more than zero/);
    await assert.rejects(
        app.saveEntry({
            ...expense,
            type: 'refund',
            splits: [
                {category: '', amount: '5'},
                {person: 'new:Rahul', amount: '5'},
            ],
        }),
        /shared with a person/,
    );
});

test('transfers move both balances and stay out of income and spending', async () => {
    const {app} = await withProject();
    await app.createAccount({name: 'Bank', opening: '1000'});
    await app.saveEntry({type: 'transfer', amount: '200', from: ids(app).Bank, to: 'new:Cash', note: 'ATM', date: '2026-11-15', clock: ''});
    assert.deepEqual(
        app.boot().accounts.map((a) => [a.name, a.balance.text]),
        [
            ['Bank', '₹800.00'],
            ['Cash', '₹200.00'],
        ],
    );
    assert.deepEqual(
        app
            .dashboard()
            .summary.cards.slice(0, 2)
            .map((c) => c.value.text),
        ['₹0.00', '₹0.00'],
    );
    await assert.rejects(
        app.saveEntry({type: 'transfer', amount: '5', from: ids(app).Bank, to: ids(app).Bank, date: '2026-11-15', clock: ''}),
        /two different accounts/,
    );
});

test('changing an expense into a transfer replaces it', async () => {
    const {app} = await withProject();
    await app.saveEntry(expense);
    const id = app.ledger().days[0].rows[0].id;
    await app.createAccount({name: 'Bank'});
    await app.saveEntry({...app.getEntry(id), type: 'transfer', from: ids(app).Bank, to: ids(app).Cash});
    assert.deepEqual(
        app.ledger().days[0].rows.map((r) => r.kind),
        ['transfer'],
    );
});

test('delete and undo', async () => {
    const {app} = await withProject();
    await app.saveEntry(expense);
    const id = app.ledger().days[0].rows[0].id;
    const undo = await app.deleteEntry(id);
    assert.equal(app.ledger().count, 0);
    await app.undoDelete(undo);
    assert.equal(app.ledger().count, 1);
    await app.deleteEntry(id);
    await assert.rejects(app.deleteEntry(id), /no longer exists/);
});

test('categories: rename keeps rows, merge redirects and can be undone, delete leaves rows uncategorized', async () => {
    const {app} = await withProject();
    await app.saveEntry(expense);
    await app.saveEntry({...expense, category: 'new:Snacks'});
    const {Food, Snacks} = ids(app);
    await app.updateCategory(Food, {name: 'Groceries', color: '#112233'});
    assert.deepEqual(app.ledger({category: Food}).count, 1);
    await assert.rejects(app.updateCategory(Snacks, {name: 'groceries', color: ''}), /already a category/);
    await assert.rejects(app.createCategory('GROCERIES', ''), /already a category/);

    await app.mergeCategory(Snacks, Food);
    assert.deepEqual(
        app.boot().categories.map((c) => c.name),
        ['Groceries'],
    );
    assert.deepEqual(app.boot().merged.categories, [{id: Snacks, name: 'Snacks', into: 'Groceries'}]);
    assert.equal(app.ledger({category: Food}).count, 2);
    await assert.rejects(app.mergeCategory(Food, Snacks), /different one/);
    await app.unmergeCategory(Snacks);
    assert.equal(app.ledger({category: Food}).count, 1);

    await app.setBudget(Snacks, '500');
    await app.deleteCategory(Snacks);
    assert.equal(app.ledger({category: 'uncategorized'}).count, 1);
    assert.deepEqual(app.boot().budgets.rows, []);
});

test('accounts: rename, merge, and delete only when unused', async () => {
    const {app} = await withProject();
    await app.saveEntry(expense);
    await app.saveEntry({...expense, account: 'new:Wallet'});
    const {Cash, Wallet} = ids(app);
    await app.updateAccount(Cash, {name: 'Pocket cash', opening: '50', kind: 'own'});
    await assert.rejects(app.deleteAccount(Wallet), /Merge it/);
    await app.mergeAccount(Wallet, Cash);
    assert.deepEqual(
        app.boot().accounts.map((a) => [a.name, a.balance.text]),
        [['Pocket cash', '-₹191.00']],
    );
    const unused = await app.createAccount({name: 'Unused'});
    await app.deleteAccount(unused);
    await app.setAccountArchived(Cash, true);
    assert.equal(app.boot().accounts[0].archived, true);
});

test('bulk recategorise skips entries with several items and changes one-item ones', async () => {
    const {app} = await withProject();
    await app.saveEntry(expense);
    await app.saveEntry({...expense, merchant: 'Bakery'});
    await app.saveEntry({
        ...expense,
        amount: '10',
        splits: [
            {category: '', amount: '5'},
            {category: '', amount: '5'},
        ],
    });
    await app.saveEntry({...expense, merchant: 'Cafe', splits: [{category: '', amount: '7', note: 'Tea'}]});
    const all = app.ledger().days.flatMap((d) => d.rows.map((r) => r.id));
    assert.deepEqual(await app.setCategory(all, 'new:Treats'), {changed: 3, skipped: 1});
    assert.equal(app.ledger({category: ids(app).Treats}).count, 3);
    const cafe = app.ledger({search: 'cafe'}).days[0].rows[0];
    assert.deepEqual(app.getEntry(cafe.id).splits, [{category: ids(app).Treats, person: '', amount: '7.00', intent: '', note: 'Tea'}]);
});

test('merchant suggestions remember the latest category and account', async () => {
    const {app} = await withProject();
    await app.saveEntry(expense);
    await app.saveEntry({...expense, date: '2026-11-16', category: 'new:Groceries', account: 'new:Card'});
    await app.saveEntry({...expense, merchant: 'Bakery'});
    const [market, bakery] = app.merchantSuggestions();
    assert.deepEqual([market.merchant, market.count, market.category, market.account], ['Market', 2, ids(app).Groceries, ids(app).Card]);
    assert.equal(bakery.merchant, 'Bakery');
});

test('a repeating entry creates its due occurrences once, and they survive a restart', async () => {
    const {app, store, remote, clock} = await withProject();
    await app.saveEntry({...expense, merchant: 'Rent', amount: '20000', date: '2026-09-01', clock: '', repeat: {every: 'month'}});
    assert.deepEqual(
        app.ledger({search: 'rent'}).days.map((d) => d.date),
        ['2026-11-01', '2026-10-01', '2026-09-01'],
    );
    const [repeat] = app.boot().recurring;
    assert.deepEqual([repeat.label, repeat.every, repeat.start, repeat.paused], ['Rent', 'month', '2026-09-01', false]);

    clock.advance(31 * 86400000);
    const later = await createApp({store, crypto, clock, makeRemote: () => remote});
    assert.equal(later.ledger({search: 'rent'}).count, 4);
    const december = later.ledger({search: 'rent'}).days[0].rows[0].id;
    await later.deleteEntry(december);
    await later.setRepeatPaused(repeat.id, true);
    clock.advance(31 * 86400000);
    assert.equal((await createApp({store, crypto, clock, makeRemote: () => remote})).ledger({search: 'rent'}).count, 3);
});

test('two devices create the same occurrence offline without duplicating it', async () => {
    const {app, remote} = await withProject();
    await app.connect(SYNC);
    const phoneEnv = await newApp(remote);
    await phoneEnv.app.join(SYNC);
    await app.saveEntry({...expense, merchant: 'Gym', date: '2026-10-15', clock: '', repeat: {every: 'month'}});
    await app.sync();
    await phoneEnv.app.sync();
    phoneEnv.clock.advance(31 * 86400000);
    const phone = await createApp({store: phoneEnv.store, crypto, clock: phoneEnv.clock, makeRemote: () => remote});
    const mac = await createApp({store: memoryStore(), crypto, clock: phoneEnv.clock, makeRemote: () => remote});
    await mac.join(SYNC);
    await phone.sync();
    await mac.sync();
    assert.equal(mac.ledger({search: 'gym'}).count, 3);
    assert.equal(phone.ledger({search: 'gym'}).count, 3);
});

test('budgets and settings', async () => {
    const {app} = await withProject();
    await app.saveEntry(expense);
    await app.setBudget(ids(app).Food, '1,000');
    assert.deepEqual(
        app.boot().budgets.rows.map((r) => [r.name, r.spent.text, r.left.text]),
        [['Food', '₹120.50', '₹879.50']],
    );
    assert.equal(app.boot().categories[0].budget, '1000.00');
    await assert.rejects(app.setBudget(ids(app).Food, '0'), /more than zero/);
    await app.setBudget(ids(app).Food, '');
    assert.deepEqual(app.boot().budgets.rows, []);

    await app.saveSettings({name: 'Household', thresholds: ['50', '500'], workdays: ['sat', 'mon'], monthStart: '25'});
    const s = app.boot().settings;
    assert.deepEqual([s.name, s.thresholds, s.workdays, s.monthStart], ['Household', ['50.00', '500.00'], ['mon', 'sat'], 25]);
    assert.deepEqual(app.presetRange('this_month'), {from: '2026-10-25', to: '2026-11-15'});
    await assert.rejects(app.saveSettings({name: 'x', thresholds: ['abc'], workdays: [], monthStart: 1}), /invalid amount/);
});

test('dashboard follows the range and account', async () => {
    const {app} = await withProject();
    await app.saveEntry({...expense, amount: '10'});
    await app.saveEntry({...expense, account: 'new:Card', amount: '30'});
    assert.equal(app.dashboard().summary.cards[0].value.text, '₹40.00');
    assert.equal(app.dashboard({account: ids(app).Card}).summary.cards[0].value.text, '₹30.00');
    assert.equal(app.dashboard({from: '2026-11-16'}).summary.cards[0].value.text, '₹0.00');
    assert.equal(app.dashboard().charts.length, 8);
    assert.throws(() => app.dashboard({from: '2026-12-01', to: '2026-11-01'}), /after the end date/);
});

test('export gives readable JSON and CSV', async () => {
    const {app} = await withProject();
    await app.saveEntry({...expense, note: 'with "quotes", and commas'});
    const json = JSON.parse(app.exportJson());
    assert.deepEqual(
        [json.app, json.meta.currency, json.records.txn.length, json.records.category[0].name],
        ['fingeist', 'INR', 1, 'Food'],
    );
    const csv = app.exportCsv().split('\n');
    assert.equal(csv[0], 'id,date,time,type,amount,account,to_account,category,item,merchant,note,tags,intent');
    assert.match(csv[1], /,2026-11-15,09:30,expense,-120.50,Cash,,Food,,Market,"with ""quotes"", and commas",weekly,need$/);
});

test('local only: no sync until connected, and everything survives a restart', async () => {
    const {app, store, remote, clock} = await withProject();
    await app.saveEntry(expense);
    assert.equal((await app.sync()).state, 'local');
    assert.equal(remote.files.size, 0);
    const again = await createApp({store, crypto, clock, makeRemote: () => remote});
    assert.equal(again.ledger().count, 1);
    assert.equal(again.syncStatus().pending, 3, 'the account, the category and the expense');
});

test('connect pushes the local data; a second device joins and sees it', async () => {
    const {app, remote} = await withProject();
    await app.saveEntry(expense);
    const status = await app.connect(SYNC);
    assert.deepEqual([status.state, app.syncStatus().pending, app.syncStatus().deviceName], ['idle', 0, 'mac']);
    const phone = (await newApp(remote)).app;
    await assert.rejects(phone.join({...SYNC, passphrase: 'wrong horse'}), /Wrong passphrase/);
    assert.equal(phone.boot().needsSetup, true);
    await phone.join({...SYNC, deviceName: 'iphone'});
    assert.deepEqual([phone.boot().projectName, phone.boot().currency, phone.ledger().count], ['Home', 'INR', 1]);
    await phone.saveEntry({...expense, amount: '5', account: ids(phone).Cash, category: ids(phone).Food});
    await phone.sync();
    await app.sync();
    assert.equal(app.ledger().count, 2);
});

test('edits to different fields on two devices both survive; same-field edits are noted', async () => {
    const {app: mac, remote, clock} = await withProject();
    await mac.saveEntry(expense);
    await mac.connect(SYNC);
    const phone = (await newApp(remote)).app;
    await phone.join({...SYNC, deviceName: 'iphone'});
    const id = mac.ledger().days[0].rows[0].id;
    await phone.saveEntry({...phone.getEntry(id), note: 'from phone', amount: '99'});
    clock.advance(1000);
    await mac.saveEntry({...mac.getEntry(id), merchant: 'Supermarket', amount: '98'});
    await phone.sync();
    await mac.sync();
    await phone.sync();
    const [onMac, onPhone] = [mac.getEntry(id), phone.getEntry(id)];
    assert.deepEqual([onMac.note, onMac.merchant], ['from phone', 'Supermarket']);
    assert.deepEqual(onMac, onPhone);
    assert.equal(phone.boot().conflicts.length, 1);
    assert.match(phone.boot().conflicts[0], /mac changed amount of "Supermarket" from "-99.00" to "-98.00"/);
    await phone.dismissConflicts();
    assert.deepEqual(phone.boot().conflicts, []);
});

test('connect refuses a repo that already has data; join refuses an empty one or a device with a project', async () => {
    const {app, remote} = await withProject();
    await app.connect(SYNC);
    const second = await newApp(remote);
    await second.app.createProject({name: 'B', currency: 'INR', decimals: 2});
    await assert.rejects(second.app.connect(SYNC), /already holds Fingeist data/);
    await assert.rejects(second.app.join(SYNC), /already has a project/);
    await assert.rejects((await newApp()).app.join(SYNC), /no Fingeist data yet/);
});

test('sync status: offline, paused on a rejected token, error otherwise; nothing is lost', async () => {
    const {app, remote} = await withProject();
    await app.connect(SYNC);
    await app.saveEntry(expense);
    remote.failNext(new TypeError('Failed to fetch'));
    assert.equal((await app.sync()).state, 'offline');
    remote.failNext(new AuthError('revoked'));
    assert.deepEqual([(await app.sync()).state, app.syncStatus().message], ['paused', 'revoked']);
    remote.failNext(new Error('500'));
    assert.equal((await app.sync()).state, 'error');
    assert.equal(app.syncStatus().pending, 3);
    assert.equal((await app.sync()).state, 'idle');
    assert.equal(app.syncStatus().pending, 0);
    assert.equal(app.sync(), app.sync(), 'concurrent calls share one run');
});

test('changing the passphrase keeps the data readable for new devices; erase clears only this device', async () => {
    const {app, remote, store, clock} = await withProject();
    await app.saveEntry(expense);
    await app.connect(SYNC);
    await app.changePassphrase('correct horse', 'battery staple', 1000);
    const phone = (await newApp(remote)).app;
    await phone.join({...SYNC, passphrase: 'battery staple'});
    assert.equal(phone.ledger().count, 1);
    await app.eraseDevice();
    assert.equal((await createApp({store, crypto, clock, makeRemote: () => remote})).boot().needsSetup, true);
    assert.ok(remote.files.has('vault.json'));
});
