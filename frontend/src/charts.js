import * as echarts from 'echarts/core';
import {BarChart, HeatmapChart, LineChart} from 'echarts/charts';
import {CalendarComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent} from 'echarts/components';
import {LegacyGridContainLabel} from 'echarts/features';
import {CanvasRenderer} from 'echarts/renderers';

import {el, monthLabel, openDialog, closeDialog} from './dom.js';
import {editTransaction} from './ledger.js';

echarts.use([BarChart, HeatmapChart, LineChart, CalendarComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent, LegacyGridContainLabel, CanvasRenderer]);

const CATEGORY_ROW_HEIGHT = 36;
const DEFAULT_HEIGHT = 300;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const BAR = {barMaxWidth: 32, itemStyle: {borderRadius: [4, 4, 0, 0]}};

let instances = [];
let observers = [];

let smallIndex = 0;
let noSpendIndex = null;

// Every chart type: how to tell it has nothing to show, and how to draw it.
const hints = {
    monthly_totals: 'Income and expenses by month',
    by_category: 'Where the money went',
    calendar_heatmap: 'Spending per day',
    running_balance: 'Balance at the end of each day',
    intent_trends: 'Need, want and impulse over time',
    small_purchases: 'Small expenses that quietly add up',
    workday_routine: 'Spending by hour on workdays',
    weekday_hour_heatmap: 'Spending by weekday and hour',
    no_spend_calendar: 'Days without spending',
};

const types = {
    monthly_totals: {empty: (c) => c.months.length === 0, render: (body, c) => mount(body, monthlyTotalsOption, c)},
    by_category: {empty: (c) => c.categories.length === 0, render: (body, c) => mount(body, byCategoryOption, c, Math.max(180, c.categories.length * CATEGORY_ROW_HEIGHT + 24))},
    calendar_heatmap: {empty: (c) => c.days.length === 0, render: (body, c) => mount(body, calendarHeatmapOption, c, 230)},
    running_balance: {empty: (c) => c.balance.length === 0, render: (body, c) => mount(body, runningBalanceOption, c)},
    intent_trends: {empty: (c) => c.intentMonths.length === 0, render: renderIntentTrends, notes: intentNote},
    small_purchases: {empty: (c) => c.expenseCount === 0, render: renderSmallPurchases},
    workday_routine: {empty: (c) => c.hours.every((h) => h.occurrences === 0), render: renderWorkdayRoutine, notes: noTimeNote},
    weekday_hour_heatmap: {empty: (c) => c.cells.length === 0, render: renderWeekdayHours, notes: noTimeNote},
    no_spend_calendar: {empty: (c) => c.noSpend.length === 0, render: renderNoSpend},
};

export function disposeCharts() {
    observers.forEach((observer) => observer.disconnect());
    instances.forEach((instance) => instance.dispose());
    observers = [];
    instances = [];
}

export function renderCharts(container, charts, ctx) {
    container.replaceChildren(...charts.map((chart) => chartCard(chart, ctx)));
}

function chartCard(chart, ctx) {
    const card = el('article', {className: `card chart-${chart.type}`},
        el('div', {className: 'card-head'}, el('h2', {}, chart.title), el('small', {className: 'muted'}, hints[chart.type] ?? '')));
    const type = types[chart.type];
    if (chart.error || !type) {
        card.append(el('p', {className: 'error'}, chart.error || `Unknown chart type "${chart.type}".`));
        return card;
    }
    if (type.empty(chart)) {
        card.append(el('p', {className: 'muted'}, 'No transactions in this range.'));
    } else {
        type.render(card, chart, ctx);
    }
    card.append(...[type.notes?.(chart, ctx) ?? []].flat());
    return card;
}

function theme() {
    const style = getComputedStyle(document.documentElement);
    const read = (name) => style.getPropertyValue(name).trim();
    return {
        text: read('--text'), muted: read('--muted'), line: read('--line'), surface: read('--surface'),
        expense: read('--expense'), income: read('--income'), accent: read('--accent'),
        need: read('--need'), want: read('--want'), impulse: read('--impulse'),
        heatLow: read('--heat-low'), heatHigh: read('--heat-high'),
    };
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}

