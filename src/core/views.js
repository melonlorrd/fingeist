// What the screens read: the boot data on every screen, the dashboard, the ledger, and exports.

import {exportCsv, exportJson} from './export.js';
import {displayMoney, formatMoney, parseMoney} from './money.js';
import {DAY_NAMES} from './records.js';
import {
    accountBalances,
    accountName,
    budgetStatus,
    CHARTS,
    categoryName,
    ledgerView,
    makeScope,
    presetRange,
    runAll,
    summarize,
    validateScope,
} from './report/index.js';
import {filterAccount} from './report/lines.js';
import {liveRecord, recordState} from './state.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const RECORD_NOUNS = {
    transfer: 'Transfer',
    category: 'Category',
    account: 'Account',
    recurring: 'Repeat',
    setting: 'Settings',
    device: 'Device',
};
const INTENT_WORDS = {need: 'Need', want: 'Want', impulse: 'Impulse'};
const FIELD_LABELS = {
    amount: 'Amount',
    time: 'Date and time',
    account: 'Account',
    from: 'From account',
    to: 'To account',
    category: 'Category',
    merchant: 'Merchant',
    note: 'Note',
    tags: 'Tags',
    intent: 'Intent',
    refund: 'Refund',
    splits: 'Items',
    name: 'Name',
    color: 'Colour',
    archived: 'Archived',
    mergedInto: 'Merged into',
    opening: 'Opening balance',
    kind: 'Kind',
    thresholds: 'Small purchase thresholds',
    monthStart: 'Month start day',
    every: 'Repeats',
    until: 'Until',
    paused: 'Paused',
};

