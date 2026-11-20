# AGENTS.md

Rules for AI agents working on **Fingeist**. For what the app is, its architecture, data format, and setup, read [`README.md`](README.md) when the task needs it.

## Git

- **Allowed:** `git status`, `git diff`, `git log`, `git show`, `git blame`, `git branch` (list only).
- **Everything else needs the owner's explicit permission, for that action, in this conversation**: commit, push, merge, rebase, reset, restore, stash, tag, add, and creating, switching, or deleting branches. Earlier permission doesn't carry over.
- Editing files is fine on whatever branch is checked out, `main` included.
- When done: summarize what changed and why, suggest a commit message, and stop.

## Scope

Build only the current phase. If a task needs something from a later phase, ask.

| Phase | Contents |
|-------|----------|
| **MVP** ← current | Fingeist as a PWA on GitHub Pages, fully usable offline. One project, currency chosen at creation (INR by default). Settings: project name, currency (shown, locked), month start day, small-purchase thresholds (default ₹100/250/500/1000). Accounts and people with opening balance, rename, merge, archive, delete, current balance and settle up. Categories with colours, rename, merge, archive and delete, starting with none (Uncategorized is built in). Monthly budgets per category. Ledger with add/edit/delete/duplicate, bulk recategorise, search, filters and totals. Expense / Income / Refund / Transfer, splits (across categories and with people), habit intent, repeating entries, merchant suggestions. Dashboard with summary cards, budgets and the charts in *Reference images* below plus top merchants, with drill-down into the ledger, an account filter and date presets. Export to JSON and CSV. Encrypted sync through a GitHub repo, noting when another device overwrote a field edited here. |
| **2** | Gitea/Forgejo adapter (covers Codeberg and self-hosted), GitLab adapter, snapshots, multiple projects. |
| **Later** | More chart types, receipts. |
| **Never** | A server or backend of our own, our own user accounts, telemetry, analytics. Network calls to anything other than the user's configured sync host. |

## Reference images

`reference-images/` holds screenshots of another expense app. It is temporary and untracked, and will be deleted once the UI design is set; the table below is the lasting spec, so it must stand on its own. They are the spec for **what** to build: screens, fields, metrics, charts. The owner wants the UI structure and controls to resemble them (page header cards, rounded cards, pill controls, a grouped ledger, the quick-add dialog), with navigation in a top bar on wide screens and a bottom tab bar on phones, never a sidebar. Keep Fingeist's own palette, wording and icons; no emoji. Everything below is MVP. File names below are the `Pasted 2026-11-07 at …` timestamps. The portfolio screens (`23.43.20`–`23.43.37`) are out of scope.

