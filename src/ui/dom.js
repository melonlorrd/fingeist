import {icon} from './icons.js';

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
    node.append(...children.flat(Infinity).filter((child) => child != null));
    return node;
}

// Like replaceChildren, but accepts arrays and skips null.
export function fill(node, ...children) {
    node.replaceChildren(...children.flat(Infinity).filter((child) => child != null));
}

/**
 * A labelled form field. A single input gets a <label>; a group of buttons or pickers gets a named group.
 * A hint stays behind an (i) button until asked for.
 */
export function field(label, input, hint) {
    const single = ['INPUT', 'SELECT', 'TEXTAREA'].includes(input.tagName);
    const group = single ? {} : {role: 'group', 'aria-label': label};
    if (!hint) {
        return el(single ? 'label' : 'div', {className: 'field', ...group}, el('span', {}, label), input);
    }
    // The (i) button sits outside the <label>, so it doesn't become part of the input's name.
    const tip = infoTip(hint, `About ${label}`);
    let caption = el('span', {}, label);
    if (single) {
        input.id ||= `field-${++fieldCount}`;
        caption = el('label', {htmlFor: input.id}, label);
    }
    return el('div', {className: 'field', ...group}, el('div', {className: 'field-head'}, caption, tip.button), tip.hint, input);
}

let fieldCount = 0;

/** A round (i) button and the hint it shows or hides; place both where they belong. */
export function infoTip(text, label = 'More info') {
    const hint = el('small', {className: 'hint', hidden: true}, text);
    const button = el(
        'button',
        {
            type: 'button',
            className: 'info',
            'aria-label': label,
            'aria-expanded': 'false',
            onclick: () => {
                hint.hidden = !hint.hidden;
                button.setAttribute('aria-expanded', String(!hint.hidden));
                button.classList.toggle('active', !hint.hidden);
            },
        },
        icon('info'),
    );
    return {button, hint};
}

export function dayLabel(date) {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}

/** A date as a short axis label, like "Nov 3". */
export function shortDayLabel(date) {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {day: 'numeric', month: 'short'});
}

/** A month as a short axis label, like "Nov 26". */
export function shortMonthLabel(month) {
    const [year, number] = month.split('-').map(Number);
    return new Date(year, number - 1, 1).toLocaleDateString(undefined, {month: 'short', year: '2-digit'});
}

export function monthLabel(month) {
    const [year, number] = month.split('-').map(Number);
    return new Date(year, number - 1, 1).toLocaleDateString(undefined, {month: 'long', year: 'numeric'});
}

// Resolves true when the user confirms; Esc and Cancel resolve false.
export function confirmDialog(message, confirmLabel = 'Delete') {
    return new Promise((resolve) => {
        const dialog = dialogElement();
        let settled = false;
        // A dialog closed just before this one fires its close event late, once this one is open; only a real close cancels.
        const onClose = () => {
            if (!dialog.open) {
                settle(false);
            }
        };
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
        openDialog(
            el(
                'div',
                {className: 'form'},
                el('h2', {}, 'Are you sure?'),
                el('p', {className: 'muted'}, message),
                el(
                    'div',
                    {className: 'form-actions'},
                    el('button', {type: 'button', onclick: () => settle(false)}, 'Cancel'),
                    el('button', {type: 'button', className: 'destructive', onclick: () => settle(true)}, confirmLabel),
                ),
            ),
        );
    });
}

const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (year, month, day) => `${year}-${pad(month + 1)}-${pad(day)}`;

/** A large amount, with its minor units (".00") set smaller and muted so the whole number reads first. */
export function figure(amount) {
    return [amount.whole, amount.fraction ? el('span', {className: 'fraction'}, amount.fraction) : null];
}

/** "14 Nov 2026" for 2026-11-14. */
export function dateText(iso) {
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'});
}

/**
 * A pill button that opens a month calendar. Its `name`d hidden input carries the YYYY-MM-DD value,
 * also readable as `.value`. today is YYYY-MM-DD; placement is 'below' or 'above'.
 * @param {{name: string, value?: string, placeholder?: string, label: string, today: string, clearable?: boolean,
 *   placement?: string, onchange?: (iso: string) => void}} options
 */
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
        fill(
            popover,
            el(
                'div',
                {className: 'date-head'},
                el(
                    'button',
                    {type: 'button', className: 'quiet', 'aria-label': 'Previous month', onclick: () => step(-1)},
                    icon('previous'),
                ),
                el('strong', {}, new Date(year, month, 1).toLocaleDateString(undefined, {month: 'long', year: 'numeric'})),
                el('button', {type: 'button', className: 'quiet', 'aria-label': 'Next month', onclick: () => step(1)}, icon('next')),
            ),
            el(
                'div',
                {className: 'date-grid'},
                WEEKDAY_LETTERS.map((letter) => el('small', {className: 'muted'}, letter)),
                cells.map((day) => {
                    if (day === null) {
                        return el('span');
                    }
                    const iso = isoDate(year, month, day);
                    return el(
                        'button',
                        {
                            type: 'button',
                            className: `${iso === hidden.value ? 'selected' : ''} ${iso === today ? 'today' : ''}`,
                            onclick: () => choose(iso),
                        },
                        String(day),
                    );
                }),
            ),
            el(
                'div',
                {className: 'date-foot'},
                clearable ? el('button', {type: 'button', className: 'quiet', onclick: () => choose('')}, 'Clear') : el('span'),
                today ? el('button', {type: 'button', className: 'quiet', onclick: () => choose(today)}, 'Today') : null,
            ),
        );
    };
    const step = (delta) => {
        const moved = new Date(shown.year, shown.month + delta, 1);
        shown = {year: moved.getFullYear(), month: moved.getMonth()};
        draw();
    };
    const open = () => {
        const [year, month] = (hidden.value || today || isoDate(...[new Date().getFullYear(), new Date().getMonth(), 1]))
            .split('-')
            .map(Number);
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
    return el(
        'header',
        {className: 'card page-head'},
        el('div', {}, el('h1', {}, title), subtitle ? el('p', {className: 'muted'}, subtitle) : null),
        el('div', {className: 'head-actions'}, actions),
    );
}

