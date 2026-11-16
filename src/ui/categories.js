import {confirmDialog, el, field, fill, formDialog, pageHeader} from './dom.js';

export async function render(container, ctx) {
    const act = async (change) => {
        const error = await ctx.perform(change);
        if (error) {
            ctx.notify(error, true);
        }
    };
    const categories = ctx.boot.categories;
    const active = categories.filter((c) => !c.archived);
    const archived = categories.filter((c) => c.archived);
    const merged = ctx.boot.merged.categories;

    const row = (c) =>
        el(
            'li',
            {},
            el(
                'button',
                {className: 'row', onclick: () => openCategory(ctx, c)},
                el('span', {className: 'dot', style: `background:${c.color || 'var(--muted)'}`}),
                el(
                    'span',
                    {className: 'what'},
                    el('strong', {}, c.name),
                    c.budget ? el('small', {className: 'muted'}, `Budget ${c.budget} a month`) : null,
                ),
                el('span'),
                el('span'),
            ),
        );

    fill(
        container,
        pageHeader(
            'Categories and budgets',
            'Rename, recolour, merge or delete categories; entries follow along.',
            el('button', {className: 'primary', onclick: () => openCategory(ctx, null)}, '+ New category'),
        ),
        budgetsCard(ctx),
        el(
            'article',
            {className: 'card'},
            el('h2', {}, `Categories (${active.length})`),
            active.length === 0
                ? el(
                      'p',
                      {className: 'muted'},
                      'No categories yet. Entries without one show as Uncategorized; add categories here or while adding an entry.',
                  )
                : el('ul', {className: 'card rows'}, active.map(row)),
        ),
        archived.length === 0
            ? null
            : el(
                  'article',
                  {className: 'card'},
                  el('h2', {}, `Archived (${archived.length})`),
                  el('p', {className: 'muted'}, 'These leave the picker but stay on existing entries.'),
                  el('ul', {className: 'card rows'}, archived.map(row)),
              ),
        merged.length === 0
            ? null
            : el(
                  'article',
                  {className: 'card'},
                  el('h2', {}, 'Merged'),
                  el('p', {className: 'muted'}, 'Their entries show under the category they were merged into. Undo puts them back.'),
                  el(
                      'ul',
                      {className: 'card rows'},
                      merged.map((m) =>
                          el(
                              'li',
                              {},
                              el(
                                  'button',
                                  {
                                      className: 'row',
                                      onclick: async () => {
                                          if (
                                              await confirmDialog(
                                                  `Undo the merge of ${m.name} into ${m.into}? Its entries go back to ${m.name}.`,
                                                  'Undo merge',
                                              )
                                          ) {
                                              await act(() => ctx.app.unmergeCategory(m.id));
                                          }
                                      },
                                  },
                                  el('span'),
                                  el(
                                      'span',
                                      {className: 'what'},
                                      el('strong', {}, m.name),
                                      el('small', {className: 'muted'}, `Merged into ${m.into}`),
                                  ),
                                  el('span'),
                                  el('span'),
                              ),
                          ),
                      ),
                  ),
              ),
    );
}

function budgetsCard(ctx) {
    const b = ctx.boot.budgets;
    if (b.rows.length === 0) {
        return el(
            'article',
            {className: 'card'},
            el('h2', {}, 'Budgets'),
            el('p', {className: 'muted'}, 'Open a category to give it a monthly budget; it is then tracked here and on the dashboard.'),
        );
    }
    return el('article', {className: 'card'}, budgetSummary(b));
}

/** The budget rows for this month, shared with the dashboard. */
export function budgetSummary(b) {
    return [
        el(
            'div',
            {className: 'card-head'},
            el('h2', {}, 'Budgets this month'),
            el(
                'small',
                {className: 'muted'},
                `${b.from} to ${b.to} · ${b.daysLeft} days left · ${b.total.spent.text} of ${b.total.budget.text}`,
            ),
        ),
        el(
            'ul',
            {className: 'plain budget-list'},
            b.rows.map((r) =>
                el(
                    'li',
                    {className: r.over ? 'over' : ''},
                    el(
                        'div',
                        {className: 'budget-line'},
                        el('span', {}, el('span', {className: 'dot', style: `background:${r.color || 'var(--muted)'}`}), r.name),
                        el(
                            'small',
                            {className: 'muted'},
                            `${r.spent.text} of ${r.budget.text} · ${r.over ? `${r.left.text.replace('-', '')} over` : `${r.left.text} left`}`,
                        ),
                    ),
                    el('div', {className: 'meter'}, el('span', {style: `width:${r.shareSize / 100}%`})),
                ),
            ),
        ),
    ];
}

function openCategory(ctx, category) {
    const others = ctx.boot.categories.filter((c) => c.id !== category?.id);
    const form = formDialog({
        title: category ? `Category: ${category.name}` : 'New category',
        fields: [
            field('Name', el('input', {name: 'name', required: true, value: category?.name ?? '', autocomplete: 'off'})),
            field('Colour', el('input', {name: 'color', type: 'color', value: category?.color || '#2a78d6'})),
            category
                ? field(
                      'Monthly budget',
                      el('input', {
                          name: 'budget',
                          value: category.budget,
                          inputMode: 'decimal',
                          autocomplete: 'off',
                          placeholder: 'No budget',
                      }),
                      'Leave blank for no budget.',
                  )
                : null,
        ],
        actions: category
            ? [
                  el('button', {type: 'button', className: 'quiet danger', onclick: () => remove()}, 'Delete'),
                  el('button', {type: 'button', className: 'quiet', onclick: () => archive()}, category.archived ? 'Restore' : 'Archive'),
                  others.length ? el('button', {type: 'button', className: 'quiet', onclick: () => mergeInto()}, 'Merge…') : null,
                  el('button', {type: 'button', className: 'quiet', onclick: () => showEntries()}, 'Entries'),
              ].filter((b) => b !== null)
            : [],
        onSubmit: (data) =>
            ctx.perform(async () => {
                if (!category) {
                    await ctx.app.createCategory(data.get('name'), data.get('color'));
                    return;
                }
                await ctx.app.updateCategory(category.id, {name: data.get('name'), color: data.get('color')});
                await ctx.app.setBudget(category.id, data.get('budget'));
            }),
    });

    function showEntries() {
        form.closest('dialog')?.close();
        ctx.openLedger({category: category.id});
    }
    async function archive() {
        form.closest('dialog').close();
        await report(ctx.perform(() => ctx.app.setCategoryArchived(category.id, !category.archived)));
    }
    function mergeInto() {
        formDialog({
            title: `Merge ${category.name} into…`,
            fields: [
                field(
                    'Category',
                    el(
                        'select',
                        {name: 'into'},
                        others.map((c) => el('option', {value: c.id}, c.name)),
                    ),
                ),
                el('p', {className: 'muted'}, `Entries in ${category.name} will show under the chosen category. You can undo this later.`),
            ],
            submitLabel: 'Merge',
            onSubmit: (data) => ctx.perform(() => ctx.app.mergeCategory(category.id, data.get('into'))),
        });
    }
    async function remove() {
        form.closest('dialog').close();
        if (
            await confirmDialog(
                `Delete ${category.name}? Its entries become Uncategorized. To move them to another category instead, use Merge.`,
            )
        ) {
            await report(ctx.perform(() => ctx.app.deleteCategory(category.id)));
        }
    }
    async function report(result) {
        const error = await result;
        if (error) {
            ctx.notify(error, true);
        }
    }
}
