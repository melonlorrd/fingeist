import {el, field} from './dom.js';

// onCreate(name, currency, decimals, categories) returns an error message, or '' when done.
export function renderSetup(container, onCreate) {
    const message = el('p', {className: 'error', hidden: true});
    const form = el('form', {className: 'form card setup'},
        el('h2', {}, 'Set up your first project'),
        el('p', {className: 'muted'}, 'The currency and its decimal places cannot be changed later. Use one project per currency.'),
        field('Project name', el('input', {name: 'name', required: true, placeholder: 'Household', autocomplete: 'off'})),
        field('Currency code', el('input', {name: 'currency', required: true, placeholder: 'USD', maxLength: 8, autocomplete: 'off'})),
        field('Decimal places (2 for USD, 0 for JPY)', el('input', {name: 'decimals', type: 'number', required: true, min: 0, max: 18, value: 2})),
        field('Categories (separated by commas)', el('input', {name: 'categories', placeholder: 'groceries, rent, transport', autocomplete: 'off'})),
        message,
        el('div', {className: 'form-actions'}, el('button', {type: 'submit', className: 'primary'}, 'Create project')),
    );

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        const categories = data.categories.split(',').map((c) => c.trim()).filter(Boolean);
        const error = await onCreate(data.name, data.currency, Number(data.decimals), categories);
        if (error) {
            message.textContent = error;
            message.hidden = false;
        }
    });

    container.replaceChildren(form);
}