/** The page's one <dialog>, from index.html. */
export function dialogElement() {
    return /** @type {HTMLDialogElement} */ (document.getElementById('dialog'));
}

export function closeDialog() {
    dialogElement().close();
}

let lastTap = null;

/** Remembers where the last tap or click landed, so a dialog it opens can grow from there. */
export function rememberTap(event) {
    lastTap = {x: event.clientX, y: event.clientY, at: event.timeStamp};
}

export function openDialog(...content) {
    const dialog = dialogElement();
    dialog.replaceChildren(...content);
    dialog.showModal();
    const rect = dialog.getBoundingClientRect();
    const recent = lastTap && performance.now() - lastTap.at < 1000;
    dialog.style.setProperty('--origin', recent ? `${lastTap.x - rect.left}px ${lastTap.y - rect.top}px` : 'center');
}

const SLIDE_PX = 32;

function moving() {
    return window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches ?? false;
}

/** Content being replaced drifts toward the side it leaves by and fades; resolves when it is gone. */
export async function slideOut(elements, direction) {
    const shown = elements.filter((e) => e?.animate);
    if (!moving() || direction === 0 || shown.length === 0) {
        return;
    }
    const exits = shown.map((e) =>
        e.animate([{opacity: 1}, {opacity: 0, transform: `translateX(${-direction * SLIDE_PX}px)`}], {
            duration: 140,
            easing: 'cubic-bezier(0.4, 0, 1, 1)',
            fill: 'forwards',
        }),
    );
    await Promise.all(exits.map((a) => a.finished.catch(() => {})));
}

/** New content comes in from the side it belongs to, on the same curve and duration (--t-enter) as every other entrance. */
export function slideIn(elements, direction) {
    if (!moving() || direction === 0) {
        return;
    }
    const easing = getComputedStyle(document.documentElement).getPropertyValue('--ease-enter').trim() || 'ease-out';
    for (const e of elements) {
        e?.animate?.(
            [
                {opacity: 0, transform: `translateX(${direction * SLIDE_PX}px)`},
                {opacity: 1, transform: 'none'},
            ],
            {duration: 520, easing},
        );
    }
}

/** Moves each pill group's sliding highlight under its active pill, in the active pill's colour. */
export function placePillHighlights() {
    for (const group of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.pills'))) {
        const active = /** @type {HTMLElement | null} */ (group.querySelector(':scope > button.active'));
        if (!active || active.offsetWidth === 0) {
            group.classList.remove('sliding', 'ready');
            continue;
        }
        group.style.setProperty('--pill-x', `${active.offsetLeft}px`);
        group.style.setProperty('--pill-y', `${active.offsetTop}px`);
        group.style.setProperty('--pill-w', `${active.offsetWidth}px`);
        group.style.setProperty('--pill-h', `${active.offsetHeight}px`);
        group.style.setProperty('--pill-tone', getComputedStyle(active).getPropertyValue('--tone').trim() || 'var(--tint)');
        if (!group.classList.contains('sliding')) {
            // A freshly drawn row that scrolls sideways opens with its active pill in view, centred where it can be.
            if (group.classList.contains('scroll')) {
                group.scrollLeft = active.offsetLeft - (group.clientWidth - active.offsetWidth) / 2;
            }
            group.classList.add('sliding');
            // Place it before turning the transition on, so a new group doesn't slide in from the corner.
            requestAnimationFrame(() => group.classList.add('ready'));
        }
    }
}

/**
 * A dialog with a form. onSubmit returns an error message to show in the dialog, or '' when done.
 * actions are extra buttons for the footer, such as Delete.
 * @param {{title: string, fields: unknown[], submitLabel?: string, actions?: HTMLElement[],
 *   onSubmit: (data: FormData, form: HTMLFormElement) => Promise<string> | string}} options
 */
export function formDialog({title, fields, submitLabel = 'Save', actions = [], onSubmit}) {
    const message = el('p', {className: 'error', hidden: true});
    const form = el(
        'form',
        {method: 'dialog', className: 'form'},
        el(
            'div',
            {className: 'dialog-head'},
            el('h2', {}, title),
            el('button', {type: 'button', className: 'close', 'aria-label': 'Close', onclick: closeDialog}, icon('close')),
        ),
        fields,
        message,
        el(
            'div',
            {className: 'form-actions'},
            actions,
            el('span', {className: 'grow'}),
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
    form.querySelector('input:not([type=hidden]):not([readonly]), select')?.focus();
    return form;
}
