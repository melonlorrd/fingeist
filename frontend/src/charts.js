import * as echarts from 'echarts/core';
import {BarChart, HeatmapChart} from 'echarts/charts';
import {CalendarComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';

import {el} from './dom.js';

echarts.use([BarChart, HeatmapChart, CalendarComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

const CATEGORY_ROW_HEIGHT = 36;
const DEFAULT_HEIGHT = 300;

const optionBuilders = {
    monthly_totals: monthlyTotalsOption,
    by_category: byCategoryOption,
    calendar_heatmap: calendarHeatmapOption,
};

let instances = [];

export function renderCharts(container, charts) {
    instances.forEach((instance) => instance.dispose());
    instances = [];
    container.replaceChildren(...charts.map((chart) => chartCard(chart)));
}

function chartCard(chart) {
    const card = el('article', {className: 'card'}, el('h2', {}, chart.title));
    if (chart.error) {
        card.append(el('p', {className: 'error'}, chart.error));
        return card;
    }
    if (isEmpty(chart)) {
        card.append(el('p', {className: 'muted'}, 'No transactions in this range.'));
        return card;
    }

    const canvas = el('div', {className: 'chart'});
    canvas.style.height = `${chartHeight(chart)}px`;
    card.append(canvas);
    // ECharts needs the element in the document to measure it.
    queueMicrotask(() => {
        const instance = echarts.init(canvas);
        instance.setOption(optionBuilders[chart.type](chart, theme()));
        new ResizeObserver(() => instance.resize()).observe(canvas);
        instances.push(instance);
    });
    return card;
}

function isEmpty(chart) {
    return chart.months.length + chart.categories.length + chart.days.length === 0;
}

function chartHeight(chart) {
    return chart.type === 'by_category' ? Math.max(180, chart.categories.length * CATEGORY_ROW_HEIGHT + 24) : DEFAULT_HEIGHT;
}

function theme() {
    const style = getComputedStyle(document.documentElement);
    const read = (name) => style.getPropertyValue(name).trim();
    return {
        text: read('--text'), muted: read('--muted'), line: read('--line'), surface: read('--surface'),
        expense: read('--expense'), income: read('--income'), accent: read('--accent'),
        heatLow: read('--heat-low'), heatHigh: read('--heat-high'),
    };
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}

// Amount.minor only sets bar and cell sizes; every number the user reads is the Go-formatted text.
function monthlyTotalsOption(chart, t) {
    const point = (amount, net) => ({value: amount.minor, text: amount.text, net: net.text});
    return {
        color: [t.expense, t.income],
        textStyle: {color: t.muted},
        legend: {data: ['Expenses', 'Income'], textStyle: {color: t.text}},
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
            {name: 'Expenses', type: 'bar', data: chart.months.map((m) => point(m.expenses, m.net)), label: barLabel(chart.months.length, t)},
            {name: 'Income', type: 'bar', data: chart.months.map((m) => point(m.income, m.net)), label: barLabel(chart.months.length, t)},
        ],
    };
}

function barLabel(count, t) {
    return {show: count <= 6, position: 'top', color: t.text, fontSize: 11, formatter: (p) => p.data.text};
}

function byCategoryOption(chart, t) {
    return {
        color: [t.expense],
        textStyle: {color: t.muted},
        grid: {left: 8, right: 110, top: 8, bottom: 8, containLabel: true},
        tooltip: {
            trigger: 'item',
            formatter: (p) => `${escapeHtml(p.name)}: ${escapeHtml(p.data.text)}`,
        },
        xAxis: {type: 'value', show: false},
        yAxis: {type: 'category', inverse: true, data: chart.categories.map((c) => c.category), axisLabel: {color: t.text}},
        series: [{
            type: 'bar',
            data: chart.categories.map((c) => ({value: c.spent.minor, text: c.spent.text})),
            label: {show: true, position: 'right', color: t.text, formatter: (p) => p.data.text},
        }],
    };
}

function calendarHeatmapOption(chart, t) {
    return {
        textStyle: {color: t.muted},
        tooltip: {formatter: (p) => `${escapeHtml(p.data.value[0])}<br>${escapeHtml(p.data.text)}`},
        visualMap: {
            min: 0,
            max: chart.max.minor,
            orient: 'horizontal',
            left: 'center',
            bottom: 0,
            text: [chart.max.text, '0'],
            textStyle: {color: t.text},
            inRange: {color: [t.heatLow, t.heatHigh]},
        },
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
