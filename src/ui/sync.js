import {confirmDialog, el, field, formDialog} from './dom.js';

const TOKEN_HINT = 'A fine-grained GitHub token limited to this repository, with Contents: read and write. Make one per device.';

// The fields both "connect" and "join" ask for. withConfirm adds a second passphrase field.
export function syncFields(withConfirm) {
    return [
        field(
            'Private GitHub repository',
            el('input', {
                name: 'repo',
                required: true,
                placeholder: 'you/fingeist-data',
                autocomplete: 'off',
                autocapitalize: 'off',
                spellcheck: false,
            }),
        ),
        field('Token', el('input', {name: 'token', type: 'password', required: true, autocomplete: 'off'}), TOKEN_HINT),
        field('Name of this device', el('input', {name: 'deviceName', placeholder: 'iPhone, Mac…', autocomplete: 'off'})),
        field(
            'Passphrase',
            el('input', {name: 'passphrase', type: 'password', required: true, minLength: 8, autocomplete: 'new-password'}),
            withConfirm
                ? "Encrypts everything before it leaves this device. Keep it in a password manager: without it the synced data can't be read."
                : null,
        ),
        withConfirm
            ? field('Passphrase again', el('input', {name: 'confirm', type: 'password', required: true, autocomplete: 'new-password'}))
            : null,
    ];
}

export function syncInput(data) {
    if (data.has('confirm') && data.get('confirm') !== data.get('passphrase')) {
        throw new Error('The two passphrases are different');
    }
    return {repo: data.get('repo'), token: data.get('token'), deviceName: data.get('deviceName'), passphrase: data.get('passphrase')};
}

const STATE_TEXT = {
    idle: 'Up to date',
    syncing: 'Syncing',
    offline: 'Offline: changes are kept on this device and sync when you are back online',
    paused: 'Paused',
    error: 'Last sync failed; it will try again',
};

export function syncCard(ctx) {
    const s = ctx.app.syncStatus();
    if (!s.connected) {
        return el(
            'section',
            {className: 'card form'},
            el(
                'div',
                {},
                el('h2', {}, 'Sync'),
                el(
                    'p',
                    {className: 'muted'},
                    'This project lives on this device only. Connect an empty private GitHub repository to sync it, encrypted, with your other devices.',
                ),
            ),
            el('div', {}, el('button', {className: 'primary', onclick: () => openConnect(ctx)}, 'Set up sync')),
        );
    }
    const last = s.lastSync ? new Date(s.lastSync).toLocaleString() : 'not yet in this session';
    return el(
        'section',
        {className: 'card form'},
        el('div', {}, el('h2', {}, 'Sync'), el('p', {className: 'muted'}, `${s.repo} · this device: ${s.deviceName || 'unnamed'}`)),
        el(
            'p',
            {className: s.state === 'paused' || s.state === 'error' ? 'error' : ''},
            STATE_TEXT[s.state] ?? s.state,
            s.message ? `: ${s.message}` : '',
        ),
        el('p', {className: 'muted'}, `${s.pending} changes not synced yet · last sync ${last}`),
        el(
            'div',
            {className: 'head-actions'},
            el('button', {className: 'primary', onclick: () => ctx.syncNow()}, 'Sync now'),
            el('button', {onclick: () => openToken(ctx)}, 'Replace token'),
            el('button', {onclick: () => openPassphrase(ctx)}, 'Change passphrase'),
        ),
    );
}

function openConnect(ctx) {
    formDialog({
        title: 'Set up sync',
        fields: [
            el('p', {className: 'muted'}, 'Use a new, empty private repository. Its first device creates the encrypted vault there.'),
            ...syncFields(true),
        ],
        submitLabel: 'Connect',
        onSubmit: (data) =>
            ctx.perform(async () => {
                const status = await ctx.app.connect(syncInput(data));
                if (status.state !== 'idle') {
                    ctx.notify(`Connected, but the first sync did not finish: ${status.message}`, true);
                }
            }),
    });
}

function openToken(ctx) {
    formDialog({
        title: 'Replace token',
        fields: [field('New token', el('input', {name: 'token', type: 'password', required: true, autocomplete: 'off'}), TOKEN_HINT)],
        onSubmit: (data) => ctx.perform(() => ctx.app.updateToken(data.get('token'))),
    });
}

function openPassphrase(ctx) {
    formDialog({
        title: 'Change passphrase',
        fields: [
            field('Current passphrase', el('input', {name: 'old', type: 'password', required: true, autocomplete: 'current-password'})),
            field(
                'New passphrase',
                el('input', {name: 'passphrase', type: 'password', required: true, minLength: 8, autocomplete: 'new-password'}),
            ),
            field('New passphrase again', el('input', {name: 'confirm', type: 'password', required: true, autocomplete: 'new-password'})),
        ],
        onSubmit: (data) =>
            ctx.perform(async () => {
                if (data.get('confirm') !== data.get('passphrase')) {
                    throw new Error('The two passphrases are different');
                }
                await ctx.app.changePassphrase(data.get('old'), data.get('passphrase'));
                ctx.notify('Passphrase changed. Devices already set up keep working; new devices use the new one.');
            }),
    });
}

export async function eraseDevice(ctx) {
    const connected = ctx.app.syncStatus().connected;
    const pending = ctx.app.syncStatus().pending;
    const warning = !connected
        ? 'This project is not synced anywhere. Erasing it deletes it for good.'
        : pending > 0
          ? `${pending} changes have not synced yet and will be lost. The synced data stays in the repository.`
          : 'The synced data stays in the repository, so you can join it again.';
    if (await confirmDialog(`Erase everything Fingeist stores on this device? ${warning}`, 'Erase this device')) {
        await ctx.app.eraseDevice();
        window.location.reload();
    }
}
