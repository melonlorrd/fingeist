// Renders every screen and dialog in a fake DOM, with no data and with a full book, and checks that
// nothing throws and no "null", "undefined", "NaN" or "[object Object]" ever reaches the page.

import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';

import {Window} from 'happy-dom';

import {createApp} from '../core/app.js';
import {memoryRemote, memoryStore} from '../core/testing.js';

const BAD_TEXT = /\b(null|undefined|NaN)\b|\[object Object\]/;
const GLOBALS = [
    'window',
    'document',
    'navigator',
    'location',
    'HTMLElement',
    'HTMLInputElement',
    'HTMLDialogElement',
    'Element',
    'Node',
    'FormData',
    'Event',
    'KeyboardEvent',
    'MouseEvent',
    'getComputedStyle',
    'matchMedia',
    'ResizeObserver',
    'requestAnimationFrame',
];
const saved = {};
let page;

before(() => {
    page = new Window({url: 'http://localhost/', width: 390, height: 844});
    for (const name of GLOBALS) {
        saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
        Object.defineProperty(globalThis, name, {value: name === 'window' ? page : page[name], configurable: true, writable: true});
    }
    // Browsers print a null child as the text "null"; happy-dom drops it, so catch it where it's passed.
    for (const method of ['append', 'prepend', 'replaceChildren', 'before', 'after']) {
        for (const proto of [page.Element.prototype, page.DocumentFragment.prototype]) {
            const real = proto[method];
            proto[method] = function (...nodes) {
                const bad = nodes.findIndex((node) => node === null || node === undefined);
                if (bad !== -1) {
                    throw new Error(`${method}() got ${nodes[bad]} as argument ${bad + 1}; a browser would show it as text`);
                }
                return real.apply(this, nodes);
            };
        }
    }
    // Timers the shell starts (sync every few minutes, notices) must not keep the test process alive.
    for (const name of ['setTimeout', 'setInterval']) {
        const real = globalThis[name];
        saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
        globalThis[name] = (fn, ms) => {
            const timer = real(fn, ms);
            timer.unref?.();
            return timer;
        };
    }
});

after(async () => {
    for (const [name, descriptor] of Object.entries(saved)) {
        if (descriptor) {
            Object.defineProperty(globalThis, name, descriptor);
        } else {
            delete globalThis[name];
        }
    }
    await page.happyDOM.abort();
    page.close();
});

const clock = {
    now: () => ({ms: Date.UTC(2026, 10, 15, 4), date: '2026-11-15', clock: '09:30', offset: '+05:30'}),
    offsetAt: () => '+05:30',
};

const settle = async () => {
    for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setImmediate(resolve));
    }
};

function assertClean(where) {
    const error = [...document.querySelectorAll('.notice.error')].find((n) => !n.hasAttribute('hidden'));
    assert.equal(error, undefined, `${where} shows an error: ${error?.textContent}`);
    const text = document.body.textContent ?? '';
    const match = BAD_TEXT.exec(text);
    assert.equal(
        match,
        null,
        `${where} shows "${match?.[0]}" in: …${text.slice(Math.max(0, (match?.index ?? 0) - 60), (match?.index ?? 0) + 40)}…`,
    );
}

function buttons(text, root = document) {
    return [...root.querySelectorAll('button')].filter((b) => b.textContent?.trim() === text);
}

async function click(text, root = document) {
    const [button] = buttons(text, root);
    assert.ok(button, `no button "${text}"`);
    button.click();
    await settle();
}

const dialog = () => /** @type {HTMLDialogElement} */ (document.getElementById('dialog'));

async function closeDialog() {
    dialog().close();
    await settle();
}

async function start(app) {
    document.body.innerHTML = '<div id="app"></div><dialog id="dialog"></dialog>';
    const {startShell} = await import('./shell.js');
    startShell(app);
    await settle();
}

async function visitEverything(label) {
    for (const tab of ['Dashboard', 'Ledger', 'Accounts', 'Categories', 'Settings']) {
        await click(tab, document.querySelector('nav') ?? document);
        assertClean(`${label}: ${tab}`);
    }
    await click('Ledger', document.querySelector('nav') ?? document);
    await click('Add');
    assertClean(`${label}: add dialog`);
    for (const type of ['Income', 'Refund', 'Transfer', 'Expense']) {
        await click(type, dialog());
        assertClean(`${label}: add dialog as ${type}`);
    }
    await click('Split this', dialog());
    await click('Split with a person', dialog());
    await click('New category', dialog());
    assertClean(`${label}: split editor`);
    await closeDialog();
}

