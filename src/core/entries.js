// Adding, editing and deleting transactions and transfers from the entry form.

import {accountRef, categoryRef} from './catalog.js';
import {parseAmountInput, recurringFields, transferFields, txnFields} from './fields.js';
import {occurrenceId} from './recurring.js';
import {liveRecord} from './state.js';
import {stamp} from './time.js';

/** @param {import('./workspace.js').Workspace} ws */
export function entriesApi(ws) {
    function timeOf(input) {
        if (input.originalTime && input.date === input.originalDate && input.clock === input.originalClock) {
            return input.originalTime;
        }
        return input.clock ? stamp(input.date, input.clock, ws.clock.offsetAt(input.date, input.clock)) : input.date;
    }

    function positiveAmount(text) {
        const amount = parseAmountInput(text, ws.decimals());
        if (amount <= 0n) {
            throw new Error('Enter an amount more than zero');
        }
        return amount;
    }

    /** @returns {Promise<{kind: 'txn' | 'transfer', fields: Record<string, any>}>} */
    async function entryFields(input) {
        const time = timeOf(input);
        const amount = positiveAmount(input.amount);
        if (input.type === 'transfer') {
            const from = await accountRef(ws, input.from);
            const to = await accountRef(ws, input.to);
            return {kind: 'transfer', fields: transferFields({time, amount, from, to, note: input.note}, ws.decimals())};
        }
        const splits = [];
        for (const part of input.splits ?? []) {
            splits.push({
                category: part.person ? '' : await categoryRef(ws, part.category),
                person: part.person ? await accountRef(ws, part.person, 'person') : '',
                amount: positiveAmount(part.amount),
            });
        }
        const fields = txnFields(
            {
                time,
                splits,
                amount: input.type === 'expense' ? -amount : amount,
                refund: input.type === 'refund',
                account: await accountRef(ws, input.account),
                category: splits.length > 0 ? '' : await categoryRef(ws, input.category),
                merchant: input.merchant,
                note: input.note,
                tags: input.tags,
                intent: input.intent,
            },
            ws.decimals(),
        );
        return {kind: 'txn', fields};
    }

    /** @returns {{kind: 'txn' | 'transfer', fields: Record<string, any>}} */
    function findEntry(id) {
        for (const kind of /** @type {const} */ (['txn', 'transfer'])) {
            const fields = liveRecord(ws.book.winners, kind, id);
            if (fields) {
                return {kind, fields};
            }
        }
        throw new Error('That entry no longer exists');
    }

    return {
        /** Form fields of an entry: amounts as positive text, ids for accounts and categories. */
        getEntry(id) {
            const {kind, fields: f} = findEntry(id);
            const dated = {
                id,
                time: f.time,
                date: f.time.slice(0, 10),
                clock: f.time.length > 10 ? f.time.slice(11, 16) : '',
                amount: f.amount.replace(/^-/, ''),
                note: f.note ?? '',
            };
            if (kind === 'transfer') {
                return {...dated, type: 'transfer', from: f.from, to: f.to};
            }
            return {
                ...dated,
                type: f.amount.startsWith('-') ? 'expense' : f.refund ? 'refund' : 'income',
                account: f.account,
                category: f.category ?? '',
                merchant: f.merchant ?? '',
                tags: (f.tags ?? []).join(';'),
                intent: f.intent ?? '',
                splits: (f.splits ?? []).map((s) => ({category: s.category, person: s.person, amount: s.amount})),
            };
        },

        /** Adds or updates an entry from the form; repeat ({every, until}) makes a new entry repeat. Throws a message for the form. */
        async saveEntry(input) {
            ws.requireProject();
            const {kind, fields} = await entryFields(input);
            if (input.id) {
                const existing = findEntry(input.id);
                if (existing.kind === kind) {
                    await ws.putChanged(kind, input.id, fields);
                } else {
                    await ws.remove(existing.kind, input.id);
                    await ws.put(kind, ws.newId(), fields);
                }
            } else if (input.repeat?.every) {
                const repeatId = ws.newId();
                const date = fields.time.slice(0, 10);
                const {time, ...template} = fields;
                const repeat = {entry: kind, template, every: input.repeat.every, start: date, until: input.repeat.until ?? ''};
                await ws.put('recurring', repeatId, recurringFields(repeat, ws.decimals()));
                await ws.put(kind, occurrenceId(repeatId, date), {...fields, time, recurring: repeatId});
                await ws.applyDue();
            } else {
                await ws.put(kind, ws.newId(), fields);
            }
            if (kind === 'txn') {
                await ws.remember({lastAccount: fields.account});
            }
        },

        /** Deletes an entry and returns what undo needs. */
        async deleteEntry(id) {
            const {kind, fields} = findEntry(id);
            await ws.remove(kind, id);
            return {kind, id, fields};
        },

        undoDelete: ({kind, id, fields}) => ws.put(kind, id, fields),

        /** Sets the category of many transactions; split ones are skipped. Returns how many changed and skipped. */
        async setCategory(ids, category) {
            const target = await categoryRef(ws, category);
            let changed = 0;
            let skipped = 0;
            for (const id of ids) {
                const fields = liveRecord(ws.book.winners, 'txn', id);
                if (!fields || (fields.splits ?? []).length > 0) {
                    skipped++;
                } else if (fields.category !== target) {
                    await ws.put('txn', id, {category: target});
                    changed++;
                }
            }
            return {changed, skipped};
        },

        /** Merchants used before, most used first, with the category and account of their latest use. */
        merchantSuggestions() {
            /** @type {Map<string, {merchant: string, category: string, account: string, count: number}>} */
            const latest = new Map();
            for (const t of [...ws.view().txns].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
                const key = t.merchant.trim().toLowerCase();
                if (key) {
                    latest.set(key, {
                        merchant: t.merchant.trim(),
                        category: t.splits.length ? '' : t.category,
                        account: t.account,
                        count: (latest.get(key)?.count ?? 0) + 1,
                    });
                }
            }
            return [...latest.values()].sort((a, b) => b.count - a.count || a.merchant.localeCompare(b.merchant));
        },
    };
}
