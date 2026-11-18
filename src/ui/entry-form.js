// The add/edit dialog for an expense, income, refund or transfer, and the actions on one entry.

import {closeDialog, datePicker, el, field, formDialog, openDialog} from './dom.js';
import {accountPicker, categoryPicker, pills, splitEditor} from './pickers.js';

const TYPES = [
    ['expense', 'Expense'],
    ['income', 'Income'],
    ['refund', 'Refund'],
    ['transfer', 'Transfer'],
];
const REPEATS = [
    ['', 'Does not repeat'],
    ['day', 'Every day'],
    ['week', 'Every week'],
    ['month', 'Every month'],
    ['year', 'Every year'],
];

/** Opens an entry for editing, or says why it can't. */
export function editEntry(ctx, id) {
    try {
        openEntryForm(ctx, ctx.app.getEntry(id));
    } catch (err) {
        ctx.notify(String(err?.message ?? err), true);
    }
}

function addAgain(ctx, entry) {
    closeDialog();
    openEntryForm(ctx, {...entry, id: '', time: '', date: ctx.boot.now.date, clock: ctx.boot.now.clock});
}

async function deleteEntry(ctx, id) {
    closeDialog();
    let undo;
    const error = await ctx.perform(async () => {
        undo = await ctx.app.deleteEntry(id);
    });
    if (error) {
        ctx.notify(error, true);
        return;
    }
    ctx.notify('Deleted.', false, {
        label: 'Undo',
        run: async () => {
            const undoError = await ctx.perform(() => ctx.app.undoDelete(undo));
            if (undoError) {
                ctx.notify(undoError, true);
            }
        },
    });
}

// The items to show: an ordinary entry is one item with its category and intent.
function itemsOf(entry) {
    if (!entry || entry.type === 'transfer') {
        return [];
    }
    if (entry.splits.length > 0) {
        return entry.splits.map((part) => (part.person ? part : {...part, intent: part.intent || entry.intent}));
    }
    return [{category: entry.category, amount: entry.amount, intent: entry.intent, note: ''}];
}

