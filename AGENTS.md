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
| **MVP** ← current | One project. Add/edit/delete transactions in the UI. CSV load/save (atomic, backups, external-edit detection). `dashboard.toml` with three chart types: monthly totals (bar), by category, daily calendar heatmap. Date-range filter. |
| **2** | Multiple projects: create, switch, separate dashboards. |
| **Later** | Intel macOS builds. Bank CSV import + dedupe, budgets, tag filters, more chart types. Maybe mixed currencies in one project (needs historical rates). |
| **Never** | Sync, cloud, accounts, multi-user, telemetry, network calls, a database. |

## How to work

- **Do what was asked, nothing more.** No unrequested features, refactors, renames, or "while I'm here" cleanups. Mention them instead.
- **Smallest change that works.** No speculative interfaces, options, config knobs, or abstractions for future phases. Three similar lines beat a premature helper.
- **Don't add files** unless the task needs them. Don't create docs, scripts, or examples nobody asked for.
- **No new dependencies** without asking. Approved: Go stdlib, `BurntSushi/toml`, `oklog/ulid`, `wailsapp/wails/v2`. Frontend: `echarts`, plus what the Wails vanilla template ships.
- **Ask** when a requirement is ambiguous, especially anything touching the data format or files on disk.
- **Keep docs true.** If you change architecture, the data format, commands, or the build, update `README.md` in the same task. If you change a rule, update this file. Project knowledge lives in these two files, not in agent memory.
- Don't edit generated files: `frontend/wailsjs/`, `frontend/dist/`, `build/bin/`.

## Environment

- Work inside `nix develop`. Need a tool? Add it to `flake.nix`; never install globally. Don't run `nix flake update` unless asked.
- The dev shell points `EL_COSTAS_HOME` at `data/dev/`. Don't override it.
- Targets: macOS (arm64), Windows (amd64, arm64), Linux (amd64, arm64). Every build must work from plain `nix develop`; if a target needs anything outside Nix, it waits for a later phase. Build commands are in README → *Building for daily use*.
- On Linux, pass `-tags webkit2_41` to `wails dev` and `wails build`.
- If a build fails to link, report the error; don't work around it.

**Done means:** `gofmt -l .` prints nothing, `go vet ./...` and `go test ./...` pass. For UI changes, say what to check in `wails dev`; don't claim you verified it.

## Architecture rules

`app.go` → `internal/report`, `storage`, `config` → `internal/domain`. Dependencies point downward only.

- `domain`: no I/O, no imports from this repo.
- `report`: pure. `[]Transaction` + chart definition in, plain structs out. Knows nothing about ECharts.
- `app.go`: thin wrappers; no business logic.
- Frontend: renders only. No aggregation or money math in JS; Go sends amounts pre-formatted.

## Data rules

The full format is in README → *Data files*. These are the invariants:

- **Never read, write, or delete the real config or data folders** (README → *Where files live*). Use `t.TempDir()`, `data/sample/`, or `data/dev/`.
- **Folders** are resolved in one place, `internal/config`: `EL_COSTAS_HOME` if set; otherwise XDG on Linux (`$XDG_CONFIG_HOME`/`$XDG_DATA_HOME` with `~/.config` / `~/.local/share` defaults) and `os.UserConfigDir()` on macOS and Windows. Pass the env lookup in as a parameter so it's testable.
- **Money** is `domain.Money` (int64 minor units). Parse the CSV's decimal `amount` exactly, using the project currency's decimal places. **No `float64` for money**, in Go or JS.
- **One currency per project**, fixed at creation. No currency column, no conversion.
- **Time** is RFC 3339 with offset. Bucket by the wall-clock date in the row's own offset; never call `.Local()` or `.In()` before bucketing.
- **Atomic save:** temp file in the same dir → `fsync` → `os.Rename` → `fsync` the dir (skip that last step on Windows, where it isn't supported). On Windows, rename fails if another program (e.g. Excel) holds the file open: report it to the user and keep the in-memory changes, never lose them.
- **Cross-platform files:** build paths only with `filepath`. Write UTF-8 with LF; accept CRLF and a UTF-8 BOM on read.
- **Backup before every save** into `backups/`, keeping the newest 20.
- **External edits:** hash the file at load and re-check before each save and on window focus. If it changed: don't save, reload, tell the user.
- **Malformed rows** never block loading the rest and are never dropped: report them with line numbers and refuse to save until they're fixed.
- **Schema changes** need a new header version, a migration in `internal/storage`, and an old-format fixture test.

## Code style

- Standard Go: `gofmt`, idiomatic names, errors wrapped with `%w`, no panics in library code.
- Small functions, focused files.
- **Readable code over comments.** Make the code explain itself with clear names, small functions, and plain control flow. Comment only when something can't be made obvious in code (a workaround, an OS quirk, a non-obvious *why*), in one short plain sentence. No comments that restate the code, no per-line narration, no banner or section comments, and no doc comments on unexported functions. Keep doc comments on exported identifiers to one line.
- Table-driven tests; fixtures in `testdata/` next to the package.
- Frontend: vanilla JS modules, no framework, one ECharts option-builder per chart type.

## Adding a chart type

1. Pure aggregation in `internal/report` + tests.
2. A case in the `report.Run(chartDef, txns)` dispatcher.
3. One renderer function in the frontend.
4. An example in `data/sample/*/dashboard.toml`.

## Testing

Thorough tests are required for `report`, `storage`, and folder resolution in `config` (each OS's rules, with and without XDG vars and `EL_COSTAS_HOME`): amount parsing (0/2/3 decimals, signs, garbage), time offsets and DST, buckets across midnight and month boundaries, date-only input, empty and header-only CSV, CRLF and BOM input, malformed rows, blank ids, unknown categories, atomic-write failures, backup rotation, external-change detection. No heavy frontend test tooling.
