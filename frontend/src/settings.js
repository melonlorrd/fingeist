import {OpenProjectFolder, SaveSettings} from '../wailsjs/go/main/App';

import {el, field, pageHeader} from './dom.js';

const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
const CLASSES = [['mutual_fund', 'Mutual funds'], ['equity', 'Equity'], ['gold', 'Gold']];

export async function render(container, ctx) {
    const s = ctx.boot.settings;
    const message = el('p', {className: 'notice error', hidden: true});

    const section = (title, hint, ...children) => el('section', {className: 'card form'},
        el('div', {}, el('h2', {}, title), hint ? el('p', {className: 'muted'}, hint) : null),
        children,
    );

    const form = el('form', {className: 'settings'},
        pageHeader('Settings', 'Project name, thresholds, workdays and portfolio targets',
            el('button', {type: 'submit', className: 'primary'}, 'Save settings')),
        message,
        el('div', {className: 'settings-grid'},
            section('Project', null,
                field('Name', el('input', {name: 'name', value: s.name, required: true, autocomplete: 'off'})),
                field('Currency', el('input', {value: s.currency, disabled: true}), 'Fixed when the project was created.'),
                el('div', {}, el('button', {
                    type: 'button',
                    onclick: () => OpenProjectFolder().catch((err) => ctx.notify(String(err?.message ?? err), true)),
                }, 'Show project folder'))),
            section('Small purchases', 'Expenses at or under these amounts are tracked on the dashboard.',
                field('Thresholds', el('input', {name: 'thresholds', value: s.smallPurchaseThresholds.join(', '), autocomplete: 'off'}),
                    `Amounts in ${s.currency}, separated by commas.`)),
            section('Workdays', 'Used by the workday routine chart.',
                el('div', {className: 'checks', role: 'group', 'aria-label': 'Workdays'}, DAYS.map(([value, label]) => el('label', {},
                    el('input', {type: 'checkbox', name: 'workday', value, checked: s.workdays.includes(value)}), label)))),
            section('Portfolio targets', 'Target share of each asset class, in percent. Leave all blank for no targets; otherwise they must add up to 100.',
                el('div', {className: 'row-fields'}, CLASSES.map(([value, label]) => field(label,
                    el('input', {name: `target-${value}`, type: 'number', min: 0, max: 100, step: 1, value: s.targetAllocation[value] ?? ''}))))),
        ),
    );

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = new FormData(form);
        const targets = {};
        for (const [value] of CLASSES) {
            const text = data.get(`target-${value}`);
            if (text !== '') {
                targets[value] = Number(text);
            }
        }
        const error = await ctx.perform(() => SaveSettings({
            name: data.get('name'),
            currency: s.currency,
            smallPurchaseThresholds: data.get('thresholds').split(',').map((t) => t.trim()).filter(Boolean),
            workdays: data.getAll('workday'),
            targetAllocation: targets,
        }));
        message.textContent = error;
        message.hidden = !error;
        if (!error) {
            ctx.notify('Settings saved.');
        }
    });

    container.replaceChildren(form);
}
