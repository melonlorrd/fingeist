# AGENTS.md

Rules for AI agents working on **El Costas**. For what the app is, its architecture, data format, and setup, read [`README.md`](README.md) when the task needs it.

## ⛔ Git

- **Allowed:** `git status`, `git diff`, `git log`, `git show`, `git blame`, `git branch` (list only).
- **Everything else needs the owner's explicit permission, for that action, in this conversation**: commit, push, merge, rebase, reset, restore, stash, tag, add, and creating, switching, or deleting branches. Earlier permission doesn't carry over.
- Editing files is fine on whatever branch is checked out, `main` included.
- When done: summarize what changed and why, suggest a commit message, and stop.

## Scope

Build only the current phase. If a task needs something from a later phase, ask.

| Phase | Contents |
|-------|----------|
| **MVP** ← current | One project, INR by default (currency chosen at creation). Settings page: project name, currency (shown, locked), small-purchase thresholds (default ₹100/250/500/1000), target allocation % per asset class, workdays (default Mon–Fri). Ledger with add/edit/delete, search and filters. Habit intent on expenses. Categories with colours and archiving. CSV load/save (atomic, backups, external-edit detection). Investment portfolio with price updates. Dashboard with summary cards and every chart in *Reference images*, alongside the existing three (monthly totals, by category, daily calendar heatmap). Date-range filter with presets. |
| **2** | Multiple projects: create, switch, separate dashboards. |
| **Later** | Intel macOS builds. Bank CSV import + dedupe, budgets, more chart types. Maybe mixed currencies in one project (needs historical rates). |
| **Never** | Sync, cloud, accounts, multi-user, telemetry, a database. Network calls for anything other than fetching investment prices. |

## Reference images

`reference-images/` holds screenshots of another expense app. It is temporary and untracked, and will be deleted once the UI design is set; the table below is the lasting spec, so it must stand on its own. They are the spec for **what** to build: screens, fields, metrics, charts. The owner wants the UI structure and controls to resemble them (page header cards, rounded cards, pill controls, a grouped ledger, the quick-add dialog), with navigation along the top instead of a sidebar. Keep El Costas's own palette, name, wording and icons; no emoji. Everything below is MVP. File names below are the `Pasted 2026-11-07 at …` timestamps.