// The chart is created once its element has a size, which may be after it is added to the page.
function mount(parent, buildOption, data, height = DEFAULT_HEIGHT, onReady) {
    const canvas = el('div', {className: 'chart'});
    canvas.style.minHeight = `${height}px`;
    parent.append(canvas);

    let instance = null;
    const observer = new ResizeObserver(() => {
        if (canvas.clientWidth === 0) {
            return;
        }
        if (instance) {
            instance.resize();
            return;
        }
        instance = echarts.init(canvas);
        instance.setOption(buildOption(data, theme()));
        instances.push(instance);
        onReady?.(instance);
    });
    observer.observe(canvas);
    observers.push(observer);
}

// Amount.minor only sets bar and cell sizes; every number the user reads is the Go-formatted text.
function monthlyTotalsOption(chart, t) {
    const point = (amount, net) => ({value: amount.minor, text: amount.text, net: net.text});
    return {
        color: [t.expense, t.income],
        textStyle: {color: t.muted},
        legend: {top: 0, data: ['Expenses', 'Income'], textStyle: {color: t.text}},
        grid: {left: 8, right: 8, top: 40, bottom: 8, containLabel: true},
        tooltip: {
            trigger: 'axis',
            axisPointer: {type: 'shadow'},
            formatter: (params) => [
                `<strong>${escapeHtml(params[0].axisValue)}</strong>`,
                ...params.map((p) => `${p.marker} ${p.seriesName}: ${escapeHtml(p.data.text)}`),
                `Net: ${escapeHtml(params[0].data.net)}`,
            ].join('<br>'),
        },
        xAxis: {type: 'category', data: chart.months.map((m) => m.month)},
        yAxis: {type: 'value', axisLabel: {show: false}, splitLine: {lineStyle: {color: t.line}}},
        series: [
            {...BAR, name: 'Expenses', type: 'bar', data: chart.months.map((m) => point(m.expenses, m.net)), label: barLabel(chart.months.length, t)},
            {...BAR, name: 'Income', type: 'bar', data: chart.months.map((m) => point(m.income, m.net)), label: barLabel(chart.months.length, t)},
        ],
    };
}

function barLabel(count, t) {
    return {show: count <= 3, position: 'top', color: t.text, fontSize: 10, formatter: (p) => p.data.text};
}

function byCategoryOption(chart, t) {
    return {
        textStyle: {color: t.muted},
        grid: {left: 8, right: 130, top: 8, bottom: 8, containLabel: true},
        tooltip: {trigger: 'item', formatter: (p) => `${escapeHtml(p.name)}: ${escapeHtml(p.data.text)}`},
        xAxis: {type: 'value', show: false},
        yAxis: {type: 'category', inverse: true, data: chart.categories.map((c) => c.category), axisLabel: {color: t.text}},
        series: [{
            type: 'bar',
            barMaxWidth: 22,
            data: chart.categories.map((c) => ({value: c.spent.minor, text: c.spent.text, itemStyle: {color: c.color || t.expense, borderRadius: [0, 4, 4, 0]}})),
            label: {show: true, position: 'right', color: t.text, formatter: (p) => p.data.text},
        }],
    };
}

function calendarHeatmapOption(chart, t) {
    return {
        textStyle: {color: t.muted},
        tooltip: {formatter: (p) => `${escapeHtml(p.data.value[0])}<br>${escapeHtml(p.data.text)}`},
        visualMap: heatScale(chart.max, t),
        calendar: {
            range: [chart.from, chart.to],
            top: 36,
            left: 40,
            right: 16,
            cellSize: ['auto', 18],
            dayLabel: {firstDay: 1, color: t.muted},
            monthLabel: {color: t.muted},
            yearLabel: {show: false},
            itemStyle: {color: t.line, borderWidth: 2, borderColor: t.surface},
            splitLine: {show: false},
        },
        series: [{
            type: 'heatmap',
            coordinateSystem: 'calendar',
            data: chart.days.map((d) => ({value: [d.date, d.spent.minor], text: d.spent.text})),
        }],
    };
}

