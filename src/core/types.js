// Shapes shared across core, as JSDoc types for the type checker. This file has no code.

/**
 * @typedef {'txn' | 'transfer' | 'category' | 'account' | 'budget' | 'recurring' | 'setting' | 'device'} Kind
 *
 * One line of a log file: a put sets some fields; a delete is a tombstone.
 * @typedef {{kind: Kind, id: string, op: 'put' | 'delete', clock: string, device: string, fields?: Record<string, unknown>}} Change
 *
 * A field value and the stamp of the change that set it.
 * @typedef {{value: unknown, clock: string, device: string}} Stamped
 *
 * Everything known about one record, merged.
 * @typedef {{kind: Kind, id: string, fields: Record<string, Stamped>, tomb: {clock: string, device: string} | null}} Entry
 *
 * @typedef {Record<string, Entry>} Winners
 *
 * A stored time split into its wall-clock parts.
 * @typedef {{time: string, date: string, hour: number | null, minute: number | null, unknown: boolean, instant: number | null}} When
 *
 * @typedef {'expense' | 'refund' | 'income' | 'lent'} LineKind
 * @typedef {{amount: bigint, kind: LineKind, person: string, category: string, intent: string, item: string, spend: bigint}} Line
 * A split part, or a line of an itemised bill; a negative amount is a discount, and an empty intent means the transaction's.
 * @typedef {{category: string, person: string, amount: bigint, intent: string, note: string}} SplitPart
 *
 * @typedef {When & {id: string, amount: bigint, refund: boolean, splits: SplitPart[], account: string, category: string,
 *   merchant: string, note: string, tags: string[], intent: string, recurring: string, lines: Line[]}} Txn
 * @typedef {When & {id: string, amount: bigint, from: string, to: string, note: string, recurring: string}} Transfer
 *
 * @typedef {{id: string, name: string, color: string, archived: boolean, mergedInto: string}} Category
 * @typedef {{id: string, kind: 'own' | 'person', name: string, opening: bigint, archived: boolean, mergedInto: string}} Account
 * @typedef {{category: string, amount: bigint}} Budget
 * @typedef {{id: string, entry: 'txn' | 'transfer', template: Record<string, unknown>, every: 'day' | 'week' | 'month' | 'year',
 *   start: string, until: string, paused: boolean}} Repeat
 *
 * @typedef {{name: string, currency: string, decimals: number, created?: string}} Meta
 * @typedef {{name: string, currency: string, decimals: number, thresholds: bigint[], workdays: number[], monthStart: number,
 *   categories: Category[], accounts: Account[], categoryById: Map<string, Category>, accountById: Map<string, Account>}} Project
 * @typedef {{kind: string, id: string, device: string, message: string}} Problem
 * @typedef {{project: Project, txns: Txn[], transfers: Transfer[], budgets: Budget[], recurring: Repeat[],
 *   devices: Record<string, string>, problems: Problem[]}} Book
 *
 * A money value for the screen: text to show, size only for drawing.
 * @typedef {{minor: bigint, text: string, size: number, negative: boolean}} Amount
 *
 * @typedef {{from: string, to: string, today: string, account: string}} Scope
 *
 * The async key-value store the app keeps its data in.
 * @typedef {{load(): Promise<Record<string, any>>, save(entries: Record<string, unknown>): Promise<void>, clear(): Promise<void>}} Store
 *
 * @typedef {{path: string, blobId: string}} RemoteEntry
 * @typedef {{check(): Promise<void>, head(): Promise<string | null>, list(head: string): Promise<RemoteEntry[]>,
 *   read(entry: RemoteEntry): Promise<Uint8Array>, create(path: string, bytes: Uint8Array): Promise<void>,
 *   readVault(): Promise<string | null>, writeVault(text: string): Promise<void>}} Remote
 */

export {};
