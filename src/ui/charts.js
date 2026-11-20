import {BarChart, LineChart} from 'echarts/charts';
import {GridComponent, LegendComponent, TooltipComponent} from 'echarts/components';
import * as echarts from 'echarts/core';
import {LegacyGridContainLabel} from 'echarts/features';
import {CanvasRenderer} from 'echarts/renderers';

import {el, monthLabel} from './dom.js';
import {openEntryList} from './entry-form.js';
import {icon} from './icons.js';

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, LegacyGridContainLabel, CanvasRenderer]);

const DEFAULT_HEIGHT = 280;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const INTENT_NAMES = {need: 'Need', want: 'Want', impulse: 'Impulse'};

let instances = [];
let observers = [];

let smallIndex = 0;
let calendarIndex = null;

const hints = {
    monthly_totals: 'Income and expenses by month',
    by_category: 'Pick a category to see its entries',
    top_merchants: 'Where you spend most',
    running_balance: 'Balance at the end of each day',
    spending_calendar: 'Expenses per day; pick a day to see its entries',
    hour_routine: 'Spending by hour of the day',
    intent_trends: 'Need, want and impulse',
    small_purchases: 'Small expenses that quietly add up',
};

// Every chart type: how to tell it has nothing to show, when it isn't worth a card, and how to draw it.
const types = {
    monthly_totals: {
        empty: (c) => c.months.length === 0,
        // One month is already in the summary cards above.
        hidden: (c) => c.months.length < 2,
        render: (body, c) => mount(body, monthlyTotalsOption, c),
    },
    by_category: {empty: (c) => c.categories.length === 0, render: renderByCategory},
    top_merchants: {empty: (c) => c.merchants.length === 0, render: renderTopMerchants},
    running_balance: {empty: (c) => c.balance.length === 0, render: renderRunningBalance},
    spending_calendar: {empty: (c) => c.months.length === 0, render: renderCalendar},
    hour_routine: {empty: (c) => c.hours.every((h) => h.occurrences === 0), render: renderHourRoutine, notes: noTimeNote},
    intent_trends: {empty: (c) => c.intentMonths.length === 0, render: renderIntentTrends, notes: intentNote},
    small_purchases: {empty: (c) => c.expenseCount === 0, render: renderSmallPurchases},
};

export function disposeCharts() {
    for (const observer of observers) {
        observer.disconnect();
    }
    for (const instance of instances) {
        instance.dispose();
    }
    observers = [];
    instances = [];
}

/** Charts worth a card for this data; a chart with nothing to show still gets one, saying so. */
export function visibleCharts(charts) {
    return charts.filter((chart) => chart.error || !types[chart.type]?.hidden?.(chart));
}

export function isEmpty(chart) {
    return !chart.error && Boolean(types[chart.type]?.empty(chart));
}

export function renderCharts(container, charts, ctx) {
    container.replaceChildren(...charts.map((chart) => chartCard(chart, ctx)));
}

function chartCard(chart, ctx) {
    const card = el(
        'article',
        {className: `card chart-${chart.type}`},
        el('div', {className: 'card-head'}, el('h2', {}, chart.title), el('small', {className: 'muted'}, hints[chart.type] ?? '')),
    );
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
        text: read('--text'),
        muted: read('--muted'),
        line: read('--line'),
        surface: read('--surface'),
        expense: read('--expense'),
        income: read('--income'),
        accent: read('--accent'),
        need: read('--need'),
        want: read('--want'),
        impulse: read('--impulse'),
        heatLow: read('--heat-low'),
        mark: Number.parseInt(read('--r-mark'), 10) || 0,
        font: getComputedStyle(document.body).fontFamily,
    };
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
}

// ECharts animates on its own canvas, so the CSS reduced-motion rule doesn't reach it.
function motion() {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    return reduced ? {animation: false} : {animationDuration: 400, animationDurationUpdate: 250};
}

// The look every chart shares: the page's font, muted axes, and a tooltip shaped like the app's popovers.
function base(t) {
    return {
        textStyle: {color: t.muted, fontFamily: t.font},
        tooltip: {
            backgroundColor: t.surface,
            borderColor: t.line,
            borderWidth: 1,
            padding: [8, 12],
            textStyle: {color: t.text, fontSize: 12, fontFamily: t.font},
            extraCssText: 'border-radius: var(--r-inner); box-shadow: var(--shadow-float);',
        },
    };
}

function legend(t, data) {
    return {top: 0, left: 0, data, icon: 'circle', itemWidth: 8, itemHeight: 8, itemGap: 16, textStyle: {color: t.text}};
}

function categoryAxis(t, data, extra = {}) {
    return {
        type: 'category',
        data,
        axisLine: {lineStyle: {color: t.line}},
        axisTick: {show: false},
        axisLabel: {color: t.muted},
        ...extra,
    };
}

