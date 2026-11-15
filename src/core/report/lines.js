// Transactions as the reports see them. A transaction has one line per split part (or one line);
// each line is an expense, a refund, income, or a share lent to a person.

/** Transactions paid from the account in view. */
export function filterAccount(scope, txns) {
    return scope.account === '' ? txns : txns.filter((t) => t.account === scope.account);
}

/** Every line, carrying its transaction's date, time and details. */
export function linesOf(txns) {
    return txns.flatMap((t) => t.lines.map((line) => ({...line, txn: t, date: t.date, intent: t.intent})));
}

/** Lines that change how much you spent: expenses add, refunds take away. */
export function spendingLines(txns) {
    return linesOf(txns).filter((l) => l.spend !== 0n);
}

/** Expense transactions with what you spent on them, for the habit charts; refunds are left out. */
export function expenseTxns(txns) {
    return txns.flatMap((t) => {
        const spend = t.lines.filter((l) => l.kind === 'expense').reduce((sum, l) => sum + l.spend, 0n);
        return spend > 0n ? [{...t, spend}] : [];
    });
}

export function incomeOf(txns) {
    return linesOf(txns)
        .filter((l) => l.kind === 'income')
        .reduce((sum, l) => sum + l.amount, 0n);
}

export function spentOf(txns) {
    return spendingLines(txns).reduce((sum, l) => sum + l.spend, 0n);
}
