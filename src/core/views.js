// What the screens read: the boot data on every screen, the dashboard, the ledger, and exports.

import {exportCsv, exportJson} from './export.js';
import {formatMoney} from './money.js';
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
import {liveRecord} from './state.js';

/** @param {import('./workspace.js').Workspace} ws */
export function viewsApi(ws) {
    const {local, book} = ws;

    function conflictText(c) {
        const record = liveRecord(book.winners, c.kind, c.id);
        const label = record?.merchant || record?.name || record?.note || c.kind;
        const value = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
        return `${ws.view().devices[c.by] || 'Another device'} changed ${c.field} of "${label}" from "${value(c.mine)}" to "${value(c.theirs)}".`;
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
                    ...b.problems.map((p) => `A ${p.kind} record (${p.id}) can't be read: ${p.message}`),
                    ...book.fileProblems.map((p) => `${p.path}${p.line ? `, line ${p.line}` : ''}: ${p.message}`),
                ],
                conflicts: book.conflicts.map(conflictText),
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
        dismissConflicts: () => book.dismissConflicts(),
    };
}