function valueAxis(t) {
    return {type: 'value', axisLabel: {show: false}, splitLine: {lineStyle: {color: t.line, type: 'dashed'}}};
}

function bar(t) {
    return {type: 'bar', barMaxWidth: 28, itemStyle: {borderRadius: [t.mark, t.mark, 0, 0]}};
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
        instance.setOption({...buildOption(data, theme()), ...motion()});
        instances.push(instance);
        onReady?.(instance);
    });
    observer.observe(canvas);
    observers.push(observer);
    return canvas;
}

// Amount.size only sets bar and cell sizes; every number the user reads is the text core formatted.
function monthlyTotalsOption(chart, t) {
    const point = (amount, net) => ({value: amount.size, text: amount.text, net: net.text});
    const b = base(t);
    return {
        ...b,
        color: [t.expense, t.income],
        legend: legend(t, ['Expenses', 'Income']),
        grid: {left: 0, right: 0, top: 36, bottom: 0, containLabel: true},
        tooltip: {
            ...b.tooltip,
            trigger: 'axis',
            axisPointer: {type: 'shadow', shadowStyle: {color: `${t.line}66`}},
            formatter: (params) =>
                [
                    `<strong>${escapeHtml(params[0].axisValue)}</strong>`,
                    ...params.map((p) => `${p.marker} ${p.seriesName}: ${escapeHtml(p.data.text)}`),
                    `Net: ${escapeHtml(params[0].data.net)}`,
                ].join('<br>'),
        },
        xAxis: categoryAxis(
            t,
            chart.months.map((m) => m.month),
        ),
        yAxis: valueAxis(t),
        series: [
            {...bar(t), name: 'Expenses', data: chart.months.map((m) => point(m.expenses, m.net))},
            {...bar(t), name: 'Income', data: chart.months.map((m) => point(m.income, m.net))},
        ],
    };
}

function renderRunningBalance(body, chart) {
    body.append(el('strong', {className: 'lead-figure'}, chart.balance.at(-1).balance.text));
    mount(body, runningBalanceOption, chart, 240);
}

function runningBalanceOption(chart, t) {
    const b = base(t);
    return {
        ...b,
        color: [t.accent],
        grid: {left: 0, right: 0, top: 12, bottom: 0, containLabel: true},
        tooltip: {
            ...b.tooltip,
            trigger: 'axis',
            formatter: (p) => `${escapeHtml(p[0].axisValue)}<br><strong>${escapeHtml(p[0].data.text)}</strong>`,
        },
        xAxis: categoryAxis(
            t,
            chart.balance.map((p) => p.date),
            {boundaryGap: false},
        ),
        yAxis: valueAxis(t),
        series: [
            {
                type: 'line',
                step: 'end',
                showSymbol: false,
                lineStyle: {width: 2},
                areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        {offset: 0, color: t.accent},
                        {offset: 1, color: t.surface},
                    ]),
                    opacity: 0.22,
                },
                data: chart.balance.map((p) => ({value: p.balance.size, text: p.balance.text})),
            },
        ],
    };
}

function changeTone(change) {
    if (change.startsWith('+') || change === 'New') {
        return 'worse';
    }
    return change.startsWith('-') ? 'better' : '';
}

function renderByCategory(body, chart, ctx) {
    if (chart.previousFrom) {
        body.append(el('p', {className: 'muted'}, `Changes compare with ${chart.previousFrom} to ${chart.previousTo}.`));
    }
    body.append(
        el(
            'ul',
            {className: 'plain stat-list'},
            chart.categories.map((c) =>
                el(
                    'li',
                    {},
                    el(
                        'button',
                        {className: 'stat-row', onclick: () => ctx.openLedger({category: c.category || 'uncategorized'})},
                        el(
                            'span',
                            {className: 'name'},
                            el('span', {className: 'dot', style: `background:${c.color || 'var(--muted)'}`}),
                            c.name,
                        ),
                        el('strong', {className: 'amount'}, c.spent.text),
                        el('small', {className: `change ${changeTone(c.change)}`}, c.change),
                        el('span', {className: 'bar'}, el('span', {style: `width:${c.barSize / 100}%;--c:${c.color || 'var(--muted)'}`})),
                    ),
                ),
            ),
        ),
    );
}

function renderTopMerchants(body, chart, ctx) {
    body.append(
        el(
            'ul',
            {className: 'plain stat-list'},
            chart.merchants.map((m) =>
                el(
                    'li',
                    {},
                    el(
                        'button',
                        {className: 'stat-row', onclick: () => ctx.openLedger({search: m.name})},
                        el('span', {className: 'name'}, m.name),
                        el('strong', {className: 'amount'}, m.spent.text),
                        el('small', {className: 'change'}, `${m.count}×`),
                    ),
                ),
            ),
        ),
    );
}

