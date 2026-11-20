import {budgetSummary} from './categories.js';
import * as charts from './charts.js';
import {datePicker, el, figure, fill, pageHeader, slideIn, slideOut} from './dom.js';
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
    ['Cash flow', ['running_balance', 'monthly_totals']],
    ['Where it goes', ['by_category', 'top_merchants']],
    ['Habits', ['spending_calendar', 'hour_routine', 'intent_trends', 'small_purchases']],
];

const range = {from: '', to: '', preset: 'this_month', account: ''};
let rangeSet = false;
let lastRange = '';
// A preset picked to the right of the current one slides the figures left, and the other way round.
let slide = 0;

/** Everything under the page header: the figures that change with the range. */
function content(container) {
    return [...container.children].filter((child) => !child.classList.contains('page-head'));
}

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
                    onclick: async () => {
                        const index = (preset) => PRESETS.findIndex(([n]) => n === preset);
                        slide = Math.sign(index(name) - index(range.preset));
                        Object.assign(range, name ? ctx.app.presetRange(name) : {}, {preset: name});
                        await slideOut(content(container), slide);
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
    // Cards arrive with motion when the dashboard opens or the range changes, not when an edit or sync redraws it.
    const animate = ctx.fresh || JSON.stringify(range) !== lastRange;
    lastRange = JSON.stringify(range);
    container.classList.toggle('enter', animate);
    const direction = slide;
    slide = 0;
    // Figures reached by a sideways step slide in as a whole, so their cards don't also rise.
    container.classList.toggle('paged', direction !== 0 || container.classList.contains('paged'));

    const cards = el(
        'section',
        {className: 'summary'},
        data.summary.cards.map((card, index) =>
            el(
                'article',
                {className: 'card summary-card', style: `--i:${index}`},
                el('small', {className: 'label'}, card.label),
                el('strong', {className: 'big'}, figure(card.value)),
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
        ctx.boot.budgets.rows.length > 0 ? el('article', {className: 'card', style: '--i:4'}, budgetSummary(ctx.boot.budgets)) : null,
        chartsSection,
    );
    slideIn(content(container), direction);
    const shown = charts.visibleCharts(data.charts);
    if (shown.every(charts.isEmpty)) {
        chartsSection.append(el('p', {className: 'card muted'}, 'Charts appear here once this range has entries.'));
        return;
    }
    const groupOf = (type) => GROUPS.findIndex(([, types]) => types.includes(type));
    let first = 5;
    for (const [index, [title]] of GROUPS.entries()) {
        const inGroup = shown.filter((c) => (groupOf(c.type) === -1 ? GROUPS.length - 1 : groupOf(c.type)) === index);
        if (inGroup.length > 0) {
            const grid = el('div', {className: 'charts'});
            chartsSection.append(
                el('section', {className: 'chart-group'}, el('h2', {className: 'group-title', style: `--i:${first}`}, title), grid),
            );
            charts.renderCharts(grid, inGroup, ctx, {first, animate});
            first += inGroup.length;
        }
    }
}
