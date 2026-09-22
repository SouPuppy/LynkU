type Row = Record<string, unknown>
export type AgreementKey = 'terms' | 'rules'
export interface AgreementDocument { version: string; hash: string; status: 'draft' | 'active'; effectiveAt: string | null }
export type AgreementDocuments = Record<AgreementKey, AgreementDocument>
export class AgreementFailure extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'AGREEMENT_NOT_READY' | 'AGREEMENT_CHANGED' | 'AUTH_UNAVAILABLE' | 'ACCOUNT_CLOSED') { super(code) }
}
export interface AgreementStore {
  now(): string
  identifier(...parts: string[]): string
  run<T>(work: (tx: {
    lifecycle(accountId: string): Promise<unknown>
    assent(id: string): Promise<unknown | null>
    put(id: string, data: Row): Promise<void>
    touchLifecycle(id: string, writeFence: number): Promise<void>
  }) => Promise<T>): Promise<T>
}
function record(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AgreementFailure('INVALID_INPUT')
  return value as Row
}
/** Agreement assent is separate from privacy purposes and never upgrades school verification. */
export async function acceptAgreement(store: AgreementStore, documents: AgreementDocuments, accountId: string, value: unknown) {
  const input = record(value)
  if (Object.keys(input).some(key => !['action', 'requestId', 'accepted', 'documentVersions'].includes(key))
    || input.accepted !== true || typeof input.requestId !== 'string'
    || !/^[a-zA-Z0-9-]{16,128}$/.test(input.requestId)) throw new AgreementFailure('INVALID_INPUT')
  const versions = record(input.documentVersions)
  if (Object.keys(versions).length !== 2) throw new AgreementFailure('INVALID_INPUT')
  const acceptedAt = store.now()
  if (!Number.isFinite(Date.parse(acceptedAt))) throw new AgreementFailure('AUTH_UNAVAILABLE')
  const keys: AgreementKey[] = ['terms', 'rules']
  for (const key of keys) {
    const doc = documents[key]
    if (doc.status !== 'active' || !doc.effectiveAt || !Number.isFinite(Date.parse(doc.effectiveAt))
      || Date.parse(doc.effectiveAt) > Date.parse(acceptedAt)) throw new AgreementFailure('AGREEMENT_NOT_READY')
    const sent = record(versions[key])
    if (Object.keys(sent).length !== 2 || sent.version !== doc.version || sent.hash !== doc.hash) throw new AgreementFailure('AGREEMENT_CHANGED')
  }
  return store.run(async tx => {
    const lifecycle = record(await tx.lifecycle(accountId))
    if (typeof lifecycle._id !== 'string' || typeof lifecycle.writeFence !== 'number' || !Number.isSafeInteger(lifecycle.writeFence)
      || lifecycle.writeFence < 0 || lifecycle.writeFence >= Number.MAX_SAFE_INTEGER
      || lifecycle.currentAccountId !== accountId || typeof lifecycle.epoch !== 'number'
      || !Number.isSafeInteger(lifecycle.epoch) || lifecycle.epoch < 1) throw new AgreementFailure('AUTH_UNAVAILABLE')
    if (lifecycle.state !== 'active') throw new AgreementFailure('ACCOUNT_CLOSED')
    const ids = keys.map(key => store.identifier('agreement', accountId, String(lifecycle.epoch), input.requestId as string, key))
    const existing = await Promise.all(ids.map(id => tx.assent(id)))
    const receipts: Array<{ documentKey: AgreementKey; version: string; hash: string; acceptedAt: string }> = []
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!, doc = documents[key]
      const prior = existing[i]
      if (prior !== null) {
        const row = record(prior)
        if (row.accountId !== accountId || row.epoch !== lifecycle.epoch || row.documentKey !== key
          || row.version !== doc.version || row.hash !== doc.hash || typeof row.acceptedAt !== 'string') throw new AgreementFailure('AGREEMENT_CHANGED')
        receipts.push({ documentKey: key, version: doc.version, hash: doc.hash, acceptedAt: row.acceptedAt })
      } else {
        receipts.push({ documentKey: key, version: doc.version, hash: doc.hash, acceptedAt })
      }
    }
    await tx.touchLifecycle(lifecycle._id, lifecycle.writeFence + 1)
    for (let i = 0; i < keys.length; i++) if (existing[i] === null) {
      await tx.put(ids[i]!, { ...receipts[i]!, accountId, epoch: lifecycle.epoch, operationId: input.requestId })
    }
    return { accepted: true as const, documents: receipts }
  })
}
