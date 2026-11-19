import {cycleOf} from '../time.js';
import {accountName, amountOf, byText, categoryColor, categoryName, compareBig, signedAmountOf, UNCATEGORIZED} from './amount.js';
import {transferEffect} from './totals.js';

const isIntent = (filter) => ['need', 'want', 'impulse'].includes(filter);

function rowsOf(txns, transfers) {
    return [...txns.map((t) => ({kind: 'txn', item: t})), ...transfers.map((x) => ({kind: 'transfer', item: x}))];
}

function categoryMatches(line, category) {
    return category === UNCATEGORIZED ? line.category === '' && !line.person : line.category === category;
}

function involves({kind, item}, account) {
    return kind === 'txn'
        ? item.account === account || item.lines.some((l) => l.person === account)
        : item.from === account || item.to === account;
}

function matches(row, project, q) {
    const {kind, item} = row;
    if (q.month && cycleOf(item.date, project.monthStart) !== q.month) {
        return false;
    }
    if ((q.from && item.date < q.from) || (q.to && item.date > q.to)) {
        return false;
    }
    if (q.account && !involves(row, q.account)) {
        return false;
    }
    if (q.category && (kind !== 'txn' || !item.lines.some((l) => categoryMatches(l, q.category)))) {
        return false;
    }
    const filter = q.filter || 'all';
    if (filter !== 'all' && (filter === 'transfer') !== (kind === 'transfer')) {
        return false;
    }
    if (['expense', 'income', 'refund'].includes(filter) && !item.lines.some((l) => l.kind === filter)) {
        return false;
    }
    if (isIntent(filter) && (kind === 'transfer' || !item.lines.some((l) => l.intent === filter))) {
        return false;
    }
    const needle = (q.search ?? '').trim().toLowerCase();
    return needle === '' || searchText(row, project).includes(needle);
}

function searchText({kind, item}, project) {
    const parts =
        kind === 'txn'
            ? [
                  item.merchant,
                  item.note,
                  accountName(project, item.account),
                  ...item.tags,
                  ...item.lines.map((l) => (l.person ? accountName(project, l.person) : categoryName(project, l.category))),
                  ...item.lines.map((l) => l.item),
              ]
            : [item.note, accountName(project, item.from), accountName(project, item.to)];
    return parts.join('\n').toLowerCase();
}

/** Newest first; within a day by instant, rows without a time last. */
function newestFirst(a, b) {
    if (a.item.date !== b.item.date) {
        return byText(b.item.date, a.item.date);
    }
    if (a.item.unknown || b.item.unknown) {
        return Number(a.item.unknown) - Number(b.item.unknown);
    }
    return b.item.instant - a.item.instant;
}

/** What a row adds to its day's total: income minus spending, plus transfers for the one account in view. */
function netOf({kind, item}, accounts) {
    if (kind === 'transfer') {
        return accounts ? transferEffect(item, accounts) : 0n;
    }
    return item.lines.reduce((sum, l) => sum + (l.kind === 'income' ? l.amount : -l.spend), 0n);
}

const MAX_ROW_CATEGORIES = 2;
const MAX_ROW_DOTS = 3;

/** The categories of a transaction's own lines, the one with the most money first; discounts count against theirs. */
function categoriesOf(lines) {
    const totals = new Map();
    for (const l of lines) {
        totals.set(l.category, (totals.get(l.category) ?? 0n) + l.amount);
    }
    const size = (amount) => (amount < 0n ? -amount : amount);
    return [...totals].sort((a, b) => compareBig(size(b[1]), size(a[1])) || byText(a[0], b[0])).map(([id]) => id);
}

/** "Food", or "Essentials, Snacks +2 · 9 items" for a bill with several items. */
function categoryText(project, ids, itemCount) {
    const names = ids
        .slice(0, MAX_ROW_CATEGORIES)
        .map((id) => categoryName(project, id))
        .join(', ');
    const more = ids.length > MAX_ROW_CATEGORIES ? ` +${ids.length - MAX_ROW_CATEGORIES}` : '';
    return itemCount > 1 ? `${names}${more} · ${itemCount} items` : names;
}

