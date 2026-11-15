// Categories, accounts and people, budgets, repeats and project settings.

import {accountFields, budgetFields, categoryFields, settingsFields} from './fields.js';
import {PROJECT_SETTINGS} from './records.js';
import {liveRecord} from './state.js';
import {sameName} from './workspace.js';

/** Picker values starting with this name a new account or category to create, e.g. "new:Cash". */
export const NEW_PREFIX = 'new:';

/** @param {import('./workspace.js').Workspace} ws */
export async function createCategory(ws, name, color) {
    const fields = categoryFields({name, color});
    if (sameName(ws.view().project.categories, fields.name)) {
        throw new Error(`There is already a category called "${fields.name}"`);
    }
    const id = ws.newId();
    await ws.put('category', id, {...fields, archived: false, mergedInto: ''});
    return id;
}

/** @param {import('./workspace.js').Workspace} ws */
export async function createAccount(ws, {name, opening = '', kind = 'own'}) {
    const fields = accountFields({name, opening, kind}, ws.decimals());
    if (sameName(ws.view().project.accounts, fields.name)) {
        throw new Error(`There is already an account called "${fields.name}"`);
    }
    const id = ws.newId();
    await ws.put('account', id, {...fields, archived: false, mergedInto: ''});
    return id;
}

/**
 * An account id from a picker: an existing id, or "new:Name" for one to create (or reuse, if the name exists).
 * @param {import('./workspace.js').Workspace} ws
 * @returns {Promise<string>}
 */
export async function accountRef(ws, value, kind = 'own') {
    const text = String(value ?? '');
    if (!text.startsWith(NEW_PREFIX)) {
        return text;
    }
    const name = text.slice(NEW_PREFIX.length).trim();
    return sameName(ws.view().project.accounts, name)?.id ?? createAccount(ws, {name, kind});
}

/**
 * A category id from a picker, like accountRef.
 * @param {import('./workspace.js').Workspace} ws
 * @returns {Promise<string>}
 */
export async function categoryRef(ws, value) {
    const text = String(value ?? '');
    if (!text.startsWith(NEW_PREFIX)) {
        return text;
    }
    const name = text.slice(NEW_PREFIX.length).trim();
    return sameName(ws.view().project.categories, name)?.id ?? createCategory(ws, name, '');
}

/** @param {import('./workspace.js').Workspace} ws */
export function catalogApi(ws) {
    function redirectLoops(kind, id, into) {
        const records = kind === 'category' ? ws.view().project.categoryById : ws.view().project.accountById;
        for (let current = into, step = 0; current && step < 64; current = records.get(current)?.mergedInto, step++) {
            if (current === id) {
                return true;
            }
        }
        return false;
    }

    async function merge(kind, id, into) {
        if (!into || id === into || redirectLoops(kind, id, into)) {
            throw new Error('Pick a different one to merge into');
        }
        await ws.put(kind, id, {mergedInto: into});
    }

    function referenced(accountId) {
        const b = ws.view();
        return (
            b.txns.some((t) => t.account === accountId || t.lines.some((l) => l.person === accountId)) ||
            b.transfers.some((x) => x.from === accountId || x.to === accountId)
        );
    }

    return {
        createCategory: (name, color) => createCategory(ws, name, color),

        async updateCategory(id, {name, color}) {
            const fields = categoryFields({name, color});
            if (sameName(ws.view().project.categories, fields.name, id)) {
                throw new Error(`There is already a category called "${fields.name}"`);
            }
            await ws.putChanged('category', id, fields);
        },

        setCategoryArchived: (id, archived) => ws.put('category', id, {archived}),
        mergeCategory: (id, into) => merge('category', id, into),
        unmergeCategory: (id) => ws.put('category', id, {mergedInto: ''}),

        async deleteCategory(id) {
            await ws.remove('category', id);
            if (liveRecord(ws.book.winners, 'budget', id)) {
                await ws.remove('budget', id);
            }
        },

        /** Sets a category's monthly budget; empty text removes it. */
        async setBudget(categoryId, amount) {
            if (String(amount ?? '').trim() === '') {
                if (liveRecord(ws.book.winners, 'budget', categoryId)) {
                    await ws.remove('budget', categoryId);
                }
                return;
            }
            await ws.putChanged('budget', categoryId, budgetFields({amount}, ws.decimals()));
        },

        createAccount: (input) => createAccount(ws, input),

        async updateAccount(id, {name, opening, kind}) {
            const fields = accountFields({name, opening, kind}, ws.decimals());
            if (sameName(ws.view().project.accounts, fields.name, id)) {
                throw new Error(`There is already an account called "${fields.name}"`);
            }
            await ws.putChanged('account', id, fields);
        },

        setAccountArchived: (id, archived) => ws.put('account', id, {archived}),
        mergeAccount: (id, into) => merge('account', id, into),
        unmergeAccount: (id) => ws.put('account', id, {mergedInto: ''}),

        async deleteAccount(id) {
            if (referenced(id)) {
                throw new Error('This account has entries. Merge it into another account instead.');
            }
            await ws.remove('account', id);
        },

        setRepeatPaused: (id, paused) => ws.put('recurring', id, {paused}),
        stopRepeat: (id) => ws.put('recurring', id, {until: ws.today()}),
        deleteRepeat: (id) => ws.remove('recurring', id),

        async saveSettings(input) {
            ws.requireProject();
            await ws.putChanged('setting', PROJECT_SETTINGS, settingsFields(input, ws.decimals()));
        },
    };
}
