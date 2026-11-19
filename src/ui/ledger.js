// The ledger: entries grouped by day, with search, filters, totals and selecting many to recategorise.

import {UNCATEGORIZED} from '../core/report/index.js';
import {dayLabel, el, fill} from './dom.js';
import {editEntry, openBulkCategory} from './entry-form.js';

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
    return amount.negative ? 'expense' : 'income';
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
    const totals = el('p', {className: 'muted'});
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
    const filters = el('div', {className: 'pills scroll', role: 'group', 'aria-label': 'Show'});
    const showFilters = () =>
        filters.replaceChildren(
            ...FILTERS.map(([value, label]) =>
                el(
                    'button',
                    {
                        className: query.filter === value ? 'active' : '',
                        'aria-pressed': String(query.filter === value),
                        onclick: () => {
                            query.filter = value;
                            showFilters();
                            refilter();
                        },
                    },
                    label,
                ),
            ),
        );
    showFilters();

    const range =
        query.from || query.to
            ? el(
                  'div',
                  {className: 'head-actions'},
                  el(
                      'span',
                      {className: 'pill-note'},
                      query.from === query.to ? dayLabel(query.from) : `${query.from || '…'} to ${query.to || '…'}`,
                  ),
                  el(
                      'button',
                      {
                          className: 'quiet',
                          onclick: () => {
                              query.from = '';
                              query.to = '';
                              ctx.rerender();
                          },
                      },
                      'Show all dates',
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
        el('div', {className: 'filter-bar'}, search, el('div', {className: 'selects'}, month, category, account)),
        filters,
        el('div', {className: 'filter-bar summary-line'}, range, totals, bulkBar),
        list,
    );

    function refilter() {
        visibleDays = DAYS_PER_PAGE;
        load();
    }

    function load() {
        const data = ctx.app.ledger({...query, limit: visibleDays});
        fill(
            month,
            option('', 'All months', query.month),
            data.months.map((m) => option(m, m, query.month)),
        );
        totals.textContent = `${data.count} entries · spent ${data.spent.text} · income ${data.income.text}`;
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
        const parts = isTransfer
            ? [row.account, row.time, row.note]
            : [row.category, row.account, row.time, ...row.people, row.tags.join(', ')];
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
            el('span', {className: `amount ${tone(row.amount, row.signed)}`}, row.amount.text),
        );
        return el('li', {}, button);
    }

    load();
}
