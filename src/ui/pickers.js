// Pickers for the entry form: categories as chips, accounts as a select, and the parts of a split.
// Each returns {node, value()}; value() is an id, or "new:Name" for one to create.

import {NEW_PREFIX} from '../core/app.js';
import {el, fill} from './dom.js';
import {icon} from './icons.js';

/** Category chips: Uncategorized, the active categories, and "+ New category" which asks for a name. */
export function categoryPicker(ctx, current) {
    let value = current;
    let creating = false;
    const nameInput = el('input', {placeholder: 'New category name', autocomplete: 'off', 'aria-label': 'New category name'});
    const node = el('div', {className: 'chips', role: 'radiogroup', 'aria-label': 'Category'});
    const choices = [
        {id: '', name: 'Uncategorized', color: '', archived: false},
        ...ctx.boot.categories.filter((c) => !c.archived || c.id === current),
    ];
    const chip = (c) => {
        const chosen = !creating && c.id === value;
        return el(
            'button',
            {
                type: 'button',
                role: 'radio',
                'aria-checked': String(chosen),
                className: `chip ${chosen ? 'active' : ''}`,
                onclick: () => {
                    value = c.id;
                    creating = false;
                    draw();
                },
            },
            el('span', {className: 'dot', style: `background:${c.color || 'var(--muted)'}`}),
            c.archived ? `${c.name} (archived)` : c.name,
        );
    };
    const draw = () =>
        fill(
            node,
            choices.map(chip),
            el(
                'button',
                {
                    type: 'button',
                    className: `chip ${creating ? 'active' : ''}`,
                    onclick: () => {
                        creating = true;
                        draw();
                        nameInput.focus();
                    },
                },
                icon('plus'),
                'New category',
            ),
            creating ? nameInput : null,
        );
    draw();
    return {
        node,
        value: () => (creating && nameInput.value.trim() ? NEW_PREFIX + nameInput.value.trim() : value),
        set(id) {
            value = id;
            creating = false;
            draw();
        },
    };
}

/** A select of accounts plus "New account…" or "New person…", which swaps in a name field. */
export function accountPicker(ctx, label, current, {kinds = ['own', 'person'], newKinds = ['own']} = {}) {
    const accounts = ctx.boot.accounts.filter((a) => kinds.includes(a.kind) && (!a.archived || a.id === current));
    const forPeople = newKinds.includes('person');
    const wrapper = el('div', {className: 'field'});
    const text = el('input', {
        placeholder: forPeople ? 'Name, e.g. Rahul' : 'New account name, e.g. Cash',
        autocomplete: 'off',
        'aria-label': `${label} name`,
    });
    const group = (kind, title) => {
        const items = accounts.filter((a) => a.kind === kind);
        return items.length
            ? el(
                  'optgroup',
                  {label: title},
                  items.map((a) => el('option', {value: a.id, selected: a.id === current}, a.name)),
              )
            : null;
    };
    const select = el(
        'select',
        {
            'aria-label': label,
            onchange: () => {
                if (select.value === NEW_PREFIX) {
                    wrapper.replaceChildren(text);
                    text.focus();
                }
            },
        },
        group('own', 'Your accounts'),
        group('person', 'People'),
        el('option', {value: NEW_PREFIX}, forPeople ? 'New person…' : 'New account…'),
    );
    wrapper.append(accounts.length === 0 ? text : select);
    return {
        node: wrapper,
        value: () => (wrapper.contains(text) ? (text.value.trim() ? NEW_PREFIX + text.value.trim() : '') : select.value),
        set(id) {
            if (accounts.some((a) => a.id === id)) {
                wrapper.replaceChildren(select);
                select.value = id;
            }
        },
    };
}

export const INTENTS = [
    ['need', 'Need'],
    ['want', 'Want'],
    ['impulse', 'Impulse'],
];

/** Fills a group with radio pills; onPick gets the value clicked. */
export function pills(group, items, current, onPick) {
    group.replaceChildren(
        ...items.map(([value, label]) =>
            el(
                'button',
                {
                    type: 'button',
                    role: 'radio',
                    'aria-checked': String(current === value),
                    className: current === value ? `active ${value}` : '',
                    onclick: () => onPick(value),
                },
                label,
            ),
        ),
    );
}

