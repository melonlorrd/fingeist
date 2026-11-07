import './style.css';

import {
    AddTransaction, CheckForChanges, CreateProject, DeleteTransaction, RetrySave, State, UpdateTransaction,
} from '../wailsjs/go/main/App';

import {renderCharts} from './charts.js';
import {el} from './dom.js';
import {renderSetup} from './setup.js';
import {renderTransactions} from './transactions.js';

const app = document.getElementById('app');

const fromInput = el('input', {type: 'date', onchange: refresh});
const toInput = el('input', {type: 'date', onchange: refresh});
const title = el('h1', {}, 'El Costas');
const rangeBar = el('div', {className: 'range'},
    el('label', {}, 'From ', fromInput),
    el('label', {}, 'To ', toInput),
    el('button', {onclick: () => { fromInput.value = ''; toInput.value = ''; refresh(); }}, 'All time'),
);
const notice = el('div', {className: 'notice', role: 'status', hidden: true});
const problems = el('section', {className: 'notice error', hidden: true});
const chartsSection = el('section', {className: 'charts'});
const transactionsSection = el('section', {className: 'transactions'});
const setupSection = el('section', {hidden: true});

app.append(
    el('header', {}, title, rangeBar),
    notice, problems, setupSection, chartsSection, transactionsSection,
);

function showNotice(text, isError = false) {
    notice.textContent = text;
    notice.classList.toggle('error', isError);
    notice.hidden = !text;
}

function errorText(err) {
    return String(err?.message ?? err);
}

let lastSaveError = '';

async function failed(err) {
    lastSaveError = errorText(err);
    const state = await refresh();
    if (!state?.unsaved) {
        showNotice(lastSaveError, true);
    }
    return state;
}

async function refresh() {
    let state;
    try {
        state = await State(fromInput.value, toInput.value);
    } catch (err) {
        showNotice(errorText(err), true);
        return null;
    }
    render(state);
    return state;
}

function render(state) {
    const ready = !state.needsSetup;
    rangeBar.hidden = !ready;
    setupSection.hidden = ready;
    chartsSection.hidden = !ready;
    transactionsSection.hidden = !ready;
    if (!ready) {
        renderSetup(setupSection, createProject);
        return;
    }

    title.textContent = state.projectName;
    renderMalformedRows(state.problems ?? []);
    renderUnsaved(state.unsaved);
    renderCharts(chartsSection, state.charts);
    renderTransactions(transactionsSection, state, {onSave: saveTransaction, onDelete: deleteTransaction});
}

function renderMalformedRows(list) {
    problems.hidden = list.length === 0;
    problems.replaceChildren(...(list.length === 0 ? [] : [
        el('strong', {}, 'Some rows in transactions.csv cannot be read. Fix them in the file; editing is disabled until then.'),
        el('ul', {}, list.map((p) => el('li', {}, `Line ${p.line}: ${p.message}`))),
    ]));
}

function renderUnsaved(unsaved) {
    if (!unsaved) {
        return;
    }
    notice.replaceChildren(
        `Could not write transactions.csv (${lastSaveError}). Your changes are kept in the app. Close any program that has the file open, then `,
        el('button', {onclick: retrySave}, 'try again'),
    );
    notice.classList.add('error');
    notice.hidden = false;
}

async function createProject(name, currency, decimals, categories) {
    try {
        await CreateProject(name, currency, decimals, categories);
    } catch (err) {
        return errorText(err);
    }
    await refresh();
    return '';
}

async function saveTransaction(fields, isNew) {
    showNotice('');
    try {
        await (isNew ? AddTransaction(fields) : UpdateTransaction(fields));
    } catch (err) {
        const state = await failed(err);
        return state?.unsaved ? '' : errorText(err);
    }
    await refresh();
    return '';
}

async function deleteTransaction(row) {
    if (!confirm(`Delete the ${row.merchant || 'transaction'} on ${row.time.slice(0, 10)} (${row.amount})?`)) {
        return;
    }
    showNotice('');
    try {
        await DeleteTransaction(row.id);
    } catch (err) {
        await failed(err);
        return;
    }
    await refresh();
}

async function retrySave() {
    showNotice('');
    try {
        await RetrySave();
    } catch (err) {
        await failed(err);
        return;
    }
    await refresh();
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
        showNotice('transactions.csv was changed outside the app, so it was reloaded.');
    }
}

window.addEventListener('focus', checkForChanges);
refresh();
