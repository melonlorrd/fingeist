import {el, field} from './dom.js';

export function renderTransactions(container, state, handlers) {
    const heading = el('div', {className: 'section-head'},
        el('h2', {}, `Transactions (${state.rows.length})`),
        el('button', {className: 'primary', onclick: () => openForm(state, null, handlers.onSave)}, 'Add transaction'),
    );
    if (state.rows.length === 0) {
        container.replaceChildren(heading, el('p', {className: 'muted'}, 'No transactions in this range.'));
        return;
    }

    const head = el('tr', {}, ...['When', 'Merchant', 'Category', 'Amount', 'Tags', 'Note', ''].map((name) => el('th', {}, name)));
    const body = state.rows.map((row) => el('tr', {},
        el('td', {className: 'when'}, row.time.slice(0, 16).replace('T', ' ')),
        el('td', {}, row.merchant),
        el('td', {}, row.category),
        el('td', {className: `amount ${row.amount.startsWith('-') ? 'expense' : 'income'}`}, `${row.amount} ${state.currency}`),
        el('td', {}, row.tags.split(';').join(', ')),
        el('td', {className: 'note'}, row.note),
        el('td', {className: 'actions'},
            el('button', {onclick: () => openForm(state, row, handlers.onSave)}, 'Edit'),
            el('button', {className: 'danger', onclick: () => handlers.onDelete(row)}, 'Delete'),
        ),
    ));
    container.replaceChildren(heading, el('div', {className: 'table-wrap'}, el('table', {}, el('thead', {}, head), el('tbody', {}, body))));
}

// onSave(fields, isNew) returns an error message to show in the dialog, or '' when done.
function openForm(state, row, onSave) {
    const dialog = document.getElementById('txn-dialog');
    const isNew = row === null;
    const values = row ?? {id: '', time: state.now, amount: '', category: '', merchant: '', note: '', tags: ''};

    const message = el('p', {className: 'error', hidden: true});
    const input = (name, props = {}) => el('input', {name, value: values[name], autocomplete: 'off', ...props});
    const form = el('form', {method: 'dialog', className: 'form'},
        el('h2', {}, isNew ? 'Add transaction' : 'Edit transaction'),
        field('When', input('time', {required: true, placeholder: '2026-11-07 14:30'})),
        field(`Amount (${state.currency}, negative = expense)`, input('amount', {required: true, placeholder: '-12.50'})),
        field('Category', input('category', {list: 'category-options'})),
        el('datalist', {id: 'category-options'}, (state.categories ?? []).map((c) => el('option', {value: c}))),
        field('Merchant', input('merchant')),
        field('Note', input('note')),
        field('Tags (separated by ;)', input('tags', {placeholder: 'food;weekly'})),
        message,
        el('div', {className: 'form-actions'},
            el('button', {type: 'button', onclick: () => dialog.close()}, 'Cancel'),
            el('button', {type: 'submit', className: 'primary'}, 'Save'),
        ),
    );

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const fields = {...values, ...Object.fromEntries(new FormData(form))};
        const error = await onSave(fields, isNew);
        if (error) {
            message.textContent = error;
            message.hidden = false;
        } else {
            dialog.close();
        }
    });

    dialog.replaceChildren(form);
    dialog.showModal();
}
