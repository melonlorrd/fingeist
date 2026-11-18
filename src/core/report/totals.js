import {basisPoints, formatBasisPoints} from '../money.js';
import {addDays, addMonths, cycleOf, daysBetween, mondayFirst, weekdayOf} from '../time.js';
import {amountOf, byText, categoryColor, categoryName, compareBig, maxBig} from './amount.js';
import {expenseTxns, linesOf, spendingLines} from './lines.js';
import {bounds, filterRange} from './scope.js';

function monthSpan(months) {
    if (months.length === 0) {
        return [];
    }
    const sorted = [...months].sort();
    const span = [];
    for (let m = sorted[0]; m <= sorted.at(-1); m = addMonths(m, 1)) {
        span.push(m);
    }
    return span;
}

export function monthlyTotals(txns, project) {
    /** @type {Map<string, {income: bigint, expenses: bigint}>} */
    const sums = new Map();
    const month = (date) => cycleOf(date, project.monthStart);
    for (const line of linesOf(txns)) {
        const s = sums.get(month(line.date)) ?? {income: 0n, expenses: 0n};
        if (line.kind === 'income') {
            s.income += line.amount;
        }
        s.expenses += line.spend;
        sums.set(month(line.date), s);
    }
    return monthSpan(txns.map((t) => month(t.date))).map((m) => {
        const s = sums.get(m) ?? {income: 0n, expenses: 0n};
        return {
            month: m,
            income: amountOf(s.income, project),
            expenses: amountOf(s.expenses, project),
            net: amountOf(s.income - s.expenses, project),
        };
    });
}

/** @returns {Map<string, bigint>} */
function sumByCategory(lines) {
    /** @type {Map<string, bigint>} */
    const spent = new Map();
    for (const line of lines) {
        spent.set(line.category, (spent.get(line.category) ?? 0n) + line.spend);
    }
    return spent;
}

/** Categories by what was spent on them, largest first; categories netting to zero are left out. */
export function rankCategories(spent, project) {
    return [...spent]
        .filter(([, total]) => total !== 0n)
        .map(([id, total]) => ({
            category: id,
            name: categoryName(project, id),
            color: categoryColor(project, id),
            spent: amountOf(total, project),
        }))
        .sort((a, b) => compareBig(b.spent.minor, a.spent.minor) || byText(a.name, b.name));
}

export function byCategory(txns, project) {
    return rankCategories(sumByCategory(spendingLines(txns)), project);
}

export function dailySpending(txns, project) {
    /** @type {Map<string, bigint>} */
    const spent = new Map();
    for (const line of spendingLines(txns)) {
        spent.set(line.date, (spent.get(line.date) ?? 0n) + line.spend);
    }
    const days = [...spent]
        .filter(([, total]) => total > 0n)
        .map(([date, total]) => ({date, spent: amountOf(total, project)}))
        .sort((a, b) => byText(a.date, b.date));
    const peak = days.reduce((max, d) => maxBig(max, d.spent.minor), 0n);
    const from = days[0]?.date ?? '';
    const to = days.at(-1)?.date ?? '';
    return {days, from, to, weeks: from ? weekColumns(from, to) : 0, max: amountOf(peak, project)};
}

// Monday-first calendar columns from the week holding `from` to the week holding `to`.
function weekColumns(from, to) {
    const span = mondayFirst(weekdayOf(from)) + daysBetween(from, to);
    return (span - (span % 7)) / 7 + 1;
}

/** The own accounts a balance covers: the one in view, or every own account. */
function balanceAccounts(project, account) {
    if (account !== '') {
        return new Set([account]);
    }
    return new Set(project.accounts.filter((a) => a.kind === 'own').map((a) => a.id));
}

/** How a transfer moves the accounts in view. */
export function transferEffect(transfer, accounts) {
    return (accounts.has(transfer.to) ? transfer.amount : 0n) - (accounts.has(transfer.from) ? transfer.amount : 0n);
}

/** The balance at the end of each day of the range: opening balances plus every move in or out of the accounts in view. */
export function runningBalance(allTxns, transfers, project, scope) {
    const accounts = balanceAccounts(project, scope.account);
    const moves = [
        ...allTxns.filter((t) => accounts.has(t.account)).map((t) => ({date: t.date, amount: t.amount})),
        ...linesOf(allTxns)
            .filter((l) => accounts.has(l.person))
            .map((l) => ({date: l.date, amount: -l.amount})),
        ...transfers.map((x) => ({date: x.date, amount: transferEffect(x, accounts)})).filter((m) => m.amount !== 0n),
    ];
    const {start, end, ok} = bounds(scope, moves);
    if (!ok) {
        return [];
    }
    const latest = moves.reduce((max, m) => (m.date > max ? m.date : max), scope.today);
    const last = end < latest ? end : latest;

    let balance = project.accounts.filter((a) => accounts.has(a.id)).reduce((sum, a) => sum + a.opening, 0n);
    /** @type {Map<string, bigint>} */
    const netByDay = new Map();
    for (const m of moves) {
        if (m.date < start) {
            balance += m.amount;
        } else {
            netByDay.set(m.date, (netByDay.get(m.date) ?? 0n) + m.amount);
        }
    }
    const points = [];
    for (let date = start; date <= last; date = addDays(date, 1)) {
        balance += netByDay.get(date) ?? 0n;
        points.push({date, balance: amountOf(balance, project)});
    }
    return points;
}

