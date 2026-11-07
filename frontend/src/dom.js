export function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key.startsWith('on')) {
            node.addEventListener(key.slice(2), value);
        } else if (key in node && key !== 'list') {
            node[key] = value;
        } else {
            node.setAttribute(key, value);
        }
    }
    node.append(...children.flat().filter((child) => child != null));
    return node;
}

// Like replaceChildren, but accepts arrays and skips null.
export function fill(node, ...children) {
    node.replaceChildren(...children.flat().filter((child) => child != null));
}

export function field(label, input, hint) {
    return el('label', {className: 'field'}, el('span', {}, label), input, hint ? el('small', {className: 'muted'}, hint) : null);
}

// options: [{value, label}]
export function select(name, options, value) {
    return el('select', {name},
        options.map((o) => el('option', {value: o.value, selected: o.value === value}, o.label)));
}

export function dayLabel(date) {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'});
}

export function monthLabel(month) {
    const [year, number] = month.split('-').map(Number);
    return new Date(year, number - 1, 1).toLocaleDateString(undefined, {month: 'long', year: 'numeric'});
}

// Resolves true when the user confirms; Esc and Cancel resolve false.
export function confirmDialog(message, confirmLabel = 'Delete') {
    return new Promise((resolve) => {
        const dialog = document.getElementById('dialog');
        let settled = false;
        const onClose = () => settle(false);
        const settle = (answer) => {
            if (settled) {
                return;
            }
            settled = true;
            dialog.removeEventListener('close', onClose);
            closeDialog();
            resolve(answer);
        };
        dialog.addEventListener('close', onClose);
        openDialog(el('div', {className: 'form'},
            el('h2', {}, 'Are you sure?'),
            el('p', {className: 'muted'}, message),
            el('div', {className: 'form-actions'},
                el('button', {type: 'button', onclick: () => settle(false)}, 'Cancel'),
                el('button', {type: 'button', className: 'destructive', onclick: () => settle(true)}, confirmLabel)),
        ));
    });
}

const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (year, month, day) => `${year}-${pad(month + 1)}-${pad(day)}`;

function dateText(iso) {
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'});
}

// A pill button that opens a month calendar. Its `name`d hidden input carries the YYYY-MM-DD value,
// also readable as `.value`. today is YYYY-MM-DD; placement is 'below' or 'above'.
export function datePicker({name, value = '', placeholder = 'Any date', label, today, clearable = false, placement = 'below', onchange}) {
    const hidden = el('input', {type: 'hidden', name, value});
    const button = el('button', {type: 'button', className: 'date-button', 'aria-label': label, 'aria-haspopup': 'dialog'});
    const root = el('div', {className: 'date-picker'}, hidden, button);
    Object.defineProperty(root, 'value', {get: () => hidden.value});

    let popover = null;
    let shown = null;
    const showValue = () => {
        button.textContent = hidden.value ? dateText(hidden.value) : placeholder;
        button.classList.toggle('empty', !hidden.value);
    };
    const close = () => {
        popover?.remove();
        popover = null;
        document.removeEventListener('click', outsideClick, true);
    };
    const outsideClick = (event) => {
        if (!root.contains(event.target)) {
            close();
        }
    };
    const choose = (iso) => {
        hidden.value = iso;
        showValue();
        close();
        onchange?.(iso);
    };
    const draw = () => {
        const {year, month} = shown;
        const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
        const days = new Date(year, month + 1, 0).getDate();
        const cells = [...Array(firstWeekday).fill(null), ...Array.from({length: days}, (_, i) => i + 1)];
        popover.replaceChildren(
            el('div', {className: 'date-head'},
                el('button', {type: 'button', className: 'quiet', 'aria-label': 'Previous month', onclick: () => step(-1)}, '‹'),
                el('strong', {}, new Date(year, month, 1).toLocaleDateString(undefined, {month: 'long', year: 'numeric'})),
                el('button', {type: 'button', className: 'quiet', 'aria-label': 'Next month', onclick: () => step(1)}, '›')),
            el('div', {className: 'date-grid'},
                WEEKDAY_LETTERS.map((letter) => el('small', {className: 'muted'}, letter)),
                cells.map((day) => {
                    if (day === null) {
                        return el('span');
                    }
                    const iso = isoDate(year, month, day);
                    return el('button', {
                        type: 'button',
                        className: `${iso === hidden.value ? 'selected' : ''} ${iso === today ? 'today' : ''}`,
                        onclick: () => choose(iso),
                    }, String(day));
                })),
            el('div', {className: 'date-foot'},
                clearable ? el('button', {type: 'button', className: 'quiet', onclick: () => choose('')}, 'Clear') : el('span'),
                today ? el('button', {type: 'button', className: 'quiet', onclick: () => choose(today)}, 'Today') : null),
        );
    };
    const step = (delta) => {
        const moved = new Date(shown.year, shown.month + delta, 1);
        shown = {year: moved.getFullYear(), month: moved.getMonth()};
        draw();
    };
    const open = () => {
        const [year, month] = (hidden.value || today || isoDate(...[new Date().getFullYear(), new Date().getMonth(), 1])).split('-').map(Number);
        shown = {year, month: month - 1};
        popover = el('div', {className: `date-popover ${placement}`, role: 'dialog', 'aria-label': label});
        root.append(popover);
        draw();
        document.addEventListener('click', outsideClick, true);
    };

    button.addEventListener('click', () => (popover ? close() : open()));
    root.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && popover) {
            event.preventDefault();
            event.stopPropagation();
            close();
        }
    });
    showValue();
    return root;
}

export function pageHeader(title, subtitle, ...actions) {
    return el('header', {className: 'card page-head'},
        el('div', {}, el('h1', {}, title), el('p', {className: 'muted'}, subtitle)),
        el('div', {className: 'head-actions'}, actions),
    );
}

export function closeDialog() {
    document.getElementById('dialog').close();
}

export function openDialog(...content) {
    const dialog = document.getElementById('dialog');
    dialog.replaceChildren(...content);
    dialog.showModal();
}

// onSubmit returns an error message to show in the dialog, or '' when done.
export function formDialog({title, fields, submitLabel = 'Save', onSubmit}) {
    const message = el('p', {className: 'error', hidden: true});
    const form = el('form', {method: 'dialog', className: 'form'},
        el('div', {className: 'dialog-head'}, el('h2', {}, title),
            el('button', {type: 'button', className: 'close', 'aria-label': 'Close', onclick: closeDialog}, '×')),
        fields,
        message,
        el('div', {className: 'form-actions'},
            el('button', {type: 'button', onclick: closeDialog}, 'Cancel'),
            el('button', {type: 'submit', className: 'primary'}, submitLabel),
        ),
    );
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const error = await onSubmit(new FormData(form), form);
        if (error) {
            message.textContent = error;
            message.hidden = false;
        } else {
            closeDialog();
        }
    });
    openDialog(form);
    form.querySelector('input:not([type=hidden]), select')?.focus();
    return form;
}
