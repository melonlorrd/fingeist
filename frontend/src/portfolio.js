import {AddHolding, DeleteHolding, GetHolding, Portfolio, UpdateHolding, UpdatePrices} from '../bindings/el-costas/app.js';

import {confirmDialog, el, field, fill, formDialog, pageHeader, select} from './dom.js';

const CLASSES = [['mutual_fund', 'Mutual funds'], ['equity', 'Equity'], ['gold', 'Gold']];
const CLASS_LABELS = {mutual_fund: 'Mutual fund', equity: 'Equity', gold: 'Physical gold'};

let classFilter = '';
let priceResult = null;

export async function render(container, ctx) {
    const view = await Portfolio();
    const priceStatus = el('div', {});
    if (priceResult) {
        showPriceResult(priceStatus, priceResult);
    }

    const update = el('button', {
        onclick: async () => {
            update.disabled = true;
            update.textContent = 'Updating…';
            const error = await ctx.perform(async () => { priceResult = await UpdatePrices(); });
            if (error) {
                ctx.notify(error, true);
                update.disabled = false;
                update.textContent = 'Update prices';
                return;
            }
            const failed = priceResult.failures.length;
            ctx.notify(`Updated ${priceResult.updated} prices${failed ? `; ${failed} could not be fetched` : ''}.`, failed > 0 && priceResult.updated === 0);
        },
    }, 'Update prices');

    container.replaceChildren(
        pageHeader('Portfolio', 'Mutual funds, equity and gold, with net worth', update,
            el('button', {className: 'primary', onclick: () => openHoldingForm(ctx, null)}, '+ Add holding')),
        priceStatus,
        el('section', {className: 'summary'},
            card('Net worth', view.netWorth, 'Portfolio plus the ledger balance'),
            card('Portfolio value', view.portfolioValue, `Across ${view.holdings.length} holdings`),
            card('Total invested', view.totalInvested, 'Cost basis'),
            card('Total returns', view.totalReturns, view.totalReturnsPct, view.returnsTrend),
        ),
        allocationCard(view.allocation),
        classButtons(view.holdings, ctx),
        holdingsList(view.holdings, ctx),
    );
}

function card(label, value, detail, trend) {
    return el('article', {className: 'card summary-card'},
        el('small', {className: 'label'}, label),
        el('strong', {className: `big ${trend ?? ''}`}, value),
        detail ? el('small', {className: `change ${trend ?? ''}`}, detail) : null,
    );
}

function allocationCard(allocation) {
    if (allocation.length === 0) {
        return el('p', {className: 'muted'}, 'Add holdings to see how your money is spread.');
    }
    return el('article', {className: 'card'},
        el('h2', {}, 'Allocation'),
        el('div', {className: 'stack', role: 'img', 'aria-label': allocation.map((a) => `${a.label} ${a.actualPct}`).join(', ')},
            allocation.map((a) => el('div', {className: `seg ${a.class}`, style: `width:${a.actualBp / 100}%`}))),
        el('div', {className: 'allocation-grid'}, allocation.map((a) => el('div', {className: 'tile'},
            el('strong', {}, a.label),
            el('span', {}, `${a.value} `, el('span', {className: 'muted'}, `(${a.actualPct})`)),
            el('small', {className: 'muted'}, a.hasTarget ? `Target ${a.targetPct}` : 'No target'),
            a.hasTarget ? el('small', {className: `pill-note ${a.driftTrend}`}, `Drift ${a.drift}`) : null,
        ))),
    );
}

function classButtons(holdings, ctx) {
    const count = (value) => holdings.filter((h) => !value || h.class === value).length;
    return el('div', {className: 'pills', role: 'group', 'aria-label': 'Asset class'},
        [['', 'All'], ...CLASSES].map(([value, label]) => el('button', {
            className: classFilter === value ? 'active' : '',
            'aria-pressed': String(classFilter === value),
            onclick: () => { classFilter = value; ctx.rerender(); },
        }, `${label} (${count(value)})`)));
}

