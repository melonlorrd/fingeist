// Pickers for the entry form: categories as chips, accounts as a select, and the parts of a split.
// Each returns {node, value()}; value() is an id, or "new:Name" for one to create.

import {NEW_PREFIX} from '../core/app.js';
import {el, fill} from './dom.js';

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
                '+ New category',
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

/** The parts of a split: each is a category (your spending) or a person (their share), with an amount. */
export function splitEditor(ctx, parts) {
    const rows = el('div', {className: 'balance-rows'});
    const entries = [];
    const addPart = (part = {}, person = false) => {
        const target = person
            ? accountPicker(ctx, 'Person', part.person ?? '', {kinds: ['person'], newKinds: ['person']})
            : categoryPicker(ctx, part.category ?? '');
        const amount = el('input', {
            value: part.amount ?? '',
            inputMode: 'decimal',
            placeholder: 'Amount',
            autocomplete: 'off',
            'aria-label': 'Part amount',
        });
        const entry = {person, target, amount};
        const remove = () => {
            row.remove();
            entries.splice(entries.indexOf(entry), 1);
        };
        const row = el(
            'div',
            {className: 'split-part'},
            el('small', {className: 'muted'}, person ? 'Their share' : 'Your share'),
            target.node,
            el('div', {className: 'balance-row'}, amount, el('button', {type: 'button', onclick: remove}, 'Remove')),
        );
        entries.push(entry);
        rows.append(row);
    };
    for (const part of parts) {
        addPart(part, Boolean(part.person));
    }
    const node = el(
        'div',
        {className: 'field'},
        el('span', {}, 'Split'),
        el(
            'small',
            {className: 'muted'},
            "Parts must add up to the amount. A person's share is money they owe you (or you them, for income).",
        ),
        rows,
        el(
            'div',
            {className: 'head-actions'},
            el('button', {type: 'button', onclick: () => addPart({})}, '+ Your share'),
            el('button', {type: 'button', onclick: () => addPart({}, true)}, '+ Split with a person'),
        ),
    );
    return {
        node,
        value: () =>
            entries.map((p) =>
                p.person ? {person: p.target.value(), amount: p.amount.value} : {category: p.target.value(), amount: p.amount.value},
            ),
    };
}
