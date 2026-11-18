// Turns form input into the fields of new change records, checked with the same rules records.js
// reads them with.

import {formatMoney, parseMoney} from './money.js';
import {
    DAY_NAMES,
    parseAccount,
    parseCategory,
    parseMonthStart,
    parseRecurring,
    parseThresholds,
    parseTransfer,
    parseTxn,
    parseWorkdays,
    requiredText,
} from './records.js';

function splitTags(value) {
    return String(value ?? '')
        .split(';')
        .map((t) => t.trim())
        .filter(Boolean);
}

/**
 * Reads an amount typed in a form: grouping commas, spaces and a currency symbol are ignored, and
 * "120+45.5" and "720-40" add up. Returns minor units; throws a message for the form.
 */
export function parseAmountInput(input, decimals) {
    const cleaned = String(input ?? '')
        .replace(/[\s,]/g, '')
        .replace(/^[^\d+.-]+/, '');
    if (cleaned === '') {
        throw new Error('Enter an amount');
    }
    if (!/^[+-]?[^+-]+([+-][^+-]+)*$/.test(cleaned)) {
        throw new Error(`invalid amount "${input}"`);
    }
    return (cleaned.match(/[+-]?[^+-]+/g) ?? []).reduce((sum, term) => sum + parseMoney(term, decimals), 0n);
}

/** Fields for a transaction from checked form input. amount is signed minor units; a negative split part is a discount. */
export function txnFields(input, decimals) {
    const fields = {
        time: input.time,
        amount: formatMoney(input.amount, decimals),
        account: String(input.account ?? ''),
        category: String(input.category ?? ''),
        merchant: String(input.merchant ?? '').trim(),
        note: String(input.note ?? '').trim(),
        tags: Array.isArray(input.tags) ? input.tags : splitTags(input.tags),
        intent: input.amount < 0n ? (input.intent ?? '') : '',
        refund: input.amount > 0n && input.refund === true,
        splits: (input.splits ?? []).map((s) => ({
            category: s.category ?? '',
            person: s.person ?? '',
            amount: formatMoney(s.amount, decimals),
            ...(s.intent ? {intent: s.intent} : {}),
            ...(String(s.note ?? '').trim() ? {note: String(s.note).trim()} : {}),
        })),
    };
    if (input.recurring) {
        fields.recurring = input.recurring;
    }
    parseTxn('check', fields, decimals);
    return fields;
}

export function transferFields(input, decimals) {
    const fields = {
        time: input.time,
        amount: formatMoney(input.amount, decimals),
        from: String(input.from ?? ''),
        to: String(input.to ?? ''),
        note: String(input.note ?? '').trim(),
    };
    if (input.recurring) {
        fields.recurring = input.recurring;
    }
    parseTransfer('check', fields, decimals);
    return fields;
}

export function categoryFields(input) {
    const fields = {name: String(input.name ?? '').trim(), color: String(input.color ?? '')};
    parseCategory('check', fields);
    return fields;
}

export function accountFields(input, decimals) {
    const opening = parseAmountInput(String(input.opening ?? '').trim() || '0', decimals);
    const fields = {name: String(input.name ?? '').trim(), opening: formatMoney(opening, decimals), kind: input.kind ?? 'own'};
    parseAccount('check', fields, decimals);
    return fields;
}

export function budgetFields(input, decimals) {
    const amount = parseAmountInput(input.amount, decimals);
    if (amount <= 0n) {
        throw new Error('A budget must be more than zero');
    }
    return {amount: formatMoney(amount, decimals)};
}

export function recurringFields(input, decimals) {
    const fields = {
        entry: input.entry,
        template: input.template,
        every: input.every,
        start: input.start,
        until: input.until ?? '',
        paused: input.paused === true,
    };
    parseRecurring('check', fields, decimals);
    return fields;
}

/** Fields of the project settings record from the settings form. */
export function settingsFields(input, decimals) {
    const thresholds = parseThresholds(input.thresholds.map((t) => String(t).trim()).filter(Boolean), decimals);
    parseWorkdays(input.workdays);
    return {
        name: requiredText(input.name, 'project name'),
        thresholds: thresholds.map((a) => formatMoney(a, decimals)),
        workdays: DAY_NAMES.filter((d) => input.workdays.includes(d)),
        monthStart: parseMonthStart(Number(input.monthStart)),
    };
}