function heatScale(max, t) {
    return {
        min: 0,
        max: max.minor,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        text: [max.text, '0'],
        textStyle: {color: t.text},
        inRange: {color: [t.heatLow, t.heatHigh]},
    };
}

function runningBalanceOption(chart, t) {
    return {
        color: [t.accent],
        textStyle: {color: t.muted},
        grid: {left: 8, right: 110, top: 16, bottom: 8, containLabel: true},
        tooltip: {trigger: 'axis', formatter: (p) => `${escapeHtml(p[0].axisValue)}<br>${escapeHtml(p[0].data.text)}`},
        xAxis: {type: 'category', boundaryGap: false, data: chart.balance.map((p) => p.date)},
        yAxis: {type: 'value', axisLabel: {show: false}, splitLine: {lineStyle: {color: t.line}}},
        series: [{
            type: 'line',
            step: 'end',
            showSymbol: false,
            areaStyle: {opacity: 0.12},
            endLabel: {show: true, color: t.text, formatter: (p) => p.data.text},
            data: chart.balance.map((p) => ({value: p.balance.minor, text: p.balance.text})),
        }],
    };
}

function intentTrendsOption(chart, t) {
    const point = (amount) => ({value: amount.minor, text: amount.text});
    const series = (name, key) => ({name, type: 'bar', stack: 'intent', barMaxWidth: 32, itemStyle: {borderColor: t.surface, borderWidth: 2}, data: chart.intentMonths.map((m) => point(m[key]))});
    return {
        color: [t.need, t.want, t.impulse],
        textStyle: {color: t.muted},
        legend: {top: 0, data: ['Need', 'Want', 'Impulse'], textStyle: {color: t.text}},
        grid: {left: 8, right: 8, top: 40, bottom: 8, containLabel: true},
        tooltip: {
            trigger: 'axis',
            axisPointer: {type: 'shadow'},
            formatter: (params) => [
                `<strong>${escapeHtml(params[0].axisValue)}</strong>`,
                ...params.map((p) => `${p.marker} ${p.seriesName}: ${escapeHtml(p.data.text)}`),
            ].join('<br>'),
        },
        xAxis: {type: 'category', data: chart.intentMonths.map((m) => m.month)},
        yAxis: {type: 'value', axisLabel: {show: false}, splitLine: {lineStyle: {color: t.line}}},
        series: [series('Need', 'need'), series('Want', 'want'), series('Impulse', 'impulse')],
    };
}

function renderIntentTrends(body, chart) {
    mount(body, intentTrendsOption, chart);
}

function intentNote(chart) {
    return chart.noIntent > 0 ? el('p', {className: 'muted'}, `${chart.noIntent} expenses have no intent and are not shown.`) : [];
}

function smallBarOption(chart, t) {
    return {
        color: [t.accent],
        textStyle: {color: t.muted},
        grid: {left: 8, right: 8, top: 24, bottom: 8, containLabel: true},
        tooltip: {
            trigger: 'item',
            formatter: (p) => `Up to ${escapeHtml(p.name)}<br>${escapeHtml(p.data.share)} of expenses`,
        },
        xAxis: {type: 'category', data: chart.small.map((s) => s.threshold.text)},
        yAxis: {type: 'value', axisLabel: {show: false}, splitLine: {lineStyle: {color: t.line}}},
        series: [{
            ...BAR,
            type: 'bar',
            data: chart.small.map((s) => ({value: s.shareBp, share: s.share})),
            label: {show: true, position: 'top', color: t.text, formatter: (p) => p.data.share},
        }],
    };
}

