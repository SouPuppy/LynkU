import type { database } from 'wx-server-sdk'

type Collection = 'posts' | 'comments' | 'users' | 'messages' | 'conversation_entries'
  | 'conversation_counters' | 'notifications' | 'messaging_blocks'
type SdkResult = Promise<unknown> | string | void

/** Only the SDK operations used by messaging; all response data remains untrusted. */
export interface MessagingDocument {
  get(): SdkResult
  set(options: { data: Record<string, unknown> }): SdkResult
  update(options: { data: Record<string, unknown> }): SdkResult
}

export interface MessagingQuery {
  where(condition: object): MessagingQuery
  orderBy(field: string, direction: 'asc' | 'desc'): MessagingQuery
  limit(take: number): MessagingQuery
  field(fields: Record<string, boolean>): MessagingQuery
  get(): SdkResult
  count(): SdkResult
  update(options: { data: Record<string, unknown> }): SdkResult
}

export interface MessagingCollection extends MessagingQuery {
  doc(id: string): MessagingDocument
}

export interface MessagingCommands {
  and(conditions: object[]): object
  or(conditions: object[]): object
  lt(value: number | string | Date): object
  gt(value: number): object
  neq(value: string): object
  in(values: string[]): object
}

export interface MessagingTransaction {
  collection(name: Collection): Pick<MessagingCollection, 'doc'>
}

export interface MessagingDatabase {
  collection(name: Collection): MessagingCollection
  command: MessagingCommands
  serverDate(): unknown
  runTransaction<T>(operation: (transaction: MessagingTransaction) => Promise<T>): Promise<T>
}

// wx-server-sdk's transaction declaration is untyped. Keep that declaration out
// of the adapter while checking the narrow facade remains assignable from the SDK.
type CompatibleDatabase<T extends MessagingDatabase> = T
export type MessagingSdkCompatibility = CompatibleDatabase<ReturnType<typeof database>>

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid CloudBase response')
  return value as Record<string, unknown>
}

export function documentData(value: unknown): unknown | null {
  const data = record(value).data
  if (data === null) return null
  return record(data)
}

export function queryData(value: unknown): unknown[] {
  const data: unknown = record(value).data
  if (!Array.isArray(data)) throw new Error('Invalid CloudBase query response')
  return data
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid CloudBase count')
  return value
}

export function queryCount(value: unknown): number {
  return count(record(value).total)
}

export function updatedCount(value: unknown): number {
  return count(record(record(value).stats).updated)
}
