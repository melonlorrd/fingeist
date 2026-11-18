// Turns merged change records into the book the screens and reports use. fields.js builds new
// records from form input with the same checks.

import {formatMoney, parseMoney} from './money.js';
import {live} from './state.js';
import {isDate, parseWhen} from './time.js';

const INTENTS = ['need', 'want', 'impulse'];
export const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DEFAULT_THRESHOLDS = ['100', '250', '500', '1000'];
const DEFAULT_WORKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const ACCOUNT_KINDS = ['own', 'person'];
const REPEATS = ['day', 'week', 'month', 'year'];
export const PROJECT_SETTINGS = 'project';
const COLOR = /^(#[0-9a-fA-F]{6})?$/;
const MAX_REDIRECTS = 32;

function text(value, field) {
    if (typeof value !== 'string') {
        throw new Error(`${field} must be text`);
    }
    return value;
}

export function requiredText(value, field) {
    const trimmed = text(value, field).trim();
    if (trimmed === '') {
        throw new Error(`${field} is required`);
    }
    return trimmed;
}

function bool(value) {
    return value === true;
}

function tags(value) {
    if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string')) {
        throw new Error('tags must be a list of text');
    }
    return value;
}

function positive(value, field, decimals) {
    const amount = parseMoney(text(value, field), decimals);
    if (amount <= 0n) {
        throw new Error(`${field} must be more than zero`);
    }
    return amount;
}

function parseIntent(value) {
    const intent = text(value ?? '', 'intent');
    if (intent !== '' && !INTENTS.includes(intent)) {
        throw new Error(`unknown intent "${intent}"`);
    }
    return intent;
}

// A negative part is a discount on your own share; a person's share is always positive.
function parsePart(part, decimals) {
    const person = text(part?.person ?? '', 'split person');
    const amount = person
        ? positive(part?.amount, 'a share with a person', decimals)
        : parseMoney(text(part?.amount, 'split amount'), decimals);
    if (amount === 0n) {
        throw new Error('a split part must not be zero');
    }
    return {
        category: text(part?.category ?? '', 'split category'),
        person,
        amount,
        intent: person ? '' : parseIntent(part?.intent),
        note: text(part?.note ?? '', 'item name'),
    };
}

function parseSplits(value, total, decimals) {
    if (value === undefined || (Array.isArray(value) && value.length === 0)) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new Error('splits must be a list');
    }
    const parts = value.map((part) => parsePart(part, decimals));
    const sum = parts.reduce((s, p) => s + p.amount, 0n);
    if (sum !== (total < 0n ? -total : total)) {
        throw new Error(
            `the split parts add up to ${formatMoney(sum, decimals)}, not ${formatMoney(total < 0n ? -total : total, decimals)}`,
        );
    }
    return parts;
}

/** A transaction from its fields. Category and account are ids, resolved later. Throws when malformed. */
export function parseTxn(id, data, decimals) {
    const when = parseWhen(text(data.time, 'time'));
    const amount = parseMoney(text(data.amount, 'amount'), decimals);
    if (amount === 0n) {
        throw new Error('amount must not be zero');
    }
    const intent = parseIntent(data.intent);
    const refund = amount > 0n && bool(data.refund);
    const splits = parseSplits(data.splits, amount, decimals).map((part) => (amount < 0n ? part : {...part, intent: ''}));
    if (refund && splits.some((part) => part.person)) {
        throw new Error('a refund cannot be shared with a person');
    }
    return {
        id,
        ...when,
        amount,
        refund,
        splits,
        account: requiredText(data.account, 'account'),
        category: text(data.category ?? '', 'category'),
        merchant: text(data.merchant ?? '', 'merchant'),
        note: text(data.note ?? '', 'note'),
        tags: tags(data.tags ?? []),
        intent: amount < 0n ? intent : '',
        recurring: text(data.recurring ?? '', 'recurring'),
    };
}

/** A transfer between two accounts from its fields. Throws when malformed. */
export function parseTransfer(id, data, decimals) {
    const when = parseWhen(text(data.time, 'time'));
    const amount = positive(data.amount, 'a transfer amount', decimals);
    const from = requiredText(data.from, 'from account');
    const to = requiredText(data.to, 'to account');
    if (from === to) {
        throw new Error('a transfer needs two different accounts');
    }
    return {id, ...when, amount, from, to, note: text(data.note ?? '', 'note'), recurring: text(data.recurring ?? '', 'recurring')};
}

export function parseCategory(id, data) {
    const color = text(data.color ?? '', 'color');
    if (!COLOR.test(color)) {
        throw new Error(`invalid colour "${color}"`);
    }
    return {
        id,
        name: requiredText(data.name, 'category name'),
        color: color.toLowerCase(),
        archived: bool(data.archived),
        mergedInto: text(data.mergedInto ?? '', 'merged into'),
    };
}

export function parseAccount(id, data, decimals) {
    const kind = data.kind ?? 'own';
    if (!ACCOUNT_KINDS.includes(kind)) {
        throw new Error(`unknown account kind "${kind}"`);
    }
    return {
        id,
        kind,
        name: requiredText(data.name, 'account name'),
        opening: parseMoney(text(data.opening ?? '0', 'opening balance'), decimals),
        archived: bool(data.archived),
        mergedInto: text(data.mergedInto ?? '', 'merged into'),
    };
}

function parseBudget(id, data, decimals) {
    return {category: id, amount: positive(data.amount, 'budget', decimals)};
}

