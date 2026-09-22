import type { database } from 'wx-server-sdk'

// wx-server-sdk 4.0.2 implements this option but omits it from IDatabaseConfig.
// Keep the verified runtime behavior explicit without weakening the SDK types.
export const CLOUD_DATABASE_OPTIONS: NonNullable<Parameters<typeof database>[0]> & { throwOnNotFound: false } = { throwOnNotFound: false }

export type Row = Record<string, unknown>
type SdkResult = Promise<unknown> | string | void
interface RawDocument {
  get(): SdkResult
  set(options: { data: Row }): SdkResult
  update(options: { data: Row }): SdkResult
  remove(): SdkResult
}
interface RawQuery {
  where(condition: object): RawQuery
  orderBy(field: string, direction: 'asc' | 'desc'): RawQuery
  limit(take: number): RawQuery
  field(fields: Record<string, boolean>): RawQuery
  get(): SdkResult
  count(): SdkResult
  update(options: { data: Row }): SdkResult
}
interface RawCollection extends RawQuery { doc(id: string): RawDocument }
interface Commands {
  and(conditions: object[]): object
  or(conditions: object[]): object
  lt(value: number | string | Date): object
  lte(value: number): object
  gt(value: number | string | Date): object
  neq(value: string | boolean): object
  in(values: string[]): object
  inc(value: number): object
  exists(value: boolean): object
}
interface RawTransaction { collection(name: string): Pick<RawCollection, 'doc'> }
interface RawDatabase {
  collection(name: string): RawCollection
  command: Commands
  serverDate(): unknown
  RegExp(options: { regexp: string; options: string }): object
  runTransaction<T>(work: (transaction: RawTransaction) => Promise<T>): Promise<T>
}
type Compatible<T extends RawDatabase> = T
export type CloudSdkCompatibility = Compatible<ReturnType<typeof database>>

export function record(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid database record')
  return value as Row
}
export function text(value: unknown): string {
  if (typeof value !== 'string' || !value) throw Error('Invalid stored text')
  return value
}
function document(raw: RawDocument) {
  return {
    async get(): Promise<{ data: Row | null }> {
      const value = record(await raw.get()).data
      return { data: value === null ? null : record(value) }
    },
    async set(options: { data: Row }): Promise<void> { await raw.set(options) },
    async update(options: { data: Row }): Promise<void> { await raw.update(options) },
    async remove(): Promise<void> { await raw.remove() },
  }
}
interface Query {
  where(condition: object): Query
  orderBy(field: string, direction: 'asc' | 'desc'): Query
  limit(take: number): Query
  field(fields: Record<string, boolean>): Query
  get(): Promise<{ data: Row[] }>
  count(): Promise<{ total: number }>
  update(options: { data: Row }): Promise<void>
}
function query(raw: RawQuery): Query {
  return {
    where: condition => query(raw.where(condition)),
    orderBy: (field, direction) => query(raw.orderBy(field, direction)),
    limit: take => query(raw.limit(take)),
    field: fields => query(raw.field(fields)),
    async get() {
      const data = record(await raw.get()).data
      if (!Array.isArray(data)) throw Error('Invalid database query response')
      return { data: data.map(record) }
    },
    async count() {
      const total = record(await raw.count()).total
      if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) throw Error('Invalid database count')
      return { total }
    },
    async update(options) { await raw.update(options) },
  }
}
export interface CloudTransaction { collection(name: string): { doc(id: string): ReturnType<typeof document> } }

/** Validate SDK response envelopes here; use cases validate each collection's records. */
export function connectDatabase(raw: RawDatabase) {
  return {
    command: raw.command,
    serverDate: () => raw.serverDate(),
    RegExp: (options: { regexp: string; options: string }) => raw.RegExp(options),
    collection(name: string) {
      const collection = raw.collection(name)
      return { ...query(collection), doc: (id: string) => document(collection.doc(id)) }
    },
    runTransaction<T>(work: (transaction: CloudTransaction) => Promise<T>): Promise<T> {
      return raw.runTransaction(transaction => work({ collection: name => ({ doc: id => document(transaction.collection(name).doc(id)) }) }))
    },
  }
}
export type CloudDatabase = ReturnType<typeof connectDatabase>
