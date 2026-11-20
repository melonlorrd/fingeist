import * as accounts from './accounts.js';
import * as categories from './categories.js';
import * as dashboard from './dashboard.js';
import {dialogElement, el, fill, placePillHighlights, rememberTap} from './dom.js';
import {openEntryForm} from './entry-form.js';
import {icon} from './icons.js';
import * as ledger from './ledger.js';
import * as settings from './settings.js';
import {renderSetup} from './setup.js';

const views = {
    dashboard: {label: 'Dashboard', render: dashboard.render},
    ledger: {label: 'Ledger', render: ledger.render},
    accounts: {label: 'Accounts', render: accounts.render},
    categories: {label: 'Categories', render: categories.render},
    settings: {label: 'Settings', render: settings.render},
};

const NOTICE_WITH_ACTION_MS = 8000;
const SYNC_AFTER_EDIT_MS = 5000;
const SYNC_EVERY_MS = 5 * 60 * 1000;
const SYNC_LABELS = {
    local: 'This device only',
    idle: 'Synced',
    syncing: 'Syncing…',
    offline: 'Offline',
    paused: 'Sync paused',
    error: 'Sync failed',
};

/** Draws the app into #app and keeps it in sync. app is core/app.js. */
export function startShell(app) {
    let boot = null;
    let activeTab = 'dashboard';
    let renderedTab = null;
    let renderToken = 0;
    let noticeTimer;
    let syncTimer;

    const title = el('span', {className: 'brand'}, 'Fingeist');
    const syncState = el('button', {className: 'quiet sync-state', onclick: () => showTab('settings')});
    // The same nav and Add button on every screen size: CSS puts them in the top bar on wide screens,
    // and the nav at the bottom with Add floating above it on phones.
    const nav = el('nav', {className: 'pills tabs', 'aria-label': 'Sections'});
    const addButton = el(
        'button',
        {className: 'primary add-button', onclick: () => openEntryForm(ctx, null)},
        icon('plus'),
        el('span', {}, 'Entry'),
    );
    const notice = el('div', {className: 'notice toast', role: 'status', 'aria-live': 'polite', hidden: true});
    const banner = el('div', {});
    const view = el('main', {});
    const topbar = el(
        'header',
        {className: 'topbar'},
        el('div', {className: 'topbar-inner'}, el('div', {className: 'brand-row'}, title, syncState), nav, addButton),
    );
    /** @type {HTMLElement} */ (document.getElementById('app')).append(topbar, el('div', {className: 'page'}, banner, view), notice);

    const ctx = {
        app,
        get boot() {
            return boot;
        },
        perform,
        notify: showNotice,
        rerender: renderView,
        fresh: true,
        refresh,
        syncNow,
        openLedger,
    };

    async function openLedger(query) {
        ledger.setQuery(query);
        activeTab = 'ledger';
        renderChrome();
        await renderView();
    }

    /**
     * An optional action adds a button and makes the notice disappear after a few seconds.
     * @param {string} text
     * @param {boolean} [isError]
     * @param {{label: string, run: () => void} | null} [action]
     */
    function showNotice(text, isError = false, action = null) {
        clearTimeout(noticeTimer);
        fill(
            notice,
            el('span', {}, text),
            action
                ? el(
                      'button',
                      {
                          onclick: () => {
                              showNotice('');
                              action.run();
                          },
                      },
                      action.label,
                  )
                : null,
            el('button', {className: 'close quiet', 'aria-label': 'Dismiss', onclick: () => showNotice('')}, icon('close')),
        );
        notice.classList.toggle('error', isError);
        notice.hidden = !text;
        if (action) {
            noticeTimer = setTimeout(() => showNotice(''), NOTICE_WITH_ACTION_MS);
        }
    }

    // Runs a change, redraws, and schedules a sync. Returns an error message for the form, or ''.
    async function perform(change) {
        showNotice('');
        try {
            await change();
        } catch (err) {
            return String(err?.message ?? err);
        }
        await refresh();
        clearTimeout(syncTimer);
        syncTimer = setTimeout(syncNow, SYNC_AFTER_EDIT_MS);
        return '';
    }

    async function syncNow() {
        if (!app.syncStatus().connected) {
            return;
        }
        showSync({...app.syncStatus(), state: 'syncing'});
        await app.sync();
        const status = app.syncStatus();
        if (status.state === 'idle' && !dialogOpen()) {
            await refresh();
        } else {
            showSync(status);
        }
    }

    function showSync(status) {
        syncState.className = `quiet sync-state ${status.state}`;
        const pending = status.pending > 0 ? ` (${status.pending} not synced)` : '';
        fill(syncState, el('span', {className: 'dot'}), `${SYNC_LABELS[status.state] ?? status.state}${status.connected ? pending : ''}`);
        syncState.title = status.message || '';
    }

    async function refresh() {
        try {
            boot = app.boot();
        } catch (err) {
            showNotice(String(err?.message ?? err), true);
            return null;
        }
        renderChrome();
        if (boot.needsSetup) {
            dashboard.disposeCharts();
            renderSetup(view, ctx);
        } else {
            await renderView();
        }
        return boot;
    }

    function renderChrome() {
        title.textContent = boot.needsSetup ? 'Fingeist' : boot.projectName;
        showSync(boot.sync);
        nav.hidden = boot.needsSetup;
        addButton.hidden = boot.needsSetup;
        nav.replaceChildren(
            ...(boot.needsSetup
                ? []
                : Object.entries(views).map(([key, v]) =>
                      el(
                          'button',
                          {
                              className: key === activeTab ? 'active' : '',
                              'aria-current': key === activeTab ? 'page' : 'false',
                              onclick: () => showTab(key),
                          },
                          icon(key),
                          el('span', {}, v.label),
                      ),
                  )),
        );
        const problems = boot.problems ?? [];
        const conflicts = boot.conflicts ?? [];
        fill(
            banner,
            problems.length === 0
                ? null
                : el(
                      'section',
                      {className: 'notice error'},
                      el('strong', {}, "Some synced records can't be read. They are left out until the device that wrote them fixes them."),
                      el(
                          'ul',
                          {},
                          problems.map((text) => el('li', {}, text)),
                      ),
                  ),
            conflicts.length === 0
                ? null
                : el(
                      'section',
                      {className: 'notice'},
                      el('strong', {}, 'Another device changed something you had edited here. Its change was kept:'),
                      el(
                          'ul',
                          {},
                          conflicts.map((text) => el('li', {}, text)),
                      ),
                      el(
                          'button',
                          {
                              onclick: async () => {
                                  await app.dismissConflicts();
                                  await refresh();
                              },
                          },
                          'Dismiss',
                      ),
                  ),
        );
    }

    async function showTab(name) {
        if (activeTab === name || boot?.needsSetup) {
            return;
        }
        activeTab = name;
        renderChrome();
        await renderView();
    }

    // Draws into a detached element first, so a slow view cannot overwrite a newer one. Redrawing the
    // same tab keeps the scroll position and the focused field.
    async function renderView() {
        const token = ++renderToken;
        const restore = renderedTab === activeTab ? rememberPosition() : null;
        dashboard.disposeCharts();
        const container = el('div', {});
        // A screen just opened animates in; a redraw of the same screen doesn't.
        ctx.fresh = renderedTab !== activeTab;
        container.classList.toggle('enter', ctx.fresh);
        try {
            await views[activeTab].render(container, ctx);
        } catch (err) {
            showNotice(String(err?.message ?? err), true);
            return;
        }
        if (token === renderToken) {
            view.replaceChildren(container);
            renderedTab = activeTab;
            if (restore) {
                restore();
            } else {
                window.scrollTo(0, 0);
            }
        }
    }

    function rememberPosition() {
        const scrollY = window.scrollY;
        const active = /** @type {HTMLInputElement | null} */ (document.activeElement);
        const tag = active?.tagName;
        const key = active && view.contains(active) ? active.getAttribute('aria-label') || active.name : null;
        const selection = typeof active?.selectionStart === 'number' ? {start: active.selectionStart, end: active.selectionEnd} : null;
        return () => {
            window.scrollTo(0, scrollY);
            const candidates = /** @type {NodeListOf<HTMLInputElement>} */ (view.querySelectorAll(tag ?? '*'));
            const target = key && [...candidates].find((node) => (node.getAttribute('aria-label') || node.name) === key);
            if (target) {
                target.focus();
                if (selection) {
                    target.setSelectionRange(selection.start, selection.end);
                }
            }
        };
    }

    const dialogOpen = () => dialogElement().open;
    const canUseShortcuts = () => boot && !boot.needsSetup && !dialogOpen();
    const isTextEntry = (node) =>
        node instanceof HTMLElement && (node.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName));

    window.addEventListener('keydown', async (event) => {
        const isN = event.key.toLowerCase() === 'n' && !event.altKey;
        // Some browsers keep Cmd/Ctrl+N for a new window, so N alone works too.
        if (isN && (event.metaKey || event.ctrlKey || !isTextEntry(event.target)) && canUseShortcuts()) {
            event.preventDefault();
            openEntryForm(ctx, null);
        } else if (event.key === '/' && !isTextEntry(event.target) && canUseShortcuts()) {
            event.preventDefault();
            await showTab('ledger');
            /** @type {HTMLInputElement | null} */ (document.querySelector('input[type=search]'))?.focus();
        }
    });

    // Charts read their colours when drawn, so draw again when the system switches between light and dark.
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
        if (boot && !boot.needsSetup) {
            renderView();
        }
    });
    window.addEventListener('online', syncNow);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            syncNow();
        }
    });
    setInterval(() => {
        if (document.visibilityState === 'visible') {
            syncNow();
        }
    }, SYNC_EVERY_MS);

    // Screens redraw their pills freely, so one observer keeps every sliding highlight in place.
    let placing = false;
    const placeSoon = () => {
        if (!placing) {
            placing = true;
            requestAnimationFrame(() => {
                placing = false;
                placePillHighlights();
            });
        }
    };
    new MutationObserver(placeSoon).observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'hidden'],
    });
    window.addEventListener('resize', placeSoon);

    // Sticky day headers sit just under the top bar, whose height changes with the screen and safe area.
    new ResizeObserver(() => document.documentElement.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`)).observe(topbar);

    // On phones the floating Add button shrinks to a round + while scrolling down, so it covers less.
    let lastScroll = 0;
    window.addEventListener(
        'scroll',
        () => {
            const y = window.scrollY;
            addButton.classList.toggle('compact', y > lastScroll && y > 80);
            lastScroll = y;
        },
        {passive: true},
    );
    document.addEventListener('pointerdown', rememberTap, true);

    refresh().then(syncNow);
    return {notify: showNotice};
}