function renderCalendar(body, chart, ctx) {
    const last = chart.months.length - 1;
    calendarIndex = Math.min(calendarIndex ?? last, last);

    const heading = el('strong', {});
    const stats = el('div', {className: 'tiles'});
    const grid = el('div', {className: 'cal'});
    const previous = el('button', {className: 'quiet', onclick: () => step(-1)}, icon('previous'), 'Earlier');
    const next = el('button', {className: 'quiet', onclick: () => step(1)}, 'Later', icon('next'));

    const show = () => {
        const month = chart.months[calendarIndex];
        heading.textContent = monthLabel(month.month);
        previous.disabled = calendarIndex === 0;
        next.disabled = calendarIndex === last;
        stats.replaceChildren(
            tile('Current streak', `${chart.currentStreak} days`),
            tile('Best this month', `${month.bestStreak} days`),
            tile('No-spend days', String(month.zeroDays)),
        );
        grid.replaceChildren(
            ...WEEKDAYS.map((d) => el('small', {}, d)),
            ...calendarCells(month, (date) => ctx.openLedger({from: date, to: date})),
        );
    };
    const step = (delta) => {
        calendarIndex += delta;
        show();
    };

    body.append(el('div', {className: 'month-nav'}, previous, heading, next), stats, grid, calendarLegend());
    show();
}

const DAY_STATUS = {zero: 'No spending', future: 'Upcoming', outside: 'Not counted'};

function calendarCells(month, open) {
    const blanks = Array.from({length: month.lead}, () => el('span'));
    const cells = month.days.map((d) => {
        const day = String(Number(d.date.slice(8)));
        if (d.status === 'spent') {
            return el(
                'button',
                {
                    className: `cal-day l${d.level}`,
                    title: `${d.date}: ${d.spent.text}`,
                    'aria-label': `${d.date}, ${d.spent.text}`,
                    onclick: () => open(d.date),
                },
                day,
            );
        }
        const label = `${d.date}: ${DAY_STATUS[d.status] ?? ''}`;
        return el('span', {className: `cal-day ${d.status}`, title: label, 'aria-label': label}, day);
    });
    return [...blanks, ...cells];
}

function calendarLegend() {
    return el(
        'div',
        {className: 'cal-legend', 'aria-hidden': 'true'},
        'Less',
        [1, 2, 3, 4].map((level) => el('span', {className: `cal-day l${level}`})),
        'More',
        el('span', {className: 'cal-day zero'}),
        'No spending',
    );
}

function renderIntentTrends(body, chart) {
    body.append(
        el(
            'div',
            {className: 'mix-bar', 'aria-hidden': 'true'},
            chart.mix
                .filter((m) => m.shareSize > 0)
                .map((m) => el('span', {className: m.intent, style: `flex:${m.shareSize};background:var(--c)`})),
        ),
        el(
            'ul',
            {className: 'plain mix-list'},
            chart.mix.map((m) =>
                el(
                    'li',
                    {},
                    el('span', {className: m.intent}, el('span', {className: 'dot', style: 'background:var(--c)'}), INTENT_NAMES[m.intent]),
                    el('strong', {className: 'amount'}, m.total.text),
                    el('span', {className: 'share'}, m.share),
                ),
            ),
        ),
    );
    if (chart.intentMonths.length > 1) {
        mount(body, intentTrendsOption, chart, 220);
    }
}

function intentTrendsOption(chart, t) {
    const point = (amount) => ({value: amount.size, text: amount.text});
    const series = (name, key) => ({
        name,
        type: 'bar',
        stack: 'intent',
        barMaxWidth: 28,
        itemStyle: {borderColor: t.surface, borderWidth: 2, borderRadius: t.mark},
        data: chart.intentMonths.map((m) => point(m[key])),
    });
    const b = base(t);
    return {
        ...b,
        color: [t.need, t.want, t.impulse],
        grid: {left: 0, right: 0, top: 12, bottom: 0, containLabel: true},
        tooltip: {
            ...b.tooltip,
            trigger: 'axis',
            axisPointer: {type: 'shadow', shadowStyle: {color: `${t.line}66`}},
            formatter: (params) =>
                [
                    `<strong>${escapeHtml(params[0].axisValue)}</strong>`,
                    ...params.map((p) => `${p.marker} ${p.seriesName}: ${escapeHtml(p.data.text)}`),
                ].join('<br>'),
        },
        xAxis: categoryAxis(
            t,
            chart.intentMonths.map((m) => m.month),
        ),
        yAxis: valueAxis(t),
        series: [series('Need', 'need'), series('Want', 'want'), series('Impulse', 'impulse')],
    };
}

function intentNote(chart) {
    return chart.noIntent > 0 ? el('p', {className: 'muted'}, `${chart.noIntent} expenses have no intent and are not shown.`) : [];
}

