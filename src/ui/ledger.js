// The ledger: entries grouped by day, with search, filters, totals and selecting many to recategorise.

import {UNCATEGORIZED} from '../core/report/index.js';
import {dateText, dayLabel, el, fill, monthLabel} from './dom.js';
import {editEntry, openBulkCategory} from './entry-form.js';
import {icon} from './icons.js';

const DAYS_PER_PAGE = 40;
const FILTERS = [
    ['all', 'All'],
    ['expense', 'Expenses'],
    ['income', 'Income'],
    ['refund', 'Refunds'],
    ['transfer', 'Transfers'],
    ['need', 'Needs'],
    ['want', 'Wants'],
    ['impulse', 'Impulses'],
];
const EMPTY_QUERY = {search: '', month: '', category: '', account: '', filter: 'all', from: '', to: ''};

const query = {...EMPTY_QUERY};
let visibleDays = DAYS_PER_PAGE;
let filtersOpen = false;
let selecting = false;
const selected = new Set();

/** Opens the ledger narrowed to a drill-down, e.g. {category} or {from, to}. */
export function setQuery(next) {
    Object.assign(query, EMPTY_QUERY, next);
    visibleDays = DAYS_PER_PAGE;
}

function tone(amount, signed = true) {
    if (!signed) {
        return '';
    }
    return amount.negative ? 'expense' : amount.positive ? 'income' : '';
}

function rangeText() {
    if (query.from === query.to) {
        return dayLabel(query.from);
    }
    return `${query.from ? dateText(query.from) : 'Any date'} to ${query.to ? dateText(query.to) : 'now'}`;
}

function option(value, label, current) {
    return el('option', {value, selected: value === current}, label);
}

function filterSelect(label, key, options, onChange) {
    const select = el(
        'select',
        {
            'aria-label': label,
            onchange: () => {
                query[key] = select.value;
                onChange();
            },
        },
        options,
    );
    return select;
}