/** The lines of an itemised bill: each is an item name and amount, for a category (with its own intent) or a person's share. */
export function splitEditor(ctx, parts, onChange) {
    const rows = el('div', {className: 'balance-rows'});
    const entries = [];
    let intentsShown = true;
    let ready = false;
    const changed = () => ready && onChange();
    // A bill always keeps at least one item; while it has one, its amount is typed in the form's main amount field.
    const showRemoves = () => {
        for (const p of entries) {
            p.removeButton.hidden = entries.length === 1;
            p.amount.hidden = entries.length === 1;
        }
    };
    const addPart = (part = {}, person = false) => {
        const target = person
            ? accountPicker(ctx, 'Person', part.person ?? '', {kinds: ['person'], newKinds: ['person']})
            : categoryPicker(ctx, part.category ?? '');
        const name = el('input', {
            value: part.note ?? '',
            placeholder: person ? 'For' : 'Item',
            autocomplete: 'off',
            'aria-label': 'Item name',
        });
        const amount = el('input', {
            value: part.amount ?? '',
            inputMode: 'decimal',
            placeholder: 'Amount',
            autocomplete: 'off',
            'aria-label': 'Item amount',
            oninput: () => changed(),
        });
        const intentButtons = el('div', {className: 'pills wide', role: 'radiogroup', 'aria-label': 'Part intent'});
        const entry = {person, target, name, amount, intent: part.intent ?? '', intentButtons, removeButton: null};
        const showIntent = () =>
            pills(intentButtons, INTENTS, entry.intent, (value) => {
                entry.intent = entry.intent === value ? '' : value;
                showIntent();
            });
        showIntent();
        intentButtons.hidden = person || !intentsShown;
        const remove = () => {
            row.remove();
            entries.splice(entries.indexOf(entry), 1);
            showRemoves();
            changed();
        };
        entry.removeButton = el('button', {type: 'button', className: 'quiet danger', onclick: remove}, 'Remove');
        const row = el(
            'div',
            {className: 'split-part'},
            el('div', {className: 'dialog-head'}, el('small', {className: 'muted'}, person ? 'Their share' : 'Item'), entry.removeButton),
            el('div', {className: 'balance-row'}, name, amount),
            target.node,
            person ? null : intentButtons,
        );
        entries.push(entry);
        rows.append(row);
        showRemoves();
        changed();
    };
    for (const part of parts) {
        addPart(part, Boolean(part.person));
    }
    ready = true;
    const node = el(
        'div',
        {className: 'field'},
        el('span', {}, 'Items'),
        el(
            'small',
            {className: 'muted'},
            "With more than one item, the amount is their total. Fees are items too; a discount is a negative item, like -40. A person's share is money they owe you (or you them, for income). Amounts can be sums, like 720-40.",
        ),
        rows,
        el(
            'div',
            {className: 'head-actions'},
            el('button', {type: 'button', onclick: () => addPart({})}, icon('plus'), 'Item'),
            el('button', {type: 'button', onclick: () => addPart({}, true)}, icon('plus'), 'Share with a person'),
        ),
    );
    return {
        node,
        amounts: () => entries.map((p) => p.amount.value),
        count: () => entries.length,
        /** Sets the amount of the only item, as typed in the main amount field. */
        setOnlyAmount(value) {
            if (entries.length === 1) {
                entries[0].amount.value = value;
            }
        },
        /** Starts an empty bill with one blank item. */
        begin() {
            if (entries.length === 0) {
                addPart({});
            }
        },
        /** Fills in a merchant's usual category while the bill has one item. */
        suggestCategory(id) {
            if (entries.length === 1 && !entries[0].person) {
                entries[0].target.set(id);
            }
        },
        value: () =>
            entries.map((p) =>
                p.person
                    ? {person: p.target.value(), amount: p.amount.value, note: p.name.value}
                    : {category: p.target.value(), amount: p.amount.value, intent: p.intent, note: p.name.value},
            ),
        showIntents(shown) {
            intentsShown = shown;
            for (const p of entries) {
                p.intentButtons.hidden = p.person || !shown;
            }
        },
    };
}
