import {confirmDialog, el, field, fill, formDialog, pageHeader} from './dom.js';
import {openEntryForm} from './entry-form.js';

export async function render(container, ctx) {
    const act = async (change) => {
        const error = await ctx.perform(change);
        if (error) {
            ctx.notify(error, true);
        }
    };
    const own = ctx.boot.accounts.filter((a) => a.kind === 'own');
    const people = ctx.boot.accounts.filter((a) => a.kind === 'person');
    const merged = ctx.boot.merged.accounts;

    const detail = (a) => {
        if (!a.listed) {
            return 'Deleted';
        }
        const owes =
            a.owes === 'owes-you'
                ? `Owes you ${a.settle}`
                : a.owes === 'you-owe'
                  ? `You owe ${a.settle}`
                  : a.kind === 'person'
                    ? 'Settled'
                    : '';
        return [owes, a.archived ? 'Archived' : ''].filter(Boolean).join(' · ');
    };
    const row = (a) =>
        el(
            'li',
            {},
            el(
                'button',
                {className: 'row', onclick: () => (a.listed ? openAccount(ctx, a) : ctx.openLedger({account: a.id}))},
                el('span'),
                el('span', {className: 'what'}, el('strong', {}, a.name), detail(a) ? el('small', {className: 'muted'}, detail(a)) : null),
                el('span'),
                el('span', {className: `amount ${a.balance.negative ? 'expense' : ''}`}, a.balance.text),
            ),
        );

    fill(
        container,
        pageHeader(
            'Accounts and people',
            'Balances include every entry and transfer.',
            el('button', {onclick: () => openAccount(ctx, null, 'person')}, '+ Person'),
            el('button', {className: 'primary', onclick: () => openAccount(ctx, null, 'own')}, '+ Account'),
        ),
        el(
            'article',
            {className: 'card'},
            el('h2', {}, 'Your accounts'),
            el('p', {className: 'muted'}, 'Bank accounts, cash, cards. A debt, such as a credit card, has a negative balance.'),
            own.length === 0
                ? el('p', {className: 'muted'}, 'No accounts yet. Add one here or while adding an entry.')
                : el('ul', {className: 'card rows'}, own.map(row)),
        ),
        el(
            'article',
            {className: 'card'},
            el('h2', {}, 'People'),
            el('p', {className: 'muted'}, 'Friends you split with or who pay for you. A positive balance means they owe you.'),
            people.length === 0
                ? el(
                      'p',
                      {className: 'muted'},
                      'No one yet. Use "Split with a person" when adding an expense, or pick a person as the account when they paid for you.',
                  )
                : el('ul', {className: 'card rows'}, people.map(row)),
        ),
        merged.length === 0
            ? null
            : el(
                  'article',
                  {className: 'card'},
                  el('h2', {}, 'Merged'),
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
                                              await act(() => ctx.app.unmergeAccount(m.id));
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

function settle(ctx, person, owesYou) {
    const mine =
        ctx.boot.accounts.find((a) => a.id === ctx.boot.lastAccount && a.kind === 'own') ?? ctx.boot.accounts.find((a) => a.kind === 'own');
    openEntryForm(ctx, {
        id: '',
        type: 'transfer',
        amount: person.settle,
        note: `Settle up with ${person.name}`,
        from: owesYou ? person.id : (mine?.id ?? ''),
        to: owesYou ? (mine?.id ?? '') : person.id,
    });
}

function openAccount(ctx, account, kind = account?.kind ?? 'own') {
    const others = ctx.boot.accounts.filter((a) => a.listed && a.id !== account?.id && a.kind === kind);
    const form = formDialog({
        title: account ? account.name : kind === 'person' ? 'New person' : 'New account',
        fields: [
            field(
                'Name',
                el('input', {
                    name: 'name',
                    required: true,
                    value: account?.name ?? '',
                    autocomplete: 'off',
                    placeholder: kind === 'person' ? 'e.g. Rahul' : 'e.g. HDFC, Cash, Credit card',
                }),
            ),
            field(
                kind === 'person' ? 'Owed before you started (positive: they owe you)' : 'Opening balance',
                el('input', {
                    name: 'opening',
                    value: account && account.opening !== '0.00' ? account.opening : '',
                    inputMode: 'decimal',
                    autocomplete: 'off',
                    placeholder: '0',
                }),
                'What it held before your first entry. Leave blank for zero.',
            ),
        ],
        actions: account
            ? [
                  el('button', {type: 'button', className: 'quiet danger', onclick: () => remove()}, 'Delete'),
                  el('button', {type: 'button', className: 'quiet', onclick: () => archive()}, account.archived ? 'Restore' : 'Archive'),
                  others.length ? el('button', {type: 'button', className: 'quiet', onclick: () => mergeInto()}, 'Merge…') : null,
                  el('button', {type: 'button', className: 'quiet', onclick: () => showEntries()}, 'Entries'),
                  account.owes ? el('button', {type: 'button', className: 'quiet', onclick: () => settleUp()}, 'Settle up') : null,
              ].filter((b) => b !== null)
            : [],
        onSubmit: (data) =>
            ctx.perform(() =>
                account
                    ? ctx.app.updateAccount(account.id, {name: data.get('name'), opening: data.get('opening'), kind})
                    : ctx.app.createAccount({name: data.get('name'), opening: data.get('opening'), kind}),
            ),
    });

    const report = async (result) => {
        const error = await result;
        if (error) {
            ctx.notify(error, true);
        }
    };
    function showEntries() {
        form.closest('dialog')?.close();
        ctx.openLedger({account: account.id});
    }
    function settleUp() {
        form.closest('dialog')?.close();
        settle(ctx, account, account.owes === 'owes-you');
    }
    async function archive() {
        form.closest('dialog').close();
        await report(ctx.perform(() => ctx.app.setAccountArchived(account.id, !account.archived)));
    }
    function mergeInto() {
        formDialog({
            title: `Merge ${account.name} into…`,
            fields: [
                field(
                    kind === 'person' ? 'Person' : 'Account',
                    el(
                        'select',
                        {name: 'into'},
                        others.map((a) => el('option', {value: a.id}, a.name)),
                    ),
                ),
                el(
                    'p',
                    {className: 'muted'},
                    `Everything in ${account.name}, its opening balance aside, moves to the chosen one. You can undo this later.`,
                ),
            ],
            submitLabel: 'Merge',
            onSubmit: (data) => ctx.perform(() => ctx.app.mergeAccount(account.id, data.get('into'))),
        });
    }
    async function remove() {
        form.closest('dialog').close();
        if (await confirmDialog(`Delete ${account.name}? This only works when nothing uses it; otherwise merge it into another.`)) {
            await report(ctx.perform(() => ctx.app.deleteAccount(account.id)));
        }
    }
}
