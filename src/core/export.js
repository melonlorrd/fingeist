// Readable copies of the data for the user to keep: everything as JSON, and the ledger as CSV.

import {formatMoney} from './money.js';
import {accountName, categoryName} from './report/amount.js';
import {KINDS, live} from './state.js';

/** Every live record, decrypted, grouped by kind. */
export function exportJson(winners, meta) {
    const records = Object.fromEntries(KINDS.map((kind) => [kind, live(winners, kind).map((r) => ({id: r.id, ...r.data}))]));
    return `${JSON.stringify({app: 'fingeist', format: 1, meta, records}, null, 2)}\n`;
}

const HEADER = ['id', 'date', 'time', 'type', 'amount', 'account', 'to_account', 'category', 'merchant', 'note', 'tags', 'intent'];

function cell(value) {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One row per transaction line and per transfer, oldest first, with names instead of ids. */
export function exportCsv(book) {
    const {project} = book;
    const money = (minor) => formatMoney(minor, project.decimals);
    const clock = (t) => (t.unknown ? '' : t.time.slice(11, 16));
    const rows = [
        ...book.txns.flatMap((t) =>
            t.lines.map((l) => [
                t.id,
                t.date,
                clock(t),
                l.kind,
                money(l.amount),
                accountName(project, t.account),
                l.person ? accountName(project, l.person) : '',
                l.person ? '' : categoryName(project, l.category),
                t.merchant,
                t.note,
                t.tags.join(';'),
                t.intent,
            ]),
        ),
        ...book.transfers.map((x) => [
            x.id,
            x.date,
            clock(x),
            'transfer',
            money(x.amount),
            accountName(project, x.from),
            accountName(project, x.to),
            '',
            '',
            x.note,
            '',
            '',
        ]),
    ].sort((a, b) => (a[1] + a[2] < b[1] + b[2] ? -1 : a[1] + a[2] > b[1] + b[2] ? 1 : 0));
    return `${[HEADER, ...rows].map((row) => row.map(cell).join(',')).join('\n')}\n`;
}