/** @param {import('./workspace.js').Workspace} ws */
export function viewsApi(ws) {
    const {local, book} = ws;

    // What a note says about a record: what kind of thing it is and its name, from its values now or before it was deleted.
    function recordTitle(kind, values, project) {
        const name = String(values.merchant || values.name || values.note || '');
        const noun =
            kind === 'txn'
                ? String(values.amount ?? '').startsWith('-')
                    ? 'Expense'
                    : values.refund
                      ? 'Refund'
                      : 'Income'
                : kind === 'budget'
                  ? `Budget for ${categoryName(project, String(values.category ?? ''))}`
                  : (RECORD_NOUNS[kind] ?? 'Record');
        return name ? `${noun} "${name}"` : noun;
    }

    // A field's value as the screens show it: names for ids, amounts with the currency, and plain words for the rest.
    function fieldValue(kind, field, value, project) {
        const money = (v) => {
            try {
                return displayMoney(parseMoney(String(v), local.meta.decimals), local.meta.currency, local.meta.decimals);
            } catch {
                return String(v);
            }
        };
        if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
            return field === 'category' ? categoryName(project, '') : 'none';
        }
        switch (field) {
            case 'amount':
            case 'opening':
                return money(value);
            case 'category':
                return categoryName(project, String(value));
            case 'account':
            case 'from':
            case 'to':
                return accountName(project, String(value));
            case 'mergedInto':
                return kind === 'category' ? categoryName(project, String(value)) : accountName(project, String(value));
            case 'splits':
                return Array.isArray(value) ? `${value.length} ${value.length === 1 ? 'item' : 'items'}` : String(value);
            case 'tags':
                return Array.isArray(value) ? value.join(', ') : String(value);
            case 'intent':
                return INTENT_WORDS[String(value)] ?? String(value);
            case 'thresholds':
                return Array.isArray(value) ? value.map(money).join(', ') : String(value);
            default:
                return typeof value === 'boolean' ? (value ? 'Yes' : 'No') : typeof value === 'string' ? value : JSON.stringify(value);
        }
    }

    /** The notes about changes from other devices, one per record, newest last. */
    function conflictsView() {
        const project = ws.view().project;
        /** @type {Map<string, import('./book.js').Conflict[]>} */
        const byRecord = new Map();
        for (const c of book.conflicts) {
            const key = `${c.kind}:${c.id}`;
            byRecord.set(key, [...(byRecord.get(key) ?? []), c]);
        }
        return [...byRecord.values()].map((notes) => {
            const {kind, id} = notes[0];
            const last = notes[notes.length - 1];
            const state = recordState(book.winners, kind, id);
            const deleted = notes.findLast((n) => n.type === 'deleted');
            const live = Boolean(state?.live);
            const values = (live ? state?.values : deleted?.values) ?? state?.values ?? {};
            /** @type {Map<string, {label: string, mine: string, theirs: string, time: boolean}>} */
            const changes = new Map();
            // A field changed more than once reads as one change: from this device's value to the latest one.
            for (const n of notes.filter((n) => (n.type ?? 'changed') === 'changed' && n.field)) {
                const field = String(n.field);
                const earlier = changes.get(field);
                changes.set(field, {
                    label: FIELD_LABELS[field] ?? field,
                    mine: earlier ? earlier.mine : fieldValue(kind, field, n.mine, project),
                    theirs: fieldValue(kind, field, n.theirs, project),
                    time: field === 'time',
                });
            }
            return {
                kind,
                id,
                title: recordTitle(kind, values, project),
                by: ws.view().devices[last.by] || 'Another device',
                type: !live && deleted ? 'deleted' : notes.some((n) => n.type === 'restored') ? 'restored' : 'changed',
                changes: [...changes.values()],
                canOpen: live && (kind === 'txn' || kind === 'transfer'),
                canRestore: !live && Boolean(deleted?.values),
            };
        });
    }

    function accountsView(b) {
        const plain = (minor) => formatMoney(minor < 0n ? -minor : minor, ws.decimals());
        return accountBalances(b.txns, b.transfers, b.project).map((a) => {
            const record = b.project.accountById.get(a.id);
            return {
                ...a,
                listed: Boolean(record),
                opening: formatMoney(record?.opening ?? 0n, ws.decimals()),
                settle: plain(a.balance.minor),
                owes: a.kind !== 'person' || a.balance.minor === 0n ? '' : a.balance.minor > 0n ? 'owes-you' : 'you-owe',
            };
        });
    }

    function mergedView(b) {
        return {
            categories: [...b.project.categoryById.values()]
                .filter((c) => c.mergedInto)
                .map((c) => ({id: c.id, name: c.name, into: categoryName(b.project, c.mergedInto)})),
            accounts: [...b.project.accountById.values()]
                .filter((a) => a.mergedInto)
                .map((a) => ({id: a.id, name: a.name, into: accountName(b.project, a.mergedInto)})),
        };
    }

    function repeatsView(b) {
        return b.recurring.map((r) => ({
            id: r.id,
            entry: r.entry,
            every: r.every,
            start: r.start,
            until: r.until,
            paused: r.paused,
            label: r.template.merchant || r.template.note || (r.entry === 'transfer' ? 'Transfer' : 'Untitled'),
            amount: r.template.amount,
        }));
    }

    return {
        /** Everything the screens need about the project, read once per redraw. */
        bootData() {
            const b = ws.view();
            const budgets = new Map(b.budgets.map((x) => [x.category, formatMoney(x.amount, ws.decimals())]));
            return {
                needsSetup: false,
                projectName: b.project.name,
                currency: local.meta.currency,
                categories: b.project.categories.map((c) => ({...c, budget: budgets.get(c.id) ?? ''})),
                merged: mergedView(b),
                accounts: accountsView(b),
                lastAccount: local.lastAccount ?? '',
                settings: {
                    name: b.project.name,
                    currency: local.meta.currency,
                    thresholds: b.project.thresholds.map((t) => formatMoney(t, ws.decimals())),
                    workdays: b.project.workdays.map((d) => DAY_NAMES[d]),
                    monthStart: b.project.monthStart,
                },
                budgets: budgetStatus(b, ws.today()),
                recurring: repeatsView(b),
                now: ws.clock.now(),
                today: ws.today(),
                problems: [
                    ...b.problems.map((p) => ({
                        text: `${recordTitle(p.kind, liveRecord(book.winners, p.kind, p.id) ?? {}, b.project)} can't be shown: ${p.message}.`,
                        kind: p.kind,
                        id: p.id,
                        canFix: p.kind === 'txn' || p.kind === 'transfer',
                    })),
                    ...book.fileProblems.map((p) => ({
                        text: `${p.path}${p.line ? `, line ${p.line}` : ''}: ${p.message}`,
                        kind: '',
                        id: '',
                        canFix: false,
                    })),
                ],
                conflicts: conflictsView(),
                clockWarnings: Object.entries(book.clockAhead).map(([device, ms]) => {
                    const days = Math.max(1, Math.round(ms / DAY_MS));
                    return `The clock on ${ws.view().devices[device] || 'another device'} is ${days === 1 ? '1 day' : `${days} days`} ahead of this one. Until it is fixed, its edits win over ones made at the same time on your other devices. Check its date and time settings.`;
                }),
            };
        },

        presetRange: (name) => presetRange(name, ws.today(), ws.view().project.monthStart),

        dashboard({from = '', to = '', account = ''} = {}) {
            ws.requireProject();
            const scope = makeScope({from, to, account, today: ws.today()});
            validateScope(scope);
            const b = ws.view();
            return {summary: summarize(filterAccount(scope, b.txns), b.project, scope), charts: runAll(CHARTS, b, scope)};
        },

        ledger(query = {}) {
            ws.requireProject();
            const b = ws.view();
            return ledgerView(b.txns, b.transfers, b.project, query);
        },

        exportJson: () => exportJson(book.winners, local.meta),
        exportCsv: () => exportCsv(ws.view()),
        /** Forgets the notes about one record, or every note when no record is given. */
        dismissConflicts: (kind = '', id = '') => book.dismissConflicts(kind, id),

        /** Brings back a record another device deleted while it was being edited here, with the values it had. */
        async restoreDeleted(kind, id) {
            const deleted = book.conflicts.findLast((c) => c.kind === kind && c.id === id && c.type === 'deleted');
            if (!deleted?.values) {
                throw new Error('There is nothing to restore');
            }
            await ws.put(/** @type {import('./types.js').Kind} */ (kind), id, deleted.values);
            await book.dismissConflicts(kind, id);
        },
    };
}