function holdingsList(holdings, ctx) {
    const shown = holdings.filter((h) => !classFilter || h.class === classFilter);
    if (shown.length === 0) {
        return el('p', {className: 'muted'}, 'No holdings here yet.');
    }
    return el('ul', {className: 'card rows holdings'}, shown.map((h) => el('li', {className: 'row'},
        el('span', {className: `dot ${h.class}`}),
        el('span', {className: 'what'},
            el('strong', {}, h.name),
            el('small', {className: 'muted'}, [h.ticker, h.units, `Avg ${h.avgBuyPrice}`, `Now ${h.currentPrice}`].filter(Boolean).join(' · ')),
            el('small', {className: h.outOfDate ? 'stale' : 'muted'},
                `${h.outOfDate ? 'Out of date · ' : ''}${h.priceAsOf}${h.priceSource ? ` · ${h.priceSource}` : ''}`),
        ),
        el('span', {className: `badge ${h.class}`}, CLASS_LABELS[h.class]),
        el('span', {className: 'figures'},
            el('strong', {}, h.value),
            el('small', {className: h.gainTrend}, `${h.gain}${h.gainPct ? ` (${h.gainPct})` : ''}`)),
        el('span', {className: 'actions'},
            el('button', {className: 'quiet', onclick: async () => openHoldingForm(ctx, await GetHolding(h.id))}, 'Edit'),
            el('button', {className: 'quiet danger', onclick: () => deleteHolding(ctx, h)}, 'Delete')),
    )));
}

function showPriceResult(node, result) {
    fill(node,
        result.failures.length === 0 ? null : el('div', {className: 'notice error'},
            el('strong', {}, 'These prices could not be fetched and keep their last value:'),
            el('ul', {}, result.failures.map((f) => el('li', {}, `${f.name}: ${f.reason}`))),
            el('small', {}, 'Mutual funds need the AMFI scheme code in the ticker field; equity needs the Yahoo Finance symbol, for example RELIANCE.NS. Gold is priced by hand.')),
    );
}

async function deleteHolding(ctx, holding) {
    if (!await confirmDialog(`Delete the holding "${holding.name}"? This cannot be undone.`)) {
        return;
    }
    priceResult = null;
    const error = await ctx.perform(() => DeleteHolding(holding.id));
    if (error) {
        ctx.notify(error, true);
    }
}

function openHoldingForm(ctx, fields) {
    const isNew = fields === null;
    const values = fields ?? {id: '', class: 'mutual_fund', name: '', ticker: '', units: '', avgBuyPrice: '', currentPrice: '', priceAsOf: '', priceSource: '', notes: ''};

    const classSelect = select('class', CLASSES.map(([value]) => ({value, label: CLASS_LABELS[value]})), values.class);
    const tickerLabel = el('span', {});
    const unitsLabel = el('span', {});
    const ticker = el('input', {name: 'ticker', value: values.ticker, autocomplete: 'off'});
    const tickerField = el('label', {className: 'field'}, tickerLabel, ticker);
    const showClass = () => {
        const klass = classSelect.value;
        tickerField.hidden = klass === 'gold';
        tickerLabel.textContent = klass === 'mutual_fund' ? 'AMFI scheme code (for price updates)' : 'Symbol, e.g. RELIANCE.NS (for price updates)';
        unitsLabel.textContent = klass === 'gold' ? 'Grams' : 'Units';
    };
    classSelect.addEventListener('change', showClass);

    const input = (name, props = {}) => el('input', {name, value: values[name], autocomplete: 'off', inputMode: 'decimal', ...props});
    formDialog({
        title: isNew ? 'Add holding' : 'Edit holding',
        fields: [
            field('Type', classSelect),
            field('Name', el('input', {name: 'name', value: values.name, required: true, autocomplete: 'off'})),
            tickerField,
            el('label', {className: 'field'}, unitsLabel, input('units', {required: true, placeholder: '684.797'})),
            field(`Average buy price (${ctx.boot.currency})`, input('avgBuyPrice', {required: true, placeholder: '52.3417'})),
            field(`Current price (${ctx.boot.currency})`, input('currentPrice', {placeholder: 'Defaults to the buy price'}),
                'Setting it by hand marks it as manual.'),
            field('Notes', el('input', {name: 'notes', value: values.notes, autocomplete: 'off', placeholder: 'Folio number, where it is kept…'})),
        ],
        onSubmit: (data) => {
            priceResult = null;
            const result = {
                ...values,
                class: data.get('class'),
                name: data.get('name'),
                ticker: data.get('class') === 'gold' ? '' : data.get('ticker'),
                units: data.get('units').trim(),
                avgBuyPrice: data.get('avgBuyPrice').trim(),
                currentPrice: data.get('currentPrice').trim(),
                notes: data.get('notes'),
            };
            return ctx.perform(() => (isNew ? AddHolding(result) : UpdateHolding(result)));
        },
    });
    showClass();
}
