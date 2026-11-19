import {budgetSummary} from './categories.js';
import * as charts from './charts.js';
import {datePicker, el, fill, pageHeader} from './dom.js';
import {icon} from './icons.js';

const PRESETS = [
    ['this_month', 'This month'],
    ['last_month', 'Last month'],
    ['last_30_days', '30 days'],
    ['three_months', '3 months'],
    ['year_to_date', 'Year'],
    ['all_time', 'All time'],
    ['', 'Custom'],
];

// Charts are grouped by the question they answer; a chart not listed here goes in the last group.
const GROUPS = [
    ['Cash flow', ['monthly_totals', 'running_balance']],
    ['Where it goes', ['by_category', 'category_compare', 'top_merchants']],
    ['Habits', ['intent_trends', 'small_purchases', 'workday_routine', 'weekday_hour_heatmap']],
    ['Calendar', ['calendar_heatmap', 'no_spend_calendar']],
];

const range = {from: '', to: '', preset: 'this_month', account: ''};
let rangeSet = false;

export function disposeCharts() {
    charts.disposeCharts();
}

export async function render(container, ctx) {
    if (!rangeSet) {
        Object.assign(range, ctx.app.presetRange(range.preset));
        rangeSet = true;
    }
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
                        Object.assign(range, name ? ctx.app.presetRange(name) : {}, {preset: name});
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
                el('small', {className: `change ${card.trend}`}, card.direction ? icon(card.direction) : null, el('span', {}, card.change)),
            ),
        ),
    );
    const chartsSection = el('div', {className: 'chart-groups'});

    fill(
        container,
        pageHeader(
            'Dashboard',
            '',
            presets,
            el(
                'div',
                {className: 'range-pickers'},
                range.preset === ''
                    ? [el('span', {className: 'muted'}, 'From'), fromPicker, el('span', {className: 'muted'}, 'To'), toPicker]
                    : null,
                account,
            ),
        ),
        cards,
        ctx.boot.budgets.rows.length > 0 ? el('article', {className: 'card'}, budgetSummary(ctx.boot.budgets)) : null,
        chartsSection,
    );
    const groupOf = (type) => GROUPS.findIndex(([, types]) => types.includes(type));
    for (const [index, [title]] of GROUPS.entries()) {
        const inGroup = data.charts.filter((c) => (groupOf(c.type) === -1 ? GROUPS.length - 1 : groupOf(c.type)) === index);
        if (inGroup.length > 0) {
            const grid = el('div', {className: 'charts'});
            chartsSection.append(el('section', {className: 'chart-group'}, el('h2', {className: 'group-title'}, title), grid));
            charts.renderCharts(grid, inGroup, ctx);
        }
    }
}
