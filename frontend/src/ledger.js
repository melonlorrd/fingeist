import {GetTransaction, Ledger, DeleteTransaction, AddTransaction, UpdateTransaction} from '../bindings/el-costas/app.js';

import {datePicker, dayLabel, el, field, fill, formDialog} from './dom.js';

const DAYS_PER_PAGE = 40;

const FILTERS = [
    ['all', 'All'], ['expense', 'Expenses'], ['income', 'Income'],
    ['need', 'Needs'], ['want', 'Wants'], ['impulse', 'Impulses'],
];
const INTENTS = [['need', 'Need'], ['want', 'Want'], ['impulse', 'Impulse']];

const query = {search: '', month: '', category: '', filter: 'all'};
let visibleDays = DAYS_PER_PAGE;

export async function render(container, ctx) {
    const list = el('div', {className: 'ledger-list'});
    const month = el('select', {'aria-label': 'Month', onchange: () => { query.month = month.value; refilter(); }});
    const category = el('select', {
        'aria-label': 'Category',
        onchange: () => { query.category = category.value; refilter(); },
    }, el('option', {value: ''}, 'All categories'),
    [...ctx.boot.categories.map((c) => c.name), 'uncategorized'].map((name) => el('option', {value: name, selected: name === query.category}, name)));

    let timer;
    const search = el('input', {
        type: 'search', placeholder: 'Search merchant, note, category, tags', value: query.search, 'aria-label': 'Search',
        oninput: () => { clearTimeout(timer); timer = setTimeout(() => { query.search = search.value; refilter(); }, 200); },
    });
    const filters = el('div', {className: 'pills', role: 'group', 'aria-label': 'Show'});
    const showFilters = () => filters.replaceChildren(...FILTERS.map(([value, label]) => el('button', {
        className: query.filter === value ? 'active' : '',
        'aria-pressed': String(query.filter === value),
        onclick: () => { query.filter = value; showFilters(); refilter(); },
    }, label)));
    showFilters();

    container.replaceChildren(
        el('div', {className: 'filter-bar'}, search,
            el('button', {className: 'primary', onclick: () => openTransactionForm(ctx, null)}, '+ Add transaction'), month, category),
        filters,
        list,
    );

    function refilter() {
        visibleDays = DAYS_PER_PAGE;
        return load();
    }

    async function load() {
        const data = await Ledger({...query, limit: visibleDays});
        fill(month, el('option', {value: ''}, 'All months'),
            data.months.map((m) => el('option', {value: m, selected: m === query.month}, m)));
        const remaining = data.totalDays - data.days.length;
        list.replaceChildren(...(data.days.length === 0
            ? [el('p', {className: 'muted'}, 'No transactions match.')]
            : data.days.map((day) => dayGroup(day, ctx))),
        ...(remaining > 0 ? [el('button', {
            className: 'more',
            onclick: () => { visibleDays += DAYS_PER_PAGE; load(); },
        }, `Show ${Math.min(DAYS_PER_PAGE, remaining)} more days (${remaining} left)`)] : []));
    }
    await load();
}

function dayGroup(day, ctx) {
    return el('section', {className: 'day'},
        el('header', {}, el('h3', {}, dayLabel(day.date)), el('span', {className: `amount ${sign(day.total.minor)}`}, day.total.text)),
        el('ul', {className: 'card rows'}, day.rows.map((row) => transactionRow(row, ctx))),
    );
}

function transactionRow(row, ctx) {
    const title = row.merchant || row.note || '(no description)';
    const detail = [row.category, row.time, row.tags.join(', ')].filter(Boolean).join(' · ');
    return el('li', {className: 'row'},
        el('span', {className: 'dot', style: `background:${row.categoryColor || 'var(--muted)'}`}),
        el('span', {className: 'what'},
            el('strong', {}, title),
            el('small', {className: 'muted'}, row.merchant && row.note ? `${detail} · ${row.note}` : detail),
        ),
        row.intent ? el('span', {className: `badge ${row.intent}`}, row.intent) : el('span'),
        el('span', {className: `amount ${sign(row.amount.minor)}`}, row.amount.text),
        el('span', {className: 'actions'},
            el('button', {className: 'quiet', onclick: () => editTransaction(ctx, row.id)}, 'Edit'),
            el('button', {className: 'quiet danger', onclick: () => deleteTransaction(ctx, row)}, 'Delete'),
        ),
    );
}

function sign(minor) {
    return minor < 0 ? 'expense' : 'income';
}

async function deleteTransaction(ctx, row) {
    const title = row.merchant || row.note || 'transaction';
    let fields;
    try {
        fields = await GetTransaction(row.id);
    } catch (err) {
        ctx.notify(String(err?.message ?? err), true);
        return;
    }
    const error = await ctx.perform(() => DeleteTransaction(row.id));
    if (error) {
        ctx.notify(error, true);
        return;
    }
    ctx.notify(`Deleted ${title} (${row.amount.text}).`, false, {
        label: 'Undo',
        run: async () => {
            const undoError = await ctx.perform(() => AddTransaction({...fields, id: ''}));
            if (undoError) {
                ctx.notify(undoError, true);
            }
        },
    });
}

