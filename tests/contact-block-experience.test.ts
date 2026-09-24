import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { createHash } from 'node:crypto'

type Row = Record<string, unknown>
const hash = (...parts: string[]) => createHash('sha256').update(parts.join('\0')).digest('hex')
const requireDependency = createRequire(path.join(process.cwd(), 'package.json'))
function fixture() {
  const tables = new Map<string, Map<string, Row>>()
  let owner = 'alice-user'
  function rows(name: string) { let table = tables.get(name); if (!table) { table = new Map(); tables.set(name, table) }; return table }
  function match(item: Row, condition: Row) {
    return Object.entries(condition).every(([key, value]) => {
      if (value && typeof value === 'object') {
        if ('lt' in value) return String(item[key]) < String(value.lt)
        if ('in' in value && Array.isArray(value.in)) return value.in.includes(item[key])
      }
      return item[key] === value
    })
  }
  function collection(name: string) {
    const table = rows(name)
    let condition: Row = {}, limit = 1000
    return {
      doc: (id: string) => ({ get: async () => ({ data: table.get(id) || null }),
        set: async ({ data }: { data: Row }) => { table.set(id, { ...data, _id: id }) },
        update: async ({ data }: { data: Row }) => { const old = table.get(id); if (!old) throw Error('Missing document'); table.set(id, { ...old, ...data }) },
      }),
      where(value: Row) { condition = value; return this }, orderBy() { return this }, field() { return this },
      limit(value: number) { limit = value; return this },
      async get() { return { data: [...table.values()].filter(item => match(item, condition)).sort((a, b) => String(b._id).localeCompare(String(a._id))).slice(0, limit) } },
    }
  }
  const db = { collection, command: { lt: (value: unknown) => ({ lt: value }), in: (value: unknown) => ({ in: value }) },
    runTransaction: async <T>(work: (transaction: { collection: typeof collection }) => Promise<T>) => work({ collection }) }
  const module: { exports: { main?: (input: Row) => Promise<{ data?: Row; code?: string }> } } = { exports: {} }
  const cloud = { init: () => {}, database: () => db, openapi: { security: { msgSecCheck: async () => ({}) } } }
  const code = ts.transpileModule(readFileSync('apps/cloudfunctions/messages/index.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, console,
    require: (specifier: string) => {
      if (specifier === 'wx-server-sdk') return cloud
      if (specifier === '../common/database') return requireDependency(path.resolve('apps/cloudfunctions/common/database.ts'))
      if (specifier === '../common') return {
        stableDocumentId: hash, ok: (data: unknown) => ({ data }), fail: (_message: string, code: string) => ({ code }),
        authorizeAction: async () => ({ allowed: true }),
        withAuth: (_cloud: unknown, handler: (openid: string, event: Row) => Promise<unknown>) => (input: Row) => handler(owner, input),
      }
      return requireDependency(specifier)
    },
  })
  return { rows, setOwner: (value: string) => { owner = value }, main: module.exports.main! }
}

test('block operations survive reentry, stay channel scoped, and can be undone only by their owner', async () => {
  const f = fixture(), owner = 'alice-user', peer = 'secret-peer'
  const threads = ['a'.repeat(64), 'b'.repeat(64)]
  for (const thread of threads) {
    const conversation = hash('conversation', 'anonymous', thread)
    const id = hash('conversation_entry', owner, conversation)
    f.rows('conversation_entries').set(id, { _id: id, owner_openid: owner, peer_openid: peer, conversation_id: conversation,
      anonymous_context: { protocol_version: 3, source_type: 'post', source_id: 'source', initiator_openid: owner, target_openid: peer,
        thread_id: thread, initiator_visibility: 'real', target_visibility: 'anonymous' } })
  }
  const request = (action: string, index = 0) => ({ action, anonymous_target: { anonymous: true, thread_id: threads[index] } })
  assert.equal((await f.main(request('blockContact'))).data?.blocked, true)
  assert.equal((await f.main(request('getConversationDisplay'))).data?.blockedHere, true)
  assert.equal((await f.main(request('getConversationDisplay', 1))).data?.blockedHere, false)
  const first = (await f.main({ action: 'listContactBlocks' })).data!
  assert.equal(JSON.stringify(first).includes(peer), false)
  assert.equal(JSON.stringify(first).includes(hash('messaging:block', ...[owner, peer].sort())), false)
  const operation = (first.items as { id: string }[])[0]!
  f.setOwner('foreign-owner')
  assert.equal((await f.main({ action: 'unblockContact', operation_id: operation.id })).code, 'NOT_FOUND')
  f.setOwner(owner)
  await f.main(request('blockContact', 1))
  assert.equal((await f.main({ action: 'unblockContact', operation_id: operation.id })).data?.blocked, false)
  assert.equal((await f.main(request('getConversationDisplay'))).data?.blockedHere, false)
  assert.equal((await f.main(request('getConversationDisplay', 1))).data?.blockedHere, true)
  assert.deepEqual(Array.from(Array.from(f.rows('messaging_blocks').values())[0]?.blockedBy as string[]), [owner])
  await f.main(request('unblockContact', 1))
  assert.equal((Array.from(f.rows('messaging_blocks').values())[0]?.blockedBy as string[]).length, 0)
  assert.equal(((await f.main({ action: 'listContactBlocks' })).data?.items as unknown[]).length, 0)
})

test('block records paginate by opaque operation id without leaking the private block key', async () => {
  const f = fixture()
  for (let index = 0; index < 25; index++) {
    const id = hash('operation', String(index))
    f.rows('messaging_block_operations').set(id, { _id: id, owner: 'alice-user', label: '匿名会话', active: true, blockId: 'private-pair' })
  }
  const first = (await f.main({ action: 'listContactBlocks' })).data!
  const second = (await f.main({ action: 'listContactBlocks', cursor: first.nextCursor })).data!
  assert.equal((first.items as unknown[]).length, 20)
  assert.equal((second.items as unknown[]).length, 5)
  assert.equal(second.nextCursor, null)
  assert.equal(JSON.stringify([first, second]).includes('private-pair'), false)
})