/** The add/edit dialog. entry is null for a new one; an entry without an id is a copy. */
export function openEntryForm(ctx, entry) {
    const isNew = !entry?.id;
    const now = ctx.boot.now;
    const initial = entry?.date ? {date: entry.date, clock: entry.clock} : {date: now.date, clock: now.clock};
    let type = entry?.type ?? 'expense';

    const typePills = el('div', {className: 'pills wide', role: 'radiogroup', 'aria-label': 'Type'});
    const payer = accountPicker(ctx, 'Account', entry?.account ?? ctx.boot.lastAccount);
    const accountField = field('Account (who paid)', payer.node);
    const from = accountPicker(ctx, 'From account', entry?.from ?? '');
    const to = accountPicker(ctx, 'To account', entry?.to ?? '');
    const fromField = field('From', from.node);
    const toField = field('To', to.node);
    const amountInput = el('input', {
        name: 'amount',
        required: true,
        value: entry?.amount ?? '',
        inputMode: 'decimal',
        autocomplete: 'off',
        placeholder: '0.00',
        'aria-label': 'Amount',
    });
    const sumHint = el('small', {className: 'muted'}, 'You can type a sum, e.g. 720-40 or 120+45.50.');
    const showTotal = () => {
        if (type !== 'transfer') {
            amountInput.value = ctx.app.itemsTotal(split.amounts());
        }
    };
    const split = splitEditor(ctx, itemsOf(entry), showTotal);
    split.begin();

    const suggestions = ctx.app.merchantSuggestions();
    const merchantList = el(
        'datalist',
        {id: 'merchant-suggestions'},
        suggestions.map((s) => el('option', {value: s.merchant})),
    );
    const merchant = el('input', {
        name: 'merchant',
        value: entry?.merchant ?? '',
        autocomplete: 'off',
        onchange: () => {
            const hit = suggestions.find((s) => s.merchant.toLowerCase() === merchant.value.trim().toLowerCase());
            if (hit && isNew) {
                split.suggestCategory(hit.category);
                payer.set(hit.account);
            }
        },
    });
    merchant.setAttribute('list', 'merchant-suggestions');
    const merchantField = field('Merchant', merchant);
    const tagsField = field(
        'Tags (separated by ;)',
        el('input', {name: 'tags', value: entry?.tags ?? '', autocomplete: 'off', placeholder: 'food;weekly'}),
    );
    const repeatField = isNew
        ? field(
              'Repeat',
              el(
                  'select',
                  {name: 'repeat'},
                  REPEATS.map(([value, label]) => el('option', {value}, label)),
              ),
              'Entries are added on their dates when the app opens.',
          )
        : null;

    function showType() {
        pills(typePills, TYPES, type, (value) => {
            type = value;
            showType();
        });
        const transfer = type === 'transfer';
        split.showIntents(type === 'expense');
        accountField.hidden = merchantField.hidden = tagsField.hidden = split.node.hidden = transfer;
        sumHint.hidden = !transfer;
        amountInput.readOnly = !transfer;
        showTotal();
        fromField.hidden = toField.hidden = !transfer;
    }
    showType();

    formDialog({
        title: isNew ? 'Add' : 'Edit',
        fields: [
            typePills,
            el('label', {className: 'amount-input'}, el('span', {}, ctx.boot.currency), amountInput),
            sumHint,
            accountField,
            fromField,
            toField,
            split.node,
            merchantField,
            merchantList,
            field('Note', el('input', {name: 'note', value: entry?.note ?? '', autocomplete: 'off'})),
            tagsField,
            el(
                'details',
                {className: 'when'},
                el('summary', {}, isNew ? 'Date and time default to now (change)' : 'Date and time (change)'),
                el(
                    'div',
                    {className: 'row-fields'},
                    el(
                        'div',
                        {className: 'field'},
                        el('span', {}, 'Date'),
                        datePicker({name: 'date', value: initial.date, label: 'Date', today: ctx.boot.today, placement: 'above'}),
                    ),
                    field('Time (clear if unknown)', el('input', {name: 'clock', type: 'time', value: initial.clock})),
                ),
            ),
            repeatField,
        ],
        submitLabel: 'Save',
        actions: isNew
            ? []
            : [
                  el('button', {type: 'button', className: 'quiet danger', onclick: () => deleteEntry(ctx, entry.id)}, 'Delete'),
                  el('button', {type: 'button', className: 'quiet', onclick: () => addAgain(ctx, entry)}, 'Add again'),
              ],
        onSubmit: (data) =>
            ctx.perform(() =>
                ctx.app.saveEntry({
                    id: entry?.id ?? '',
                    type,
                    amount: data.get('amount'),
                    account: payer.value(),
                    from: from.value(),
                    to: to.value(),
                    category: '',
                    splits: type === 'transfer' ? [] : split.value(),
                    merchant: data.get('merchant'),
                    note: data.get('note'),
                    tags: data.get('tags'),
                    intent: '',
                    date: data.get('date'),
                    clock: data.get('clock'),
                    originalTime: entry?.time ?? '',
                    originalDate: initial.date,
                    originalClock: initial.clock,
                    repeat: data.get('repeat') ? {every: data.get('repeat')} : null,
                }),
            ),
    });
}

/** A dialog listing entries; picking one opens it. */
export function openEntryList(ctx, title, refs) {
    openDialog(
        el(
            'div',
            {className: 'form'},
            el('h2', {}, title),
            el(
                'ul',
                {className: 'card rows'},
                refs.map((r) =>
                    el(
                        'li',
                        {},
                        el(
                            'button',
                            {
                                className: 'row',
                                onclick: () => {
                                    closeDialog();
                                    editEntry(ctx, r.id);
                                },
                            },
                            el(
                                'span',
                                {className: 'what'},
                                el('strong', {}, r.merchant || 'Untitled'),
                                el('small', {className: 'muted'}, r.date),
                            ),
                            el('span', {className: 'amount expense'}, r.amount.text),
                        ),
                    ),
                ),
            ),
            el('div', {className: 'form-actions'}, el('button', {onclick: closeDialog}, 'Close')),
        ),
    );
}

/** Asks for one category for many entries. done runs after it worked. */
export function openBulkCategory(ctx, ids, done) {
    const picker = categoryPicker(ctx, '');
    formDialog({
        title: `Set the category of ${ids.length} entries`,
        fields: [
            field('Category', picker.node),
            el('p', {className: 'muted'}, 'Entries with several items keep their own categories and are skipped.'),
        ],
        submitLabel: 'Set category',
        onSubmit: () =>
            ctx.perform(async () => {
                const result = await ctx.app.setCategory(ids, picker.value());
                done();
                ctx.notify(
                    `Changed ${result.changed}${result.skipped ? `, skipped ${result.skipped} with several items or deleted` : ''}.`,
                );
            }),
    });
}