export function intentTrends(txns, project) {
    /** @type {Map<string, {need: bigint, want: bigint, impulse: bigint}>} */
    const sums = new Map();
    const withoutIntent = new Set();
    const months = [];
    for (const line of linesOf(txns).filter((l) => l.kind === 'expense')) {
        if (line.intent === '') {
            withoutIntent.add(line.txn.id);
            continue;
        }
        const month = cycleOf(line.date, project.monthStart);
        months.push(month);
        const s = sums.get(month) ?? {need: 0n, want: 0n, impulse: 0n};
        s[line.intent] += line.spend;
        sums.set(month, s);
    }
    const noIntent = withoutIntent.size;
    const intentMonths = monthSpan(months).map((month) => {
        const s = sums.get(month) ?? {need: 0n, want: 0n, impulse: 0n};
        return {month, need: amountOf(s.need, project), want: amountOf(s.want, project), impulse: amountOf(s.impulse, project)};
    });
    return {intentMonths, noIntent};
}

export function smallPurchases(txns, project) {
    const expenses = expenseTxns(txns);
    const expenseTotal = expenses.reduce((sum, t) => sum + t.spend, 0n);
    const small = project.thresholds.map((threshold) => {
        const under = expenses.filter((t) => t.spend <= threshold);
        const total = under.reduce((sum, t) => sum + t.spend, 0n);
        const bp = basisPoints(total, expenseTotal);
        return {
            threshold: amountOf(threshold, project),
            count: under.length,
            total: amountOf(total, project),
            share: formatBasisPoints(bp),
            shareBp: bp,
            shareSize: Number(bp),
        };
    });
    return {small, expenseCount: expenses.length, expenseTotal: amountOf(expenseTotal, project)};
}

function changeText(now, before) {
    if (before === 0n) {
        return now === 0n ? 'No change' : 'New';
    }
    return formatBasisPoints(basisPoints(now - before, before < 0n ? -before : before), true);
}

/** Spending per category in the range against the period of the same length before it. */
export function categoryCompare(allTxns, project, scope, previous) {
    const now = sumByCategory(spendingLines(filterRange(scope, allTxns)));
    const before = previous ? sumByCategory(spendingLines(filterRange(previous, allTxns))) : new Map();
    const ids = new Set([...now.keys(), ...before.keys()]);
    const rows = [...ids]
        .map((id) => {
            const current = now.get(id) ?? 0n;
            const earlier = before.get(id) ?? 0n;
            return {
                category: id,
                name: categoryName(project, id),
                color: categoryColor(project, id),
                current: amountOf(current, project),
                previous: amountOf(earlier, project),
                change: previous ? changeText(current, earlier) : '',
            };
        })
        .filter((r) => r.current.minor !== 0n || r.previous.minor !== 0n);
    return {
        compare: rows.sort(
            (a, b) =>
                compareBig(b.current.minor, a.current.minor) || compareBig(b.previous.minor, a.previous.minor) || byText(a.name, b.name),
        ),
        previousFrom: previous?.from ?? '',
        previousTo: previous?.to ?? '',
    };
}

const TOP_MERCHANTS = 10;

/** Where the money went by merchant (or note), largest first. */
export function topMerchants(txns, project) {
    /** @type {Map<string, {spent: bigint, txns: Set<string>}>} */
    const totals = new Map();
    for (const line of spendingLines(txns)) {
        const label = line.txn.merchant.trim() || line.txn.note.trim();
        if (label === '') {
            continue;
        }
        const entry = totals.get(label) ?? {spent: 0n, txns: new Set()};
        entry.spent += line.spend;
        entry.txns.add(line.txn.id);
        totals.set(label, entry);
    }
    return [...totals]
        .filter(([, e]) => e.spent > 0n)
        .map(([name, e]) => ({name, count: e.txns.size, spent: amountOf(e.spent, project)}))
        .sort((a, b) => compareBig(b.spent.minor, a.spent.minor) || byText(a.name, b.name))
        .slice(0, TOP_MERCHANTS);
}