test('the setup screen', async () => {
    const app = await createApp({store: memoryStore(), crypto: globalThis.crypto, clock, makeRemote: () => memoryRemote()});
    await start(app);
    assert.match(document.body.textContent ?? '', /Start a new project/);
    assertClean('setup');
});

test('every screen and dialog with an empty project', async () => {
    const app = await createApp({store: memoryStore(), crypto: globalThis.crypto, clock, makeRemote: () => memoryRemote()});
    await app.createProject({name: 'Home', currency: 'INR', decimals: 2});
    await start(app);
    await visitEverything('empty');
});

test('every screen and dialog with a full book', async () => {
    const app = await createApp({store: memoryStore(), crypto: globalThis.crypto, clock, makeRemote: () => memoryRemote()});
    await app.createProject({name: 'Home', currency: 'INR', decimals: 2});
    const base = {
        type: 'expense',
        account: 'new:Cash',
        merchant: 'Market',
        note: '',
        tags: '',
        intent: 'need',
        date: '2026-11-14',
        clock: '09:30',
    };
    await app.saveEntry({...base, amount: '120', category: 'new:Food'});
    await app.saveEntry({...base, amount: '80', category: 'new:Snacks', clock: ''});
    await app.saveEntry({
        ...base,
        amount: '600',
        merchant: 'Dinner',
        splits: [
            {category: 'new:Food', amount: '200'},
            {person: 'new:Rahul', amount: '400'},
        ],
    });
    await app.saveEntry({...base, type: 'refund', amount: '20', category: 'new:Food', date: '2026-11-15'});
    await app.saveEntry({...base, type: 'income', amount: '50000', category: '', merchant: 'Salary', date: '2026-11-01'});
    await app.saveEntry({type: 'transfer', amount: '500', from: 'new:Bank', to: 'new:Cash', note: 'ATM', date: '2026-11-13', clock: ''});
    await app.saveEntry({
        ...base,
        amount: '15000',
        merchant: 'Rent',
        category: 'new:Home',
        date: '2026-10-01',
        clock: '',
        repeat: {every: 'month'},
    });
    const ids = Object.fromEntries([...app.boot().categories, ...app.boot().accounts].map((x) => [x.name, x.id]));
    await app.setBudget(ids.Food, '3000');
    await app.mergeCategory(ids.Snacks, ids.Food);
    await start(app);
    await visitEverything('full');

    await click('Ledger', document.querySelector('nav') ?? document);
    const options = (label) => [...document.querySelectorAll(`main select[aria-label="${label}"] option`)].map((o) => o.textContent);
    assert.ok(options('Category').includes('Food'), `ledger category filter lists: ${options('Category')}`);
    assert.ok(options('Account').includes('Cash'), `ledger account filter lists: ${options('Account')}`);
    const firstRow = () => /** @type {HTMLButtonElement} */ (document.querySelector('button.row'));
    firstRow().click();
    await settle();
    assertClean('full: edit dialog');
    await click('Add again', dialog());
    assertClean('full: add again dialog');
    await closeDialog();
    const before = app.ledger().count;
    firstRow().click();
    await settle();
    await click('Delete', dialog());
    assert.equal(app.ledger().count, before - 1);
    await click('Undo');
    assert.equal(app.ledger().count, before);
    await click('Select');
    firstRow().click();
    await settle();
    assert.match(document.body.textContent ?? '', /1 selected/);
    assertClean('full: selecting');
    await click('Accounts', document.querySelector('nav') ?? document);
    const rahul = [...document.querySelectorAll('button.row')].find((b) => b.textContent?.includes('Rahul'));
    assert.ok(rahul, 'no row for Rahul');
    rahul.click();
    await settle();
    assertClean('full: person dialog');
    await click('Settle up', dialog());
    assertClean('full: settle up');
    await closeDialog();
    await click('Categories', document.querySelector('nav') ?? document);
    /** @type {HTMLButtonElement} */ (document.querySelector('button.row')).click();
    await settle();
    assertClean('full: category dialog');
    await closeDialog();
});
