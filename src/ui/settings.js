import {closeDialog, el, field, formDialog, infoTip, pageHeader} from './dom.js';
import {eraseDevice, syncCard} from './sync.js';

const EVERY = {day: 'every day', week: 'every week', month: 'every month', year: 'every year'};

function section(title, hint, ...children) {
    const tip = hint ? infoTip(hint, `About ${title}`) : null;
    return el(
        'section',
        {className: 'card form'},
        el('div', {className: 'card-head'}, el('h2', {}, title), tip?.button),
        tip?.hint,
        children,
    );
}

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
        ),
    );
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = new FormData(form);
        const error = await ctx.perform(() =>
            ctx.app.saveSettings({
                name: data.get('name'),
                thresholds: String(data.get('thresholds') ?? '').split(','),
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
    const repeats = ctx.boot.recurring;
    const detail = (r) =>
        `${r.amount}, ${EVERY[r.every]} from ${r.start}${r.until ? ` until ${r.until}` : ''}${r.paused ? ' · paused' : ''}`;
    return section(
        'Repeats',
        'Rent, subscriptions, salary. Make one by choosing Repeat when adding an entry. Past entries stay when you stop a repeat.',
        repeats.length === 0
            ? el('p', {className: 'muted'}, 'Nothing repeats yet.')
            : el(
                  'ul',
                  {className: 'card rows'},
                  repeats.map((r) =>
                      el(
                          'li',
                          {},
                          el(
                              'button',
                              {className: 'row', onclick: () => openRepeat(ctx, r, detail(r))},
                              el('span'),
                              el('span', {className: 'what'}, el('strong', {}, r.label), el('small', {className: 'muted'}, detail(r))),
                              el('span'),
                              el('span'),
                          ),
                      ),
                  ),
              ),
    );
}

function openRepeat(ctx, repeat, detail) {
    const act = async (change) => {
        closeDialog();
        const error = await ctx.perform(change);
        if (error) {
            ctx.notify(error, true);
        }
    };
    formDialog({
        title: repeat.label,
        fields: [el('p', {className: 'muted'}, detail), el('p', {className: 'muted'}, 'Entries already added stay, whatever you do here.')],
        submitLabel: repeat.paused ? 'Resume' : 'Pause',
        actions: [
            el('button', {type: 'button', className: 'quiet danger', onclick: () => act(() => ctx.app.deleteRepeat(repeat.id))}, 'Delete'),
            repeat.until
                ? null
                : el('button', {type: 'button', className: 'quiet', onclick: () => act(() => ctx.app.stopRepeat(repeat.id))}, 'Stop today'),
        ].filter((b) => b !== null),
        onSubmit: () => ctx.perform(() => ctx.app.setRepeatPaused(repeat.id, !repeat.paused)),
    });
}

function download(name, type, text) {
    const url = URL.createObjectURL(new Blob([text], {type}));
    const link = el('a', {href: url, download: name});
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
