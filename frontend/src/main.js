import './style.css';

import {Bootstrap, CheckForChanges, CreateProject, RetrySave} from '../bindings/fingeist/app.js';
import {Events} from '@wailsio/runtime';

import * as categories from './categories.js';
import * as dashboard from './dashboard.js';
import {el, fill} from './dom.js';
import * as ledger from './ledger.js';
import * as portfolio from './portfolio.js';
import * as settings from './settings.js';
import {renderSetup} from './setup.js';

const views = {
    dashboard: {label: 'Dashboard', render: dashboard.render},
    ledger: {label: 'Ledger', render: ledger.render},
    portfolio: {label: 'Portfolio', render: portfolio.render},
    categories: {label: 'Categories', render: categories.render},
    settings: {label: 'Settings', render: settings.render},
};

const NOTICE_WITH_ACTION_MS = 8000;

let boot = null;
let activeTab = 'dashboard';
let renderedTab = null;
let renderToken = 0;
let lastSaveError = '';
let noticeTimer;

const title = el('span', {className: 'brand'}, 'Fingeist');
const nav = el('nav', {className: 'pills', 'aria-label': 'Sections'});
const notice = el('div', {className: 'notice', role: 'status', hidden: true});
const banner = el('div', {});
const view = el('main', {});
document.getElementById('app').append(
    el('div', {className: 'topbar'}, el('div', {className: 'topbar-inner'}, title, nav)),
    el('div', {className: 'page'}, notice, banner, view),
);

const ctx = {
    get boot() { return boot; },
    perform,
    notify: showNotice,
    rerender: renderView,
    refresh,
};

// An optional action ({label, run}) adds a button and makes the notice disappear after a few seconds.
function showNotice(text, isError = false, action = null) {
    clearTimeout(noticeTimer);
    fill(notice, text, action ? el('button', {onclick: () => { showNotice(''); action.run(); }}, action.label) : null);
    notice.classList.toggle('error', isError);
    notice.hidden = !text;
    if (action) {
        noticeTimer = setTimeout(() => showNotice(''), NOTICE_WITH_ACTION_MS);
    }
}

function errorText(err) {
    return String(err?.message ?? err);
}

// Runs a change, then redraws. Returns an error message to show next to the form, or '' when it worked
// or when the change is kept in memory pending a retry (the banner explains that).
async function perform(change) {
    showNotice('');
    try {
        await change();
    } catch (err) {
        lastSaveError = errorText(err);
        const fresh = await refresh();
        return fresh && (fresh.unsaved || fresh.holdingsUnsaved) ? '' : lastSaveError;
    }
    await refresh();
    return '';
}

async function refresh() {
    try {
        boot = await Bootstrap();
    } catch (err) {
        showNotice(errorText(err), true);
        return null;
    }
    renderChrome();
    if (boot.needsSetup) {
        dashboard.disposeCharts();
        renderSetup(view, createProject);
    } else {
        await renderView();
    }
    return boot;
}

function renderChrome() {
    title.textContent = boot.needsSetup ? 'Fingeist' : boot.projectName;
    nav.hidden = boot.needsSetup;
    nav.replaceChildren(...(boot.needsSetup ? [] : Object.entries(views).map(([key, v]) => el('button', {
        className: key === activeTab ? 'active' : '',
        'aria-current': key === activeTab ? 'page' : 'false',
        onclick: () => showTab(key),
    }, v.label))));

    const problems = [
        ...(boot.problems ?? []).map((p) => `transactions.csv, line ${p.line}: ${p.message}`),
        ...(boot.holdingProblems ?? []).map((p) => `holdings.csv, line ${p.line}: ${p.message}`),
    ];
    fill(banner,
        problems.length === 0 ? null : el('section', {className: 'notice error'},
            el('strong', {}, 'Some rows cannot be read. Fix them in the file; editing is disabled until then.'),
            el('ul', {}, problems.map((text) => el('li', {}, text)))),
        boot.unsaved || boot.holdingsUnsaved ? el('section', {className: 'notice error'},
            `Could not write the file (${lastSaveError}). Your changes are kept in the app. Close any program that has the file open, then `,
            el('button', {onclick: retrySave}, 'try again')) : null,
    );
}

async function showTab(name) {
    if (activeTab === name) {
        return;
    }
    activeTab = name;
    renderChrome();
    await renderView();
}

// Draws into a detached element first, so a slow view cannot overwrite a newer one. Redrawing the
// same tab keeps the scroll position and the focused field.
async function renderView() {
    const token = ++renderToken;
    const restore = renderedTab === activeTab ? rememberPosition() : null;
    dashboard.disposeCharts();
    const container = el('div', {});
    try {
        await views[activeTab].render(container, ctx);
    } catch (err) {
        showNotice(errorText(err), true);
        return;
    }
    if (token === renderToken) {
        view.replaceChildren(container);
        renderedTab = activeTab;
        if (restore) {
            restore();
        } else {
            window.scrollTo(0, 0);
        }
    }
}

function rememberPosition() {
    const scrollY = window.scrollY;
    const active = document.activeElement;
    const tag = active?.tagName;
    const key = active && view.contains(active) ? (active.getAttribute('aria-label') || active.name) : null;
    const selection = typeof active?.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
    return () => {
        window.scrollTo(0, scrollY);
        const target = key && [...view.querySelectorAll(tag)].find((node) => (node.getAttribute('aria-label') || node.name) === key);
        if (target) {
            target.focus();
            if (selection) {
                target.setSelectionRange(...selection);
            }
        }
    };
}

async function createProject(name, currency, decimals, categoryNames) {
    try {
        await CreateProject(name, currency, decimals, categoryNames);
    } catch (err) {
        return errorText(err);
    }
    await refresh();
    return '';
}

async function retrySave() {
    const error = await perform(RetrySave);
    if (error) {
        showNotice(error, true);
    }
}

async function checkForChanges() {
    let changed;
    try {
        changed = await CheckForChanges();
    } catch (err) {
        showNotice(errorText(err), true);
        return;
    }
    if (changed) {
        await refresh();
        showNotice('A file was changed outside the app, so it was reloaded.');
    }
}

function dialogOpen() {
    return document.getElementById('dialog').hasAttribute('open');
}

function canUseShortcuts() {
    return boot && !boot.needsSetup && !dialogOpen();
}

async function newTransaction() {
    if (canUseShortcuts()) {
        await showTab('ledger');
        ledger.openTransactionForm(ctx, null);
    }
}

async function focusSearch() {
    if (canUseShortcuts()) {
        await showTab('ledger');
        document.querySelector('input[type=search]')?.focus();
    }
}

function isTextEntry(node) {
    return node instanceof HTMLElement && (node.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName));
}

window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        newTransaction();
    } else if (event.key === '/' && !isTextEntry(event.target)) {
        event.preventDefault();
        focusSearch();
    }
});

try {
    Events.On('new-transaction', () => newTransaction());
} catch {
    // Outside Wails (a plain browser) there is no native menu to listen to.
}

// Charts read their colours when drawn, so draw again when the system switches between light and dark.
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (boot && !boot.needsSetup) {
        renderView();
    }
});

window.addEventListener('focus', checkForChanges);
refresh();