export function parseRecurring(id, data, decimals) {
    const entry = data.entry;
    if (entry !== 'txn' && entry !== 'transfer') {
        throw new Error('a repeat must be of a transaction or a transfer');
    }
    if (!REPEATS.includes(data.every)) {
        throw new Error(`unknown repeat "${data.every}"`);
    }
    if (!isDate(data.start) || (data.until && !isDate(data.until))) {
        throw new Error('a repeat needs a start date, and an end date if any, as YYYY-MM-DD');
    }
    const template = data.template;
    if (!template || typeof template !== 'object') {
        throw new Error('a repeat needs a template');
    }
    (entry === 'txn' ? parseTxn : parseTransfer)(id, {...template, time: data.start}, decimals);
    return {id, entry, template, every: data.every, start: data.start, until: data.until ?? '', paused: bool(data.paused)};
}

export function parseThresholds(value, decimals) {
    if (!Array.isArray(value)) {
        throw new Error('thresholds must be a list');
    }
    const amounts = value.map((v) => positive(v, 'threshold', decimals));
    return [...new Set(amounts)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function parseWorkdays(value) {
    if (!Array.isArray(value) || value.some((d) => !DAY_NAMES.includes(d))) {
        throw new Error('workdays must be mon to sun');
    }
    return DAY_NAMES.flatMap((d, i) => (value.includes(d) ? [i] : []));
}

export function parseMonthStart(value) {
    if (!Number.isInteger(value) || value < 1 || value > 28) {
        throw new Error('the month start must be a day from 1 to 28');
    }
    return value;
}

/** Follows mergedInto to a live record; a dead end gives fallback(id). */
function resolver(records, fallback) {
    return (id) => {
        let current = id;
        for (let step = 0; step < MAX_REDIRECTS && records.has(current); step++) {
            const target = records.get(current).mergedInto;
            if (!target) {
                return current;
            }
            current = target;
        }
        return fallback(id);
    };
}

const byName = (a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1);

/** The kind of a line, from its transaction: spending, a refund against spending, income, or a share someone else owes. */
function lineKind(txn, person) {
    if (person) {
        return 'lent';
    }
    if (txn.amount < 0n) {
        return 'expense';
    }
    return txn.refund ? 'refund' : 'income';
}

/** The lines of a transaction, with category and person ids passed through the resolvers. */
function txnLines(txn, resolveCategory, resolveAccount) {
    const sign = txn.amount < 0n ? -1n : 1n;
    const parts =
        txn.splits.length > 0 ? txn.splits : [{category: txn.category, person: '', amount: txn.amount * sign, intent: '', note: ''}];
    return parts.map((part) => {
        const amount = part.amount * sign;
        const person = part.person ? resolveAccount(part.person) : '';
        const kind = lineKind(txn, person);
        return {
            amount,
            kind,
            person,
            category: person ? '' : resolveCategory(part.category),
            intent: kind === 'expense' ? part.intent || txn.intent : '',
            item: part.note,
            spend: kind === 'expense' || kind === 'refund' ? -amount : 0n,
        };
    });
}

/**
 * Everything the reports and screens need, from the merged changes and the vault meta.
 * @param {import('./types.js').Winners} winners
 * @param {import('./types.js').Meta} meta
 * @returns {import('./types.js').Book}
 */
export function buildBook(winners, meta) {
    const problems = [];
    const collect = (kind, parse) =>
        live(winners, kind).flatMap((record) => {
            try {
                return [parse(record.id, record.data, meta.decimals)];
            } catch (err) {
                problems.push({kind, id: record.id, device: record.device, message: err.message});
                return [];
            }
        });

    const settings = live(winners, 'setting').find((r) => r.id === PROJECT_SETTINGS)?.data ?? {};
    const setting = (field, parse, fallback) => {
        if (settings[field] === undefined) {
            return parse(fallback);
        }
        try {
            return parse(settings[field]);
        } catch (err) {
            problems.push({kind: 'setting', id: field, device: '', message: err.message});
            return parse(fallback);
        }
    };

    const allCategories = new Map(collect('category', parseCategory).map((c) => [c.id, c]));
    const allAccounts = new Map(collect('account', parseAccount).map((a) => [a.id, a]));
    const resolveCategory = resolver(allCategories, () => '');
    const resolveAccount = resolver(allAccounts, (id) => id);

    const txns = collect('txn', parseTxn).map((t) => {
        const account = resolveAccount(t.account);
        return {...t, account, category: resolveCategory(t.category), lines: txnLines(t, resolveCategory, resolveAccount)};
    });
    const transfers = collect('transfer', parseTransfer).map((x) => ({...x, from: resolveAccount(x.from), to: resolveAccount(x.to)}));
    const budgets = collect('budget', parseBudget)
        .map((b) => ({...b, category: resolveCategory(b.category)}))
        .filter((b) => b.category !== '');

    const project = {
        name: setting('name', (v) => requiredText(v, 'project name'), meta.name),
        currency: meta.currency,
        decimals: meta.decimals,
        thresholds: setting('thresholds', (v) => parseThresholds(v, meta.decimals), DEFAULT_THRESHOLDS),
        workdays: setting('workdays', parseWorkdays, DEFAULT_WORKDAYS),
        monthStart: setting('monthStart', parseMonthStart, 1),
        categories: [...allCategories.values()].filter((c) => !c.mergedInto).sort(byName),
        accounts: [...allAccounts.values()].filter((a) => !a.mergedInto).sort(byName),
        categoryById: allCategories,
        accountById: allAccounts,
    };
    return {
        project,
        txns,
        transfers,
        budgets,
        recurring: collect('recurring', parseRecurring),
        devices: Object.fromEntries(live(winners, 'device').map((r) => [r.id, typeof r.data.name === 'string' ? r.data.name : ''])),
        problems,
    };
}
