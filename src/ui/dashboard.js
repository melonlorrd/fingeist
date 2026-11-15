import {budgetSummary} from './categories.js';
import * as charts from './charts.js';
import {datePicker, el, fill, pageHeader} from './dom.js';

const PRESETS = [
    ['this_month', 'This month'],
    ['last_month', 'Last month'],
    ['last_30_days', '30 days'],
    ['three_months', '3 months'],
    ['year_to_date', 'Year'],
    ['all_time', 'All time'],
];

const range = {from: '', to: '', preset: 'all_time', account: ''};

export function disposeCharts() {
    charts.disposeCharts();
}

export async function render(container, ctx) {
    const picker = (name, value, label) =>
        datePicker({
            name,
            value,
            label,
            today: ctx.boot.today,
            clearable: true,
            onchange: () => {
                Object.assign(range, {from: fromPicker.value, to: toPicker.value, preset: ''});
                ctx.rerender();
            },
        });
    const fromPicker = picker('from', range.from, 'From date');
    const toPicker = picker('to', range.to, 'To date');

    const presets = el(
        'div',
        {className: 'pills scroll', role: 'group', 'aria-label': 'Range'},
        PRESETS.map(([name, label]) =>
            el(
                'button',
                {
                    className: range.preset === name ? 'active' : '',
                    'aria-pressed': String(range.preset === name),
                    onclick: () => {
                        Object.assign(range, ctx.app.presetRange(name), {preset: name});
                        ctx.rerender();
                    },
                },
                label,
            ),
        ),
    );
    const account = el(
        'select',
        {
            'aria-label': 'Account',
            onchange: () => {
                range.account = account.value;
                ctx.rerender();
            },
        },
        el('option', {value: ''}, 'All accounts'),
        ctx.boot.accounts.map((a) => el('option', {value: a.id, selected: a.id === range.account}, a.name)),
    );

    const data = ctx.app.dashboard(range);

    const cards = el(
        'section',
        {className: 'summary'},
        data.summary.cards.map((card) =>
            el(
                'article',
                {className: 'card summary-card'},
                el('small', {className: 'label'}, card.label),
                el('strong', {className: 'big'}, card.value.text),
                card.detail ? el('small', {className: 'muted'}, card.detail) : null,
                el('small', {className: 'change'}, card.change),
            ),
        ),
    );
    const chartsSection = el('section', {className: 'charts'});

    fill(
        container,
        pageHeader(
            'Dashboard',
            'Habits, cash flow and spending patterns',
            presets,
            el(
                'div',
                {className: 'range-pickers'},
                el('span', {className: 'muted'}, 'From'),
                fromPicker,
                el('span', {className: 'muted'}, 'To'),
                toPicker,
                account,
            ),
        ),
        cards,
        ctx.boot.budgets.rows.length > 0 ? el('article', {className: 'card'}, budgetSummary(ctx.boot.budgets)) : null,
        chartsSection,
    );
    charts.renderCharts(chartsSection, data.charts, ctx);
}
