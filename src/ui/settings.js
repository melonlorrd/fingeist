import {el, field, pageHeader} from './dom.js';
import {eraseDevice, syncCard} from './sync.js';

const DAYS = [
    ['mon', 'Mon'],
    ['tue', 'Tue'],
    ['wed', 'Wed'],
    ['thu', 'Thu'],
    ['fri', 'Fri'],
    ['sat', 'Sat'],
    ['sun', 'Sun'],
];
const EVERY = {day: 'every day', week: 'every week', month: 'every month', year: 'every year'};

const section = (title, hint, ...children) =>
    el(
        'section',
        {className: 'card form'},
        el('div', {}, el('h2', {}, title), hint ? el('p', {className: 'muted'}, hint) : null),
        children,
    );

export async function render(container, ctx) {
    const s = ctx.boot.settings;
    const form = el(
        'form',
        {className: 'settings'},
        pageHeader('Settings', 'Project, repeats, sync and export', el('button', {type: 'submit', className: 'primary'}, 'Save settings')),
        el(
            'div',
            {className: 'settings-grid'},
            section(
                'Project',
                null,
                field('Name', el('input', {name: 'name', value: s.name, required: true, autocomplete: 'off'})),
                field('Currency', el('input', {value: s.currency, disabled: true}), 'Fixed when the project was created.'),
                field(
                    'Months start on day',
                    el('input', {name: 'monthStart', type: 'number', min: 1, max: 28, value: s.monthStart}),
                    'For a salary cycle, e.g. 25. Used by month presets, monthly charts and budgets.',
                ),
            ),
            section(
                'Small purchases',
                'Expenses at or under these amounts are tracked on the dashboard.',
                field(
                    'Thresholds',
                    el('input', {name: 'thresholds', value: s.thresholds.join(', '), autocomplete: 'off'}),
                    `Amounts in ${s.currency}, separated by commas.`,
                ),
            ),
            section(
                'Workdays',
                'Used by the workday routine chart.',
                el(
                    'div',
                    {className: 'checks', role: 'group', 'aria-label': 'Workdays'},
                    DAYS.map(([value, label]) =>
                        el(
                            'label',
                            {},
                            el('input', {type: 'checkbox', name: 'workday', value, checked: s.workdays.includes(value)}),
                            label,
                        ),
                    ),
                ),
            ),
        ),
    );
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = new FormData(form);
        const error = await ctx.perform(() =>
            ctx.app.saveSettings({
                name: data.get('name'),
                thresholds: String(data.get('thresholds') ?? '').split(','),
                workdays: data.getAll('workday'),
                monthStart: data.get('monthStart'),
            }),
        );
        ctx.notify(error || 'Settings saved.', Boolean(error));
    });

    container.replaceChildren(
        form,
        el(
            'div',
            {className: 'settings-grid'},
            repeatsCard(ctx),
            syncCard(ctx),
            section(
                'Export',
                'A readable copy of everything, decrypted, to keep or open elsewhere.',
                el(
                    'div',
                    {className: 'head-actions'},
                    el(
                        'button',
                        {onclick: () => download(`${s.name}.json`, 'application/json', ctx.app.exportJson())},
                        'Everything (JSON)',
                    ),
                    el('button', {onclick: () => download(`${s.name}.csv`, 'text/csv', ctx.app.exportCsv())}, 'Ledger (CSV)'),
                ),
            ),
            section(
                'This device',
                'Fingeist keeps your data in this browser. Erasing removes it from this device only.',
                el('div', {}, el('button', {className: 'destructive', onclick: () => eraseDevice(ctx)}, 'Erase this device')),
            ),
        ),
    );
}

function repeatsCard(ctx) {
    const act = async (change) => {
        const error = await ctx.perform(change);
        if (error) {
            ctx.notify(error, true);
        }
    };
    const repeats = ctx.boot.recurring;
    return section(
        'Repeats',
        'Rent, subscriptions, salary. Make one by choosing Repeat when adding an entry. Past entries stay when you stop a repeat.',
        repeats.length === 0
            ? el('p', {className: 'muted'}, 'Nothing repeats yet.')
            : el(
                  'ul',
                  {className: 'account-list'},
                  repeats.map((r) =>
                      el(
                          'li',
                          {className: r.paused ? 'archived' : ''},
                          el(
                              'span',
                              {},
                              el('strong', {}, r.label),
                              el(
                                  'small',
                                  {className: 'muted'},
                                  ` ${r.amount}, ${EVERY[r.every]} from ${r.start}${r.until ? ` until ${r.until}` : ''}${r.paused ? ', paused' : ''}`,
                              ),
                          ),
                          el('span'),
                          el(
                              'span',
                              {className: 'actions'},
                              el(
                                  'button',
                                  {className: 'quiet', onclick: () => act(() => ctx.app.setRepeatPaused(r.id, !r.paused))},
                                  r.paused ? 'Resume' : 'Pause',
                              ),
                              r.until
                                  ? null
                                  : el('button', {className: 'quiet', onclick: () => act(() => ctx.app.stopRepeat(r.id))}, 'Stop'),
                              el('button', {className: 'quiet danger', onclick: () => act(() => ctx.app.deleteRepeat(r.id))}, 'Delete'),
                          ),
                      ),
                  ),
              ),
    );
}

function download(name, type, text) {
    const url = URL.createObjectURL(new Blob([text], {type}));
    const link = el('a', {href: url, download: name});
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