function renderSmallPurchases(body, chart) {
    smallIndex = Math.min(smallIndex, chart.small.length - 1);
    const details = el('div', {className: 'tiles'});
    const picker = el('div', {className: 'pills wrap', role: 'group', 'aria-label': 'Threshold'});

    const show = () => {
        const stat = chart.small[smallIndex];
        picker.replaceChildren(...chart.small.map((s, i) => el('button', {
            className: i === smallIndex ? 'active' : '',
            'aria-pressed': String(i === smallIndex),
            onclick: () => { smallIndex = i; show(); },
        }, `≤ ${s.threshold.text}`)));
        details.replaceChildren(
            tile('Purchases', String(stat.count)),
            tile('Total', stat.total.text),
            tile('Share of all expenses', `${stat.share} of ${chart.expenseTotal.text}`),
        );
    };
    show();
    body.append(picker, details);
    mount(body, smallBarOption, chart, 220);
}

function tile(label, value) {
    return el('div', {className: 'tile'}, el('small', {className: 'muted'}, label), el('strong', {}, value));
}

function hourLabel(hour) {
    return `${String(hour).padStart(2, '0')}:00`;
}

function workdayOption(chart, selected, t) {
    return {
        textStyle: {color: t.muted},
        grid: {left: 8, right: 8, top: 24, bottom: 8, containLabel: true},
        tooltip: {trigger: 'item', formatter: (p) => `${hourLabel(p.data.hour)}<br>${escapeHtml(p.data.text)}`},
        xAxis: {type: 'category', data: chart.hours.map((h) => String(h.hour).padStart(2, '0'))},
        yAxis: {type: 'value', axisLabel: {show: false}, splitLine: {lineStyle: {color: t.line}}},
        series: [{
            ...BAR,
            type: 'bar',
            data: chart.hours.map((h) => ({
                value: h.total.minor, text: h.total.text, hour: h.hour,
                itemStyle: {color: h.hour === selected ? t.expense : t.accent, borderRadius: [4, 4, 0, 0]},
            })),
        }],
    };
}

function renderWorkdayRoutine(body, chart) {
    let selected = chart.hours.find((h) => h.occurrences > 0).hour;
    const details = el('div', {className: 'hour-details'});
    const showDetails = () => details.replaceChildren(...hourDetails(chart.hours[selected], chart.workdays));
    showDetails();

    body.append(el('p', {className: 'muted'}, `Spending per hour of the day on workdays (${chart.workdays} so far). Pick a bar for details.`));
    mount(body, (c, t) => workdayOption(c, selected, t), chart, DEFAULT_HEIGHT, (instance) => {
        instance.on('click', (params) => {
            selected = params.data.hour;
            instance.setOption(workdayOption(chart, selected, theme()));
            showDetails();
        });
    });
    body.append(details);
}

function hourDetails(hour, workdays) {
    if (hour.occurrences === 0) {
        return [el('p', {className: 'muted'}, `Nothing was spent at ${hourLabel(hour.hour)} on workdays.`)];
    }
    return [
        el('h3', {}, hourLabel(hour.hour)),
        el('div', {className: 'tiles'},
            tile('Occurrences', String(hour.occurrences)),
            tile(`Share of ${workdays} workdays`, hour.share),
            tile('Average', hour.average.text),
            tile('Total', hour.total.text),
        ),
        el('div', {className: 'two-columns'},
            el('div', {},
                el('h4', {}, 'Categories'),
                el('ul', {className: 'plain'}, hour.categories.map((c) => el('li', {},
                    el('span', {className: 'dot', style: `background:${c.color || 'var(--muted)'}`}), ` ${c.category}: ${c.spent.text}`))),
            ),
            el('div', {},
                el('h4', {}, 'Most common'),
                el('ul', {className: 'plain'}, hour.merchants.map((m) => el('li', {}, `${m.name}: ${m.count}×, average ${m.average.text}`))),
            ),
        ),
    ];
}

function weekdayHoursOption(chart, t) {
    return {
        textStyle: {color: t.muted},
        tooltip: {formatter: (p) => `${WEEKDAYS[p.data.value[1]]} ${hourLabel(p.data.value[0])}<br>${escapeHtml(p.data.text)}`},
        grid: {left: 8, right: 8, top: 8, bottom: 56, containLabel: true},
        visualMap: heatScale(chart.max, t),
        xAxis: {type: 'category', data: Array.from({length: 24}, (_, h) => String(h).padStart(2, '0'))},
        yAxis: {type: 'category', inverse: true, data: WEEKDAYS},
        series: [{
            type: 'heatmap',
            data: chart.cells.map((c) => ({value: [c.hour, c.weekday, c.spent.minor], text: c.spent.text})),
            itemStyle: {borderWidth: 2, borderColor: t.surface},
        }],
    };
}