| Screen | Image | Build |
|--------|-------|-------|
| Ledger | `23.42.49` | Rows grouped by day, newest first, with a total per day. Search over merchant, note, category and tags. Filters: month, category, and All / Expenses / Income / Needs / Wants / Impulses. |
| Add/edit transaction | `23.42.57`, `23.43.07` | Expense/Income toggle sets the sign; the user types a positive amount. Category picker showing each colour. Intent (Need / Want / Impulse), expenses only. Time defaults to now and is editable; clearing it means "time unknown". |
| Categories | `23.43.45` | List with colours. Add, edit, archive. Archived categories leave the picker but stay valid on existing rows. |
| Portfolio | `23.43.20`–`23.43.37` | Holdings of three asset classes: mutual fund, equity, physical gold (no gold bonds or other gold products; the images show some, ignore them): name, optional ticker/folio, units (grams for gold, fractional e.g. `684.797`), average buy price, current price (defaults to buy price), notes. Cards: net worth (portfolio value + the ledger's running balance), portfolio value, total invested, total returns (amount and %). Allocation bar per class with target % and drift. Per holding: value and gain/loss (amount and %). Filter by class. |
| Dashboard: summary | `23.43.53` | Presets: This month / 3 months / Year to date / All time. Cards: total spent, total income, net savings, average daily spend (with transaction count). Each card compares with the previous period of the same length, or says there's no previous data. |
| Dashboard: charts | `23.43.53`–`23.44.23` | Monthly income vs expense = `monthly_totals`. Category breakdown = `by_category`. Running balance: cumulative net over time, one step per day. Intent trends: spending per intent over time. Small purchases: expenses at or under a selectable threshold, with their count, total, and share of all expenses. Workday routine (Mon–Fri): spend per hour of day; picking an hour shows occurrences, share of workdays, average and total, categories, and most common merchants/notes with average and count. Weekday × hour heatmap of spend. No-spend calendar: month view marking zero-expense days, with current streak, best streak this month, and zero-expense day count (future days don't count). |

- All aggregation for these lives in `internal/report`, one dispatcher case each, per *Adding a chart type*. Percentages and comparisons are computed and formatted in Go.
- Hour-of-day charts use the wall-clock hour in the row's own offset. Rows with time unknown count in every date-based view but are left out of hour charts, which show "N transactions have no time" and let the user open them to add one.
- Unit quantities and prices are exact decimals, like money. No `float64`.
- Format amounts with the currency symbol and standard thousands grouping, for every currency, e.g. `₹883,727.29`. No lakh grouping, unlike the images.
- **New data formats need the owner's approval first:** the intent column (a schema change: new header version + migration + old-format fixture), category colours and archived status in `project.toml`, where holdings and cached prices are stored, and the new `dashboard.toml` types and options. Propose the format, get a yes, then document it in README → *Data files*.

## How to work

- **Do what was asked, nothing more.** No unrequested features, refactors, renames, or "while I'm here" cleanups. Mention them instead.
- **Smallest change that works.** No speculative interfaces, options, config knobs, or abstractions for future phases. Three similar lines beat a premature helper.
- **Don't add files** unless the task needs them. Don't create docs, scripts, or examples nobody asked for.
- **No new dependencies** without asking. Approved: Go stdlib, `BurntSushi/toml`, `oklog/ulid`, `wailsapp/wails/v3`. Frontend: `echarts`, `@wailsio/runtime`, plus what the Wails v3 vanilla template ships.
- **Ask** when a requirement is ambiguous, especially anything touching the data format or files on disk.
- **Keep docs true.** If you change architecture, the data format, commands, or the build, update `README.md` in the same task. If you change a rule, update this file. Project knowledge lives in these two files, not in agent memory.
- Don't edit generated files: `frontend/bindings/`, `frontend/dist/`, `bin/`.

## Environment

- Work inside `nix develop`. Need a tool? Add it to `flake.nix`; never install globally. Don't run `nix flake update` unless asked.
- The dev shell points `EL_COSTAS_HOME` at `data/dev/`. Don't override it.
- Targets: macOS (arm64), Windows (amd64, arm64), Linux (amd64, arm64). Every build must work from plain `nix develop`; if a target needs anything outside Nix, it waits for a later phase. Build commands are in README → *Building for daily use*.
- The dev shell builds the `wails3` CLI from source (nixpkgs only has an old v3 beta). On Linux it provides GTK 4 and WebKitGTK 6, so no build tags are needed. Windows builds need `CGO_ENABLED=0`; the dev shell sets it to 1 for macOS and Linux.
- If a build fails to link, report the error; don't work around it.

**Done means:** `gofmt -l .` prints nothing, `go vet ./...` and `go test ./...` pass. For UI changes, say what to check in `wails3 dev`; don't claim you verified it.

## Architecture rules

`app.go` → `internal/report`, `portfolio`, `prices`, `storage`, `config` → `internal/domain`. Dependencies point downward only. Only `prices` uses the network.

- `domain`: no I/O, no imports from this repo.
- `report`: pure. `[]Transaction` + chart definition in, plain structs out. Knows nothing about ECharts.
- `app.go`: thin wrappers; no business logic.
- Frontend: renders only. No aggregation or money math in JS; Go sends amounts pre-formatted.

## Data rules

The full format is in README → *Data files*. These are the invariants:

- **Network** is used only to fetch investment prices, with a timeout. Offline or failed fetches never block the app or lose data: show the last known price with its as-of time and mark it out of date. Price sources: mutual funds from AMFI's daily `NAVAll.txt`; stocks and ETFs from Yahoo Finance's chart endpoint (unofficial, may break); physical gold entered by hand. Any holding's price can be set by hand. Ask before adding another source. Tests never hit the real network; use `httptest`.
- **Never read, write, or delete the real config or data folders** (README → *Where files live*). Use `t.TempDir()`, `data/sample/`, or `data/dev/`.
- **Folders** are resolved in one place, `internal/config`: `EL_COSTAS_HOME` if set; otherwise XDG on Linux (`$XDG_CONFIG_HOME`/`$XDG_DATA_HOME` with `~/.config` / `~/.local/share` defaults) and `os.UserConfigDir()` on macOS and Windows. Pass the env lookup in as a parameter so it's testable.
- **Money** is `domain.Money` (int64 minor units). Parse the CSV's decimal `amount` exactly, using the project currency's decimal places. **No `float64` for money**, in Go or JS.
- **One currency per project**, fixed at creation. No currency column, no conversion.
- **Time** is RFC 3339 with offset, or a date alone meaning "time unknown". Never invent a time: a date-only row stays date-only on save, never midnight. Bucket by the wall-clock date in the row's own offset; never call `.Local()` or `.In()` before bucketing.
- **Atomic save:** temp file in the same dir → `fsync` → `os.Rename` → `fsync` the dir (skip that last step on Windows, where it isn't supported). On Windows, rename fails if another program (e.g. Excel) holds the file open: report it to the user and keep the in-memory changes, never lose them.
- **Cross-platform files:** build paths only with `filepath`. Write UTF-8 with LF; accept CRLF and a UTF-8 BOM on read.
- **Backup before saving** into `backups/`: at most one per file every 10 minutes (so a burst of edits doesn't push out older backups), keeping the newest 20.
- **External edits:** hash the file at load and re-check before each save and on window focus. If it changed: don't save, reload, tell the user.
- **Malformed rows** never block loading the rest and are never dropped: report them with line numbers and refuse to save until they're fixed.
- **Schema changes** need a new header version, a migration in `internal/storage`, and an old-format fixture test.

## Code style

- Standard Go: `gofmt`, idiomatic names, errors wrapped with `%w`, no panics in library code.
- Small functions, focused files.
- **Readable code over comments.** Make the code explain itself with clear names, small functions, and plain control flow. Comment only when something can't be made obvious in code (a workaround, an OS quirk, a non-obvious *why*), in one short plain sentence. No comments that restate the code, no per-line narration, no banner or section comments, and no doc comments on unexported functions. Keep doc comments on exported identifiers to one line.
- Table-driven tests; fixtures in `testdata/` next to the package.
- Frontend: vanilla JS modules, no framework, one ECharts option-builder per chart type.
- Light and dark follow the OS (`prefers-color-scheme`), charts included. No theme toggle.
- UI shape is one system, defined by the tokens at the top of `frontend/src/style.css`: every interactive control is a capsule; containers use only `--r-inner`, `--r-card` and `--r-float`; floating layers (dialogs, popovers) are solid with a hairline edge and a soft shadow. No blur or translucency. Don't add one-off radii or colours.

## Adding a chart type

1. Pure aggregation in `internal/report` + tests.
2. A case in the `report.Run(def, txns, project, scope)` dispatcher.
3. One renderer function in the frontend.
4. An example in `data/sample/projects/*/dashboard.toml`.

## Testing

Thorough tests are required for `report`, `storage`, and folder resolution in `config` (each OS's rules, with and without XDG vars and `EL_COSTAS_HOME`): amount parsing (0/2/3 decimals, signs, garbage), time offsets and DST, buckets across midnight and month boundaries, date-only rows (round-trip unchanged, excluded from hour charts), unit quantities with 3+ decimals, intent migration from the old header, price fetch failure and offline, empty and header-only CSV, CRLF and BOM input, malformed rows, blank ids, unknown categories, atomic-write failures, backup rotation, external-change detection. No heavy frontend test tooling.