export async function editTransaction(ctx, id) {
    try {
        openTransactionForm(ctx, await GetTransaction(id));
    } catch (err) {
        ctx.notify(String(err?.message ?? err), true);
    }
}

// Opens the add/edit dialog. `fields` is null for a new transaction.
export function openTransactionForm(ctx, fields) {
    const isNew = fields === null;
    const initial = isNew ? splitNow(ctx.boot.now) : splitTime(fields.time);
    const amountText = isNew ? '' : fields.amount.replace(/^-/, '');

    let expense = isNew || fields.amount.startsWith('-');
    const type = el('div', {className: 'pills wide', role: 'radiogroup', 'aria-label': 'Type'});
    const intentField = el('div', {className: 'field intent-field'}, el('span', {}, 'Habit intent'));
    let intent = fields?.intent ?? '';
    const intentButtons = el('div', {className: 'pills wide', role: 'group', 'aria-label': 'Intent'});
    intentField.append(intentButtons);

    const showIntent = () => intentButtons.replaceChildren(...INTENTS.map(([value, label]) => el('button', {
        type: 'button', 'aria-pressed': String(intent === value), className: intent === value ? `active ${value}` : '',
        onclick: () => { intent = intent === value ? '' : value; showIntent(); },
    }, label)));
    const showType = () => {
        type.replaceChildren(...[[true, 'Expense'], [false, 'Income']].map(([value, label]) => el('button', {
            type: 'button', role: 'radio', 'aria-checked': String(expense === value),
            className: expense === value ? `active ${value ? 'expense' : 'income'}` : '',
            onclick: () => { expense = value; showType(); },
        }, label)));
        intentField.hidden = !expense;
    };
    showType();
    showIntent();

    let category = fields?.category ?? '';
    const chips = el('div', {className: 'chips', role: 'radiogroup', 'aria-label': 'Category'});
    const showChips = () => chips.replaceChildren(...categoryChoices(ctx.boot.categories, category).map((c) => el('button', {
        type: 'button', role: 'radio', 'aria-checked': String(c.name === category),
        className: `chip ${c.name === category ? 'active' : ''}`,
        onclick: () => { category = c.name; showChips(); },
    }, el('span', {className: 'dot', style: `background:${c.color || 'var(--muted)'}`}), c.label)));
    showChips();

    const input = (name, props = {}) => el('input', {name, value: fields?.[name] ?? '', autocomplete: 'off', ...props});
    formDialog({
        title: isNew ? 'Add transaction' : 'Edit transaction',
        fields: [
            type,
            el('label', {className: 'amount-input'},
                el('span', {}, ctx.boot.currency),
                el('input', {name: 'amount', required: true, value: amountText, inputMode: 'decimal', autocomplete: 'off', placeholder: '0.00', 'aria-label': 'Amount'})),
            field('Category', chips),
            intentField,
            field('Merchant', input('merchant')),
            field('Note', input('note')),
            field('Tags (separated by ;)', input('tags', {placeholder: 'food;weekly'})),
            el('details', {className: 'when'},
                el('summary', {}, isNew ? 'Date and time default to now (change)' : 'Date and time (change)'),
                el('div', {className: 'row-fields'},
                    el('div', {className: 'field'}, el('span', {}, 'Date'),
                        datePicker({name: 'date', value: initial.date, label: 'Date', today: ctx.boot.today, placement: 'above'})),
                    field('Time (clear if unknown)', el('input', {name: 'clock', type: 'time', value: initial.clock}))),
            ),
        ],
        submitLabel: 'Save transaction',
        onSubmit: (data) => {
            const date = data.get('date');
            const clock = data.get('clock');
            const unchanged = !isNew && date === initial.date && clock === initial.clock;
            const result = {
                ...(fields ?? {}),
                time: unchanged ? fields.time : (clock ? `${date} ${clock}` : date),
                amount: (expense ? '-' : '') + data.get('amount').trim(),
                category,
                merchant: data.get('merchant'),
                note: data.get('note'),
                tags: data.get('tags'),
                intent: expense ? intent : '',
            };
            return ctx.perform(() => (isNew ? AddTransaction(result) : UpdateTransaction(result)));
        },
    });
}

function categoryChoices(categories, current) {
    const choices = [{name: '', label: 'None', color: ''}];
    for (const c of categories) {
        if (!c.archived || c.name === current) {
            choices.push({name: c.name, label: c.archived ? `${c.name} (archived)` : c.name, color: c.color});
        }
    }
    if (current && !categories.some((c) => c.name === current)) {
        choices.push({name: current, label: `${current} (unlisted)`, color: ''});
    }
    return choices;
}

function splitNow(now) {
    const [date, clock] = now.split(' ');
    return {date, clock};
}

// "2026-11-07T14:30:00+05:30" -> date and clock; a bare date has no clock.
function splitTime(time) {
    return time.length > 10 ? {date: time.slice(0, 10), clock: time.slice(11, 16)} : {date: time, clock: ''};
}