function renderWeekdayHours(body, chart) {
    mount(body, weekdayHoursOption, chart, 340);
}

function noTimeNote(chart, ctx) {
    if (chart.noTime.length === 0) {
        return [];
    }
    return el('p', {className: 'muted'},
        `${chart.noTime.length} transactions have no time and are left out. `,
        el('button', {onclick: () => openNoTimeList(chart.noTime, ctx)}, 'Add times'),
    );
}

function openNoTimeList(refs, ctx) {
    openDialog(el('div', {className: 'form'},
        el('h2', {}, 'Transactions without a time'),
        el('ul', {className: 'plain no-time-list'}, refs.map((r) => el('li', {},
            el('span', {}, `${r.date}  ${r.merchant || ''}  ${r.amount.text}`),
            el('button', {onclick: () => { closeDialog(); editTransaction(ctx, r.id); }}, 'Edit'),
        ))),
        el('div', {className: 'form-actions'}, el('button', {onclick: closeDialog}, 'Close')),
    ));
}

function noSpendOption(month, t) {
    const code = {zero: 2, spent: 1};
    return {
        textStyle: {color: t.muted},
        tooltip: {
            formatter: (p) => `${escapeHtml(p.data.value[0])}<br>${escapeHtml(p.data.label)}`,
        },
        visualMap: {
            type: 'piecewise',
            orient: 'horizontal',
            left: 'center',
            bottom: 0,
            textStyle: {color: t.text},
            pieces: [
                {value: 2, color: t.income, label: 'No spending'},
                {value: 1, color: t.expense, label: 'Spent'},
                {value: 0, color: t.line, label: 'Not counted'},
            ],
        },
        calendar: {
            orient: 'vertical',
            range: month.month,
            top: 28,
            left: 16,
            right: 16,
            bottom: 56,
            cellSize: ['auto', 40],
            dayLabel: {firstDay: 1, color: t.muted},
            monthLabel: {show: false},
            yearLabel: {show: false},
            itemStyle: {color: t.line, borderWidth: 2, borderColor: t.surface},
            splitLine: {show: false},
        },
        series: [{
            type: 'heatmap',
            coordinateSystem: 'calendar',
            label: {show: true, color: t.text, formatter: (p) => p.data.value[0].slice(8)},
            data: month.days.map((d) => ({
                value: [d.date, code[d.status] ?? 0],
                label: {zero: 'No spending', spent: 'Spent', future: 'Upcoming', outside: 'Not counted'}[d.status],
            })),
        }],
    };
}

function renderNoSpend(body, chart) {
    const last = chart.noSpend.length - 1;
    noSpendIndex = Math.min(noSpendIndex ?? last, last);

    const heading = el('strong', {});
    const stats = el('div', {className: 'tiles'});
    const previous = el('button', {onclick: () => step(-1)}, '‹ Earlier');
    const next = el('button', {onclick: () => step(1)}, 'Later ›');
    let chartInstance = null;

    const show = () => {
        const month = chart.noSpend[noSpendIndex];
        heading.textContent = monthLabel(month.month);
        previous.disabled = noSpendIndex === 0;
        next.disabled = noSpendIndex === last;
        stats.replaceChildren(
            tile('Current streak', `${chart.currentStreak} days`),
            tile('Best streak this month', `${month.bestStreak} days`),
            tile('No-spend days this month', String(month.zeroDays)),
        );
        chartInstance?.setOption(noSpendOption(month, theme()), true);
    };
    const step = (delta) => { noSpendIndex += delta; show(); };

    body.append(el('div', {className: 'month-nav'}, previous, heading, next), stats);
    mount(body, (c, t) => noSpendOption(c.noSpend[noSpendIndex], t), chart, 380, (instance) => { chartInstance = instance; });
    show();
}