function txnView(t, project) {
    const spending = t.lines.filter((l) => !l.person);
    const categories = categoriesOf(spending);
    const shares = t.lines
        .filter((l) => l.person)
        .map((l) => `${accountName(project, l.person)} owes ${amountOf(l.amount < 0n ? -l.amount : l.amount, project).text}`);
    const payer = project.accountById.get(t.account);
    return {
        kind: 'txn',
        id: t.id,
        date: t.date,
        time: t.unknown ? '' : t.time.slice(11, 16),
        merchant: t.merchant,
        note: t.note,
        tags: t.tags,
        intents: [...new Set(t.lines.map((l) => l.intent).filter(Boolean))],
        category: categoryText(project, categories, spending.length),
        categoryColors: categories.slice(0, MAX_ROW_DOTS).map((id) => categoryColor(project, id)),
        account: payer?.kind === 'person' ? `Paid by ${payer.name}` : accountName(project, t.account),
        people: shares,
        refund: t.refund,
        split: t.splits.length > 0,
        recurring: t.recurring !== '',
        amount: signedAmountOf(t.amount, project),
        signed: true,
    };
}

function transferView(x, project, accounts) {
    return {
        kind: 'transfer',
        id: x.id,
        date: x.date,
        time: x.unknown ? '' : x.time.slice(11, 16),
        merchant: '',
        note: x.note,
        tags: [],
        intents: [],
        category: '',
        categoryColors: [],
        account: `${accountName(project, x.from)} → ${accountName(project, x.to)}`,
        people: [],
        refund: false,
        split: false,
        recurring: x.recurring !== '',
        amount: accounts ? signedAmountOf(transferEffect(x, accounts), project) : amountOf(x.amount, project),
        signed: Boolean(accounts),
    };
}

/**
 * The ledger filtered and grouped by day, newest first, with the spent and income totals of what
 * matches. limit caps the days returned; 0 is all.
 * @param {import('../types.js').Txn[]} txns
 * @param {import('../types.js').Transfer[]} transfers
 * @param {import('../types.js').Project} project
 * @param {{search?: string, month?: string, from?: string, to?: string, category?: string, account?: string, filter?: string, limit?: number}} [q]
 */
export function ledgerView(txns, transfers, project, q = {}) {
    const all = rowsOf(txns, transfers);
    const months = [...new Set(all.map((r) => cycleOf(r.item.date, project.monthStart)))].sort().reverse();
    const matching = all.filter((r) => matches(r, project, q)).sort(newestFirst);
    const accounts = q.account ? new Set([q.account]) : null;

    /** @type {{date: string, total: import('../types.js').Amount, rows: object[]}[]} */
    const days = [];
    let net = 0n;
    for (const row of matching) {
        let day = days.at(-1);
        if (!day || day.date !== row.item.date) {
            day = {date: row.item.date, total: amountOf(0n, project), rows: []};
            days.push(day);
            net = 0n;
        }
        net += netOf(row, accounts);
        day.total = signedAmountOf(net, project);
        day.rows.push(row.kind === 'txn' ? txnView(row.item, project) : transferView(row.item, project, accounts));
    }

    const lines = matching
        .filter((r) => r.kind === 'txn')
        .flatMap((r) => r.item.lines)
        .filter((l) => !q.category || categoryMatches(l, q.category))
        .filter((l) => !isIntent(q.filter) || l.intent === q.filter);
    const spent = lines.reduce((sum, l) => sum + l.spend, 0n);
    const income = lines.filter((l) => l.kind === 'income').reduce((sum, l) => sum + l.amount, 0n);

    const limit = q.limit ?? 0;
    return {
        days: limit > 0 ? days.slice(0, limit) : days,
        totalDays: days.length,
        months,
        count: matching.length,
        spent: amountOf(spent, project),
        income: amountOf(income, project),
        net: signedAmountOf(income - spent, project),
    };
}

/** Each account's current balance, own accounts first, then people (positive: they owe you). */
export function accountBalances(txns, transfers, project) {
    const balances = new Map(
        project.accounts.map((a) => [a.id, {id: a.id, name: a.name, kind: a.kind, archived: a.archived, balance: a.opening}]),
    );
    const move = (id, amount) => {
        const entry = balances.get(id) ?? {id, name: accountName(project, id), kind: 'own', archived: false, balance: 0n};
        entry.balance += amount;
        balances.set(id, entry);
    };
    for (const t of txns) {
        move(t.account, t.amount);
        for (const line of t.lines.filter((l) => l.person)) {
            move(line.person, -line.amount);
        }
    }
    for (const x of transfers) {
        move(x.from, -x.amount);
        move(x.to, x.amount);
    }
    return [...balances.values()]
        .sort((a, b) => Number(a.kind === 'person') - Number(b.kind === 'person') || a.name.localeCompare(b.name))
        .map((a) => ({...a, balance: amountOf(a.balance, project)}));
}