| Screen | Image | Build |
|--------|-------|-------|
| Ledger | `23.42.49` | Rows grouped by day, newest first, with a total per day and totals for the current filter. Search over merchant, note, category, account, people and tags. Filters: month, category, account, date range (from drill-down), and All / Expenses / Income / Refunds / Transfers / Needs / Wants / Impulses. |
| Add/edit transaction | `23.42.57`, `23.43.07` | Expense / Income / Refund / Transfer toggle; the user types a positive amount (sums like `120+45` allowed). Account picker (own accounts and people; defaults to the last account used on this device; *New account…* inline); category chips with Uncategorized and *+ New category*; optional split into parts by category or person; intent (Need / Want / Impulse), expenses only; merchant suggestions that fill category and account; repeat for new entries. Transfer: from, to, amount, note. Time defaults to now and is editable; clearing it means "time unknown". |
| Categories | `23.43.45` | List with colours and budgets. Add, rename, recolour, archive, merge (undoable), delete. Archived categories leave the picker but stay valid on existing rows. |
| Dashboard: summary | `23.43.53` | Presets: This month / 3 months / Year to date / All time. Account filter: All accounts or one. Cards: total spent, total income, net savings, average daily spend (with transaction count). Each card compares with the previous period of the same length, or says there's no previous data. |
| Dashboard: charts | `23.43.53`–`23.44.23` | Grouped as Cash flow, Where it goes and Habits; two columns on wide screens, a card left alone on a row spans both. Running balance: opening balances of the accounts in view plus cumulative net over time, one step per day, with the latest balance above it. Monthly income vs expense, shown only when the range covers two or more months. Category breakdown: each category's spending as a bar, with its change against the previous period of the same length; a row opens the ledger for it. Top merchants. Spending calendar: one month at a time, days shaded by expense in four steps relative to the range's biggest day, zero-expense days marked, with current streak, best streak this month and zero-expense day count (future days don't count); a day opens the ledger for it. Time of day: spend per hour across every day of the week; picking an hour shows occurrences, share of days, average and total, categories, and most common merchants/notes with average and count. Intent: each intent's total and share as a proportion bar, plus spending per intent by month when the range covers two or more months. Small purchases: expenses at or under a selectable threshold, with their count, total, and share of all expenses. When no chart has data, one note replaces them all. |

- All aggregation lives in `src/core/report`, one dispatcher case each, per *Adding a chart type*. Percentages and comparisons are computed and formatted in `core`.
- Transfers are never income, expense or intent. They only move account balances. Refunds lower spending in their category and are never income. A share split with a person is not your spending; it is what they owe you. Only `own` accounts count in the running balance.
- Hour-of-day charts use the wall-clock hour in the row's own offset. Rows with time unknown count in every date-based view but are left out of hour charts, which show "N transactions have no time" and let the user open them to add one.
- Format amounts with the currency symbol and standard thousands grouping, for every currency, e.g. `₹883,727.29`. No lakh grouping, unlike the images.
- **Changes to the sync format need the owner's approval first** (README → *Data format*): change kinds, record fields, file layout, `vault.json`, encryption. Propose the change, get a yes, then document it.

## How to work

- **Do what was asked, nothing more.** No unrequested features, refactors, renames, or "while I'm here" cleanups. Mention them instead.
- **Smallest change that works.** No speculative interfaces, options, config knobs, or abstractions for future phases. Three similar lines beat a premature helper.
- **Don't add files** unless the task needs them. Don't create docs, scripts, or examples nobody asked for.
- **No new dependencies** without asking. Approved: `echarts` and `vite`; for development only, `typescript` (type checking, no build step) and `happy-dom` (UI smoke test); Biome from nixpkgs; Node's built-in modules (`node:test`, `node:assert`).
- **Ask** when a requirement is ambiguous, especially anything touching the sync format.
- **Keep docs true.** If you change architecture, the data format, commands, or the build, update `README.md` in the same task. If you change a rule, update this file. Project knowledge lives in these two files, not in agent memory.
- Don't edit generated files: `dist/`, `node_modules/`.

## Environment

- Work inside `nix develop`. Need a tool? Add it to `flake.nix`; never install globally. Don't run `nix flake update` unless asked.
- Use the dev shell helpers, defined in `flake.nix`: `dev`, `check`, `fmt`, `build`, `preview`. They install npm dependencies when needed. New helpers go in `flake.nix` too, not in README instructions or ad hoc scripts.
- The dev server runs on `localhost`, a different browser origin from the deployed app, so its local data is separate from real data. Never point a dev build at the owner's real data repo; use a throwaway test repo.

**Done means:** `check` passes (Biome lint and format check, `tsc` type check, every test) and `build` succeeds. Run `fmt` to fix formatting. CI runs the same two helpers before deploying. For UI changes, say what to check in `dev` at desktop and phone width; don't claim you verified it.

## Architecture rules

`src/ui` → `src/core` → nothing. `src/platform` wraps browser APIs and is handed to `core` by `src/main.js`.

- `core`: pure. No DOM, no `window`, no `localStorage`/`indexedDB`, no global `fetch`, no `Date.now()` except through a `now` it is given. Everything it needs comes in as parameters, so it runs under `node --test`.
- `core/report`: transactions + chart definition in, plain objects out. Knows nothing about ECharts.
- `platform`: thin wrappers around IndexedDB, WebCrypto and `fetch`. No business logic.
- `ui`: renders only. No aggregation or money math; `core` hands it formatted text and chart-ready series.

## Data rules

The format is in README → *Data format*. These are the invariants:

- **Money is a `BigInt` of minor units**, created only by `core/money.js` from decimal strings using the project's decimal places. Never `Number`, `parseFloat`, `parseInt`, `toFixed` or `Math.*` on amounts, in any module. Amounts travel in records as strings and to the UI as `{text, size, negative}` from `report/amount.js`; `size` is the one `Number` conversion, used only to draw bars and cells.
- **Never use `Date` to bucket rows.** A row's date, hour and weekday come from its stored string (`2026-11-14T09:30:00+05:30` → date `2026-11-14`, hour 9), via `core/time.js`. Weekday comes from calendar math on the date. `Date` is only for "now" (passed into `core`) and for comparing two instants.
- **Time** is RFC 3339 with offset, or a date alone meaning "time unknown". Never invent a time: a date-only row stays date-only, never midnight.
- **One currency per project**, fixed at creation and stored in `vault.json`'s encrypted `meta`. No conversion.
- **Local first:** every change is applied to local state and queued in the outbox before any network call. Offline or failed syncs never block the app or lose data.
- **Sync log is append-only:** a device writes only under `devices/<its id>/`, never edits or deletes a log file, and treats "already exists" on its own path as success. `vault.json` is the only file ever overwritten.
- **Merge** is per field: a change carries only the fields it sets (edits write only what changed), and for each `(kind, id, field)` the highest HLC clock wins, device id breaking ties. Deletes are tombstones that follow the same rule. Applying the same change twice changes nothing. Records refer to each other by id, never by name.
- **Encryption:** every log file is AES-256-GCM with a random nonce and its repo path as additional data. The data key never leaves WebCrypto unwrapped; the passphrase is never stored.
- **Malformed changes** never block the rest and are never dropped: keep them in the log, leave them out of state, list them in the UI.
- **Network:** only the configured sync host, listed in `src/sync-hosts.json` and the CSP. Tests never hit the network; pass a fake `fetch`.

## Code style

- Plain JavaScript ES modules. No framework and no TypeScript files; types are JSDoc comments, checked by `tsc --checkJs`. Shared shapes live in `src/core/types.js`; annotate exported `core` functions with them. Formatting is whatever Biome prints.
- Small functions, focused files. Errors are thrown as `Error` with a clear message; `core` never swallows them.
- **Readable code over comments.** Make the code explain itself with clear names, small functions, and plain control flow. Comment only when something can't be made obvious in code (a workaround, a browser quirk, a non-obvious *why*), in one short plain sentence. No comments that restate the code, no per-line narration, no banner or section comments. Keep JSDoc on exported functions to one line, and only where the name isn't enough.
- Markdown files: no emoji. Diagrams are Mermaid code blocks (` ```mermaid `), never ASCII or box-drawing art.
- Table-driven tests with `node:test`, next to the module (`*.test.js`); fixtures in `testdata/` next to the tests. `src/architecture.test.js` checks the architecture and money rules against the source; extend it when you add a rule here.
- One renderer per chart type in `src/ui/charts.js`; a chart drawn with ECharts has one option-builder. Lists, bars, the calendar and proportion bars are plain HTML styled by the tokens.
- Light and dark follow the OS (`prefers-color-scheme`), charts included. No theme toggle.
- **One UI for phone and desktop**, the same controls everywhere, adapted by CSS, never two versions of a screen:
  - The nav is a top bar on wide screens and a floating capsule tab bar at the bottom below 700px; the one Add button sits in the top bar or floats above the tab bar.
  - Dialogs are centred on wide screens and bottom sheets on phones; their footer buttons stay in view.
  - A list item is one button that opens it; actions on it live in its dialog, not as small buttons on the row.
  - Touch screens (`pointer: coarse`) get targets of at least 36–40px and 16px input text; hover effects only under `hover: hover`.
  - Wide content (pills, presets, filters, heatmaps) scrolls sideways on phones rather than wrapping into tall stacks.
  - It works from 360px wide up.
- In the UI, add children with `el(...)` or `fill(...)`, which skip `null`; `append`/`replaceChildren` print `null` as text. `field()` labels a single input; for a group of buttons or pickers it makes a named group, not a `<label>`.
- UI shape is one system, defined by the tokens at the top of `src/ui/style.css`: spacing from the `--s-*` scale, control heights from `--h-sm`/`--h-md`/`--h-lg`. Buttons, pills, chips, selects and the phone tab bar are capsules; text fields use `--r-inner`; containers use only `--r-inner`, `--r-card` and `--r-float`, rounder as they get bigger; data marks (chart bars, calendar cells) use `--r-mark`. A selected control has one look: `button.active`, a tinted fill with accent text. Cards are solid with a hairline edge, a lit top edge and a faint shadow, over a soft fixed colour field behind the page. Glass, translucent over `--glass-blur`, is only for layers that float over the page: the top bar, sticky ledger day headers, the phone tab bar, dialogs, popovers and notices; they are solid when the OS asks for reduced transparency. Don't add one-off radii, spacing or colours.
- Motion uses the `--t-fast`/`--t-base`/`--ease` and `--t-spring`/`--spring` tokens (springs for things that arrive or move: opening dialogs, the sliding pill highlight, press release), animates only opacity, transform, colour and the pill highlight's size, and lives under `prefers-reduced-motion: no-preference` (charts check it too). Icons are Fingeist's own line icons in `src/ui/icons.js`, always next to a label or an `aria-label`.

## Adding a chart type

1. Pure aggregation in `src/core/report` + tests.
2. A case in the `run(def, data, project, scope)` dispatcher.
3. One renderer function in `src/ui/charts.js`.
4. Add it to the `CHARTS` list in `src/core/report/index.js`.

## Testing

Thorough tests are required for everything in `core`: amount parsing (0/2/3 decimals, signs, garbage, overflow, sums and grouping in form input), formatting and grouping, per-field merge (order independence, edits to different fields on two devices, overwrite notes), ids and merges (rename, redirect chains, loops, deletes), splits, refunds, people balances, budgets, repeats (month-end clamping, stable occurrence ids, two devices offline), month start days, time offsets and DST, buckets across midnight and month boundaries, date-only rows (excluded from hour charts, never given a time), transfers (excluded from income and expense, moving both balances), the account filter, HLC ordering and clock skew, merge order independence, tombstones, duplicate changes, malformed changes, outbox sealing and retry, "already exists" on push, head moved, token rejected, offline, encryption round-trip and tamper/rename detection, wrong passphrase, and every chart and view in `core/report`. The UI has one smoke test (`src/ui/ui.test.js`, happy-dom): it renders every screen and dialog with no data and with a full book, and fails on errors, thrown renders, or `null`/`undefined`/`NaN` reaching the page. Extend it when you add a screen or dialog. No browser automation.
