import {SaveCategory, SetCategoryArchived} from '../wailsjs/go/main/App';

import {el, field, fill, formDialog, pageHeader} from './dom.js';

export async function render(container, ctx) {
    const act = async (change) => {
        const error = await ctx.perform(change);
        if (error) {
            ctx.notify(error, true);
        }
    };

    const tile = (c) => el('li', {className: `tile category ${c.archived ? 'archived' : ''}`},
        el('input', {
            type: 'color', value: c.color, 'aria-label': `Colour of ${c.name}`,
            onchange: (event) => act(() => SaveCategory(c.name, event.target.value)),
        }),
        el('strong', {}, c.name),
        el('button', {className: 'quiet', onclick: () => act(() => SetCategoryArchived(c.name, !c.archived))}, c.archived ? 'Restore' : 'Archive'),
    );

    const active = ctx.boot.categories.filter((c) => !c.archived);
    const archived = ctx.boot.categories.filter((c) => c.archived);
    fill(container,
        pageHeader('Categories', 'Colours and archiving. Names stay fixed because transactions refer to them.',
            el('button', {className: 'primary', onclick: () => openNewCategory(ctx)}, '+ New category')),
        el('article', {className: 'card'},
            el('h2', {}, `Active categories (${active.length})`),
            active.length === 0 ? el('p', {className: 'muted'}, 'No categories yet.') : el('ul', {className: 'tiles-grid'}, active.map(tile))),
        archived.length === 0 ? null : el('article', {className: 'card'},
            el('h2', {}, `Archived (${archived.length})`),
            el('p', {className: 'muted'}, 'These leave the picker but stay valid on existing transactions.'),
            el('ul', {className: 'tiles-grid'}, archived.map(tile))),
    );
}

function openNewCategory(ctx) {
    formDialog({
        title: 'New category',
        fields: [
            field('Name', el('input', {name: 'name', required: true, autocomplete: 'off'})),
            field('Colour', el('input', {name: 'color', type: 'color', value: '#2a78d6'})),
        ],
        submitLabel: 'Add category',
        onSubmit: (data) => ctx.perform(() => SaveCategory(data.get('name'), data.get('color'))),
    });
}