export async function render(container, ctx) {
    const list = el('div', {className: 'ledger-list'});
    const totals = el('dl', {className: 'stats'});
    const month = filterSelect('Month', 'month', [], refilter);
    const category = filterSelect(
        'Category',
        'category',
        [
            option('', 'All categories', query.category),
            option(UNCATEGORIZED, 'Uncategorized', query.category),
            ctx.boot.categories.map((c) => option(c.id, c.name, query.category)),
        ],
        refilter,
    );
    const account = filterSelect(
        'Account',
        'account',
        [option('', 'All accounts', query.account), ctx.boot.accounts.map((a) => option(a.id, a.name, query.account))],
        refilter,
    );

    let timer;
    const search = el('input', {
        type: 'search',
        placeholder: 'Search merchant, note, category, account, tags',
        value: query.search,
        'aria-label': 'Search',
        oninput: () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                query.search = search.value;
                refilter();
            }, 200);
        },
    });
    const filters = el(
        'div',
        {className: 'pills scroll', role: 'group', 'aria-label': 'Show'},
        FILTERS.map(([value, label]) =>
            el(
                'button',
                {
                    className: query.filter === value ? 'active' : '',
                    'aria-pressed': String(query.filter === value),
                    onclick: () => {
                        query.filter = value;
                        refilter();
                    },
                },
                label,
            ),
        ),
    );

    const categoryName = (id) =>
        id === UNCATEGORIZED ? 'Uncategorized' : (ctx.boot.categories.find((c) => c.id === id)?.name ?? 'Deleted category');
    const accountName = (id) => ctx.boot.accounts.find((a) => a.id === id)?.name ?? 'Deleted account';
    const active = [
        query.month ? {label: monthLabel(query.month), clear: {month: ''}} : null,
        query.category ? {label: categoryName(query.category), clear: {category: ''}} : null,
        query.account ? {label: accountName(query.account), clear: {account: ''}} : null,
        query.from || query.to ? {label: rangeText(), clear: {from: '', to: ''}} : null,
    ].filter((chip) => chip !== null);
    const anyFilter = active.length > 0 || query.filter !== 'all' || query.search !== '';
    const panel = el('div', {className: 'selects', hidden: !filtersOpen}, month, category, account);
    const filtersButton = el(
        'button',
        {
            className: filtersOpen ? 'active' : '',
            'aria-expanded': String(filtersOpen),
            onclick: () => {
                filtersOpen = !filtersOpen;
                panel.hidden = !filtersOpen;
                filtersButton.classList.toggle('active', filtersOpen);
                filtersButton.setAttribute('aria-expanded', String(filtersOpen));
            },
        },
        icon('filter'),
        el('span', {}, 'Filters'),
        active.length > 0 ? el('span', {className: 'count'}, String(active.length)) : null,
    );
    const chips = anyFilter
        ? el(
              'div',
              {className: 'active-filters'},
              active.map((chip) =>
                  el(
                      'button',
                      {
                          className: 'filter-chip',
                          'aria-label': `Remove filter: ${chip.label}`,
                          onclick: () => {
                              Object.assign(query, chip.clear);
                              visibleDays = DAYS_PER_PAGE;
                              ctx.rerender();
                          },
                      },
                      el('span', {}, chip.label),
                      icon('close'),
                  ),
              ),
              el(
                  'button',
                  {
                      className: 'quiet',
                      onclick: () => {
                          setQuery({});
                          ctx.rerender();
                      },
                  },
                  'Clear all',
              ),
          )
        : null;

    const bulkBar = el('div', {className: 'head-actions'});
    const showBulk = () =>
        fill(
            bulkBar,
            el(
                'button',
                {
                    className: selecting ? 'active' : '',
                    onclick: () => {
                        selecting = !selecting;
                        selected.clear();
                        showBulk();
                        load();
                    },
                },
                selecting ? 'Done' : 'Select',
            ),
            selecting ? el('span', {className: 'muted'}, `${selected.size} selected`) : null,
            selecting && selected.size > 0
                ? el(
                      'button',
                      {
                          className: 'primary',
                          onclick: () =>
                              openBulkCategory(ctx, [...selected], () => {
                                  selected.clear();
                                  selecting = false;
                              }),
                      },
                      'Set category',
                  )
                : null,
        );
    showBulk();

    fill(
        container,
        el('div', {className: 'filter-bar'}, search, filtersButton),
        panel,
        filters,
        chips,
        el('div', {className: 'filter-bar summary-line'}, totals, bulkBar),
        list,
    );

    // Redraws the whole screen, so the filter chips and Clear all follow every change.
    function refilter() {
        visibleDays = DAYS_PER_PAGE;
        ctx.rerender();
    }

    function load() {
        const data = ctx.app.ledger({...query, limit: visibleDays});
        fill(
            month,
            option('', 'All months', query.month),
            data.months.map((m) => option(m, monthLabel(m), query.month)),
        );
        const stat = (label, value, className = '') => el('div', {}, el('dt', {}, label), el('dd', {className}, value));
        fill(
            totals,
            stat('Entries', String(data.count)),
            stat('Spent', data.spent.text),
            stat('Income', data.income.text, 'income'),
            stat('Net', data.net.text, tone(data.net)),
        );
        const remaining = data.totalDays - data.days.length;
        const more = el(
            'button',
            {
                className: 'more',
                onclick: () => {
                    visibleDays += DAYS_PER_PAGE;
                    load();
                },
            },
            `Show ${Math.min(DAYS_PER_PAGE, remaining)} more days (${remaining} left)`,
        );
        fill(
            list,
            data.days.length === 0 ? el('p', {className: 'muted'}, 'Nothing matches.') : data.days.map(dayGroup),
            remaining > 0 ? more : null,
        );
    }

    function dayGroup(day) {
        return el(
            'section',
            {className: 'day'},
            el('header', {}, el('h3', {}, dayLabel(day.date)), el('span', {className: `amount ${tone(day.total)}`}, day.total.text)),
            el('ul', {className: 'card rows'}, day.rows.map(entryRow)),
        );
    }

    // The whole row is one button: it opens the entry, or toggles it while selecting.
    function entryRow(row) {
        const isTransfer = row.kind === 'transfer';
        const title = isTransfer ? 'Transfer' : row.merchant || row.note || '(no description)';
        const parts = isTransfer ? [row.account, row.note] : [row.category, row.account, ...row.people, row.tags.join(', ')];
        const detail = [...parts, !isTransfer && row.merchant ? row.note : ''].filter(Boolean).join(' · ');
        const selectable = selecting && !isTransfer;
        const isSelected = selected.has(row.id);
        const lead = selectable
            ? el('span', {className: `check ${isSelected ? 'on' : ''}`, 'aria-hidden': 'true'})
            : el(
                  'span',
                  {className: 'dots', 'aria-hidden': 'true'},
                  (row.categoryColors.length ? row.categoryColors : ['']).map((color) =>
                      el('span', {className: 'dot', style: `background:${color || 'var(--muted)'}`}),
                  ),
              );
        const button = el(
            'button',
            {
                className: `row ${isSelected ? 'selected' : ''}`,
                ...(selectable ? {'aria-pressed': String(isSelected)} : {}),
                onclick: () => {
                    if (!selectable) {
                        editEntry(ctx, row.id);
                        return;
                    }
                    if (isSelected) {
                        selected.delete(row.id);
                    } else {
                        selected.add(row.id);
                    }
                    showBulk();
                    load();
                },
            },
            lead,
            el('span', {className: 'what'}, el('strong', {}, title), el('small', {className: 'muted'}, detail)),
            el(
                'span',
                {className: 'badges'},
                row.intents.map((intent) => el('span', {className: `badge ${intent}`}, intent)),
                row.refund ? el('span', {className: 'badge'}, 'refund') : null,
                row.recurring ? el('span', {className: 'badge'}, 'repeats') : null,
            ),
            el(
                'span',
                {className: 'figure'},
                el('span', {className: `amount ${tone(row.amount, row.signed)}`}, row.amount.text),
                row.time ? el('small', {className: 'muted'}, row.time) : null,
            ),
        );
        return el('li', {}, button);
    }

    load();
}
