import {el, field} from './dom.js';
import {syncFields, syncInput} from './sync.js';

function setupForm(title, intro, fields, submitLabel, onSubmit) {
    const message = el('p', {className: 'error', hidden: true});
    const form = el(
        'form',
        {className: 'form card'},
        el('h2', {}, title),
        el('p', {className: 'muted'}, intro),
        fields,
        message,
        el('div', {className: 'form-actions'}, el('button', {type: 'submit', className: 'primary'}, submitLabel)),
    );
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        message.hidden = true;
        const error = await onSubmit(new FormData(form));
        if (error) {
            message.textContent = error;
            message.hidden = false;
        }
    });
    return form;
}

export function renderSetup(container, ctx) {
    const create = setupForm(
        'Start a new project',
        "Your data stays in this browser. You can sync it with your other devices later, from Settings. The currency and its decimal places can't be changed later.",
        [
            field('Project name', el('input', {name: 'name', required: true, placeholder: 'Household', autocomplete: 'off'})),
            field('Currency code', el('input', {name: 'currency', required: true, value: 'INR', maxLength: 8, autocomplete: 'off'})),
            field(
                'Decimal places (2 for INR, 0 for JPY)',
                el('input', {name: 'decimals', type: 'number', required: true, min: 0, max: 4, value: 2}),
            ),
        ],
        'Create project',
        (data) =>
            ctx.perform(() =>
                ctx.app.createProject({
                    name: data.get('name'),
                    currency: data.get('currency'),
                    decimals: Number(data.get('decimals')),
                }),
            ),
    );

    const join = setupForm(
        'Join from another device',
        'Already using Fingeist with sync on another device? Enter the same repository and passphrase, with a token made for this device.',
        syncFields(false),
        'Join',
        (data) =>
            ctx.perform(async () => {
                const status = await ctx.app.join(syncInput(data));
                if (status.state !== 'idle') {
                    ctx.notify(`Joined, but the first sync did not finish: ${status.message}`, true);
                }
            }),
    );

    container.replaceChildren(el('div', {className: 'setup-choice'}, create, join));
}
