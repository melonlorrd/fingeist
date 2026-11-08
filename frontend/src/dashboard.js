import {Dashboard, PresetRange} from '../bindings/fingeist/app.js';

import {datePicker, el, pageHeader} from './dom.js';

const PRESETS = [
    ['this_month', 'This month'],
    ['three_months', '3 months'],
    ['year_to_date', 'Year to date'],
    ['all_time', 'All time'],
];

const range = {from: '', to: '', preset: 'all_time'};

let charts = null;

export function disposeCharts() {
    charts?.disposeCharts();
}

export async function render(container, ctx) {
    const picker = (name, value, label) => datePicker({
        name, value, label, today: ctx.boot.today, clearable: true,
        onchange: () => {
            Object.assign(range, {from: fromPicker.value, to: toPicker.value, preset: ''});
            ctx.rerender();
        },
    });
    const fromPicker = picker('from', range.from, 'From date');
    const toPicker = picker('to', range.to, 'To date');

    const presets = el('div', {className: 'pills', role: 'group', 'aria-label': 'Range'},
        PRESETS.map(([name, label]) => el('button', {
            className: range.preset === name ? 'active' : '',
            'aria-pressed': String(range.preset === name),
            onclick: async () => {
                Object.assign(range, await PresetRange(name), {preset: name});
                ctx.rerender();
            },
        }, label)));

    const data = await Dashboard(range.from, range.to);

    const cards = el('section', {className: 'summary'}, data.summary.cards.map((card) => el('article', {className: 'card summary-card'},
        el('small', {className: 'label'}, card.label),
        el('strong', {className: 'big'}, card.value.text),
        card.detail ? el('small', {className: 'muted'}, card.detail) : null,
        el('small', {className: 'change'}, card.change),
    )));
    const chartsSection = el('section', {className: 'charts'});

    container.replaceChildren(
        pageHeader('Dashboard', 'Habits, cash flow and spending patterns', presets,
            el('div', {className: 'range-pickers'}, el('span', {className: 'muted'}, 'From'), fromPicker, el('span', {className: 'muted'}, 'To'), toPicker)),
        cards,
        chartsSection,
    );
    charts ??= await import('./charts.js');
    charts.renderCharts(chartsSection, data.charts, ctx);
}