function renderSmallPurchases(body, chart) {
    smallIndex = Math.min(smallIndex, chart.small.length - 1);
    const details = el('div', {className: 'tiles'});
    const meter = el('div', {className: 'meter', 'aria-hidden': 'true'});
    const caption = el('small', {className: 'muted'});
    const picker = el('div', {className: 'pills scroll', role: 'group', 'aria-label': 'Threshold'});

    const show = () => {
        const stat = chart.small[smallIndex];
        picker.replaceChildren(
            ...chart.small.map((s, i) =>
                el(
                    'button',
                    {
                        className: i === smallIndex ? 'active' : '',
                        'aria-pressed': String(i === smallIndex),
                        onclick: () => {
                            smallIndex = i;
                            show();
                        },
                    },
                    `≤ ${s.threshold.text}`,
                ),
            ),
        );
        details.replaceChildren(tile('Purchases', String(stat.count)), tile('Total', stat.total.text), tile('Share', stat.share));
        meter.replaceChildren(el('span', {style: `width:${stat.shareSize / 100}%;background:var(--accent)`}));
        caption.textContent = `${stat.share} of ${chart.expenseTotal.text} in expenses, before refunds`;
    };
    show();
    body.append(picker, details, meter, caption);
}

function tile(label, value) {
    return el('div', {className: 'tile'}, el('small', {className: 'muted'}, label), el('strong', {}, value));
}

function hourLabel(hour) {
    return `${String(hour).padStart(2, '0')}:00`;
}

function hourOption(chart, selected, t) {
    const b = base(t);
    return {
        ...b,
        grid: {left: 0, right: 0, top: 12, bottom: 0, containLabel: true},
        tooltip: {...b.tooltip, trigger: 'item', formatter: (p) => `${hourLabel(p.data.hour)}<br>${escapeHtml(p.data.text)}`},
        xAxis: categoryAxis(
            t,
            chart.hours.map((h) => String(h.hour).padStart(2, '0')),
        ),
        yAxis: valueAxis(t),
        series: [
            {
                ...bar(t),
                barCategoryGap: '20%',
                data: chart.hours.map((h) => ({
                    value: h.total.size,
                    text: h.total.text,
                    hour: h.hour,
                    itemStyle: {color: h.hour === selected ? t.accent : t.heatLow, borderRadius: [t.mark, t.mark, 0, 0]},
                })),
            },
        ],
    };
}

function renderHourRoutine(body, chart) {
    let selected = chart.hours.find((h) => h.occurrences > 0).hour;
    const details = el('div', {className: 'hour-details'});
    const showDetails = () => details.replaceChildren(...hourDetails(chart.hours[selected], chart.days));
    showDetails();

    mount(
        body,
        (c, t) => hourOption(c, selected, t),
        chart,
        220,
        (instance) => {
            instance.on('click', (params) => {
                selected = params.data.hour;
                instance.setOption(hourOption(chart, selected, theme()));
                showDetails();
            });
        },
    );
    body.append(details);
}

function hourDetails(hour, days) {
    if (hour.occurrences === 0) {
        return [el('p', {className: 'muted'}, `Nothing was spent at ${hourLabel(hour.hour)}.`)];
    }
    return [
        el('h4', {}, `At ${hourLabel(hour.hour)}`),
        el(
            'div',
            {className: 'tiles'},
            tile('Occurrences', String(hour.occurrences)),
            tile(`Share of ${days} ${days === 1 ? 'day' : 'days'}`, hour.share),
            tile('Average', hour.average.text),
            tile('Total', hour.total.text),
        ),
        el(
            'div',
            {className: 'two-columns'},
            el(
                'div',
                {},
                el('h4', {}, 'Categories'),
                el(
                    'ul',
                    {className: 'plain'},
                    hour.categories.map((c) =>
                        el(
                            'li',
                            {},
                            el('span', {className: 'dot', style: `background:${c.color || 'var(--muted)'}`}),
                            ` ${c.name}: ${c.spent.text}`,
                        ),
                    ),
                ),
            ),
            el(
                'div',
                {},
                el('h4', {}, 'Most common'),
                el(
                    'ul',
                    {className: 'plain'},
                    hour.merchants.map((m) => el('li', {}, `${m.name}: ${m.count}×, average ${m.average.text}`)),
                ),
            ),
        ),
    ];
}

function noTimeNote(chart, ctx) {
    if (chart.noTime.length === 0) {
        return [];
    }
    return el(
        'p',
        {className: 'muted'},
        `${chart.noTime.length} transactions have no time and are left out. `,
        el('button', {className: 'quiet', onclick: () => openEntryList(ctx, 'Transactions without a time', chart.noTime)}, 'Add times'),
    );
}
