// Explicit maintenance-window migration. Default is read-only; never called by application reads.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import path from 'node:path'

type Row = Record<string, unknown>
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid migration data')
  return value as Row
}
const root = process.cwd()
const config = row(JSON.parse(readFileSync(path.join(root, 'config/project.json'), 'utf8')))
const argument = (name: string) => process.argv[process.argv.indexOf(name) + 1]
const apply = process.argv.includes('--apply')
const blocks = process.argv.includes('--blocks')
const collection = blocks ? 'messaging_blocks' : 'notifications'
if (!process.argv.includes('--environment') || argument('--environment') !== config.cloudEnvironment) throw Error('Explicit current --environment is required')
const hash = (...parts: string[]) => createHash('sha256').update(parts.join('\0')).digest('hex')
function version(value: unknown): number {
  let parsed = value
  if (value && typeof value === 'object') {
    const input = row(value)
    const encoded = input.$numberInt ?? input.$numberLong
    if (typeof encoded === 'string') parsed = Number(encoded)
  }
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0 || parsed >= Number.MAX_SAFE_INTEGER) throw Error('Invalid block version')
  return parsed
}

function execute(command: Row, type = 'QUERY', table = collection): unknown {
  const payload = JSON.stringify([{ TableName: table, CommandType: type, Command: JSON.stringify(command) }])
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/@cloudbase/cli/bin/tcb'), 'db', 'nosql', 'execute',
    '-e', String(config.cloudEnvironment), '--command', payload, '--json'], { cwd: root, encoding: 'utf8' })
  if (result.error || result.status !== 0) throw Error('Database command failed; no raw private output is printed')
  const envelope = row(JSON.parse(result.stdout)), data = row(envelope.data)
  if (!Array.isArray(data.results) || data.results.length !== 1) throw Error('Invalid database response')
  return data.results[0]
}
function query(filter: Row, limit = 100, table = collection): Row[] {
  const values = execute({ find: table, filter, sort: { _id: 1 }, limit }, 'QUERY', table)
  if (!Array.isArray(values)) throw Error('Invalid notification query')
  return values.map(row)
}
function destination(item: Row): string | null {
  if (item.type !== 'comment' && item.type !== 'reply') return null
  const actor = row(item.actor), target = row(item.target)
  if (typeof item._id !== 'string' || typeof item.to !== 'string' || typeof actor._openid !== 'string'
    || typeof target.comment_id !== 'string' || typeof item.read !== 'boolean') throw Error('Invalid stored notification')
  if (item._id !== hash('notification', item.type, item.to, actor._openid, target.comment_id)) return null
  return hash('notification', 'v2', item.type, item.to, target.comment_id)
}

let records: Row[]
let backupPath: string
let digest: string
let legacyTokens: Row = {}
if (!apply) {
  records = []
  let cursor = ''
  while (true) {
    const page = query(cursor ? { _id: { $gt: cursor } } : {})
    if (!page.length) break
    records.push(...page)
    const last = page[page.length - 1]!
    if (typeof last._id !== 'string' || last._id <= cursor) throw Error('Unstable migration cursor')
    cursor = last._id
  }
  const directory = path.join(root, 'dist/messaging-privacy-migration', collection, new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(directory, { recursive: true })
  backupPath = path.join(directory, 'backup.json')
  if (blocks) for (const item of records) {
    if (typeof item._id !== 'string' || !Array.isArray(item.blockedBy)) throw Error('Invalid legacy block')
    for (const owner of item.blockedBy) {
      if (typeof owner !== 'string' || !owner) throw Error('Invalid block owner')
      legacyTokens[hash(item._id, owner)] = randomBytes(32).toString('hex')
    }
  }
  const content = JSON.stringify({ environment: config.cloudEnvironment, appId: config.appId, collection, legacyTokens, records }, null, 2)
  writeFileSync(backupPath, content, { flag: 'wx' })
  digest = createHash('sha256').update(readFileSync(backupPath)).digest('hex')
} else {
  if (!process.argv.includes('--maintenance') || !process.argv.includes('--backup') || !process.argv.includes('--sha256')) {
    throw Error('Apply requires stopped writers/readers, --maintenance, --backup and --sha256 from the reviewed dry-run')
  }
  backupPath = path.resolve(argument('--backup')!)
  const content = readFileSync(backupPath)
  digest = createHash('sha256').update(content).digest('hex')
  if (digest !== argument('--sha256')) throw Error('Backup hash mismatch')
  const saved = row(JSON.parse(content.toString('utf8')))
  if (saved.environment !== config.cloudEnvironment || saved.appId !== config.appId || saved.collection !== collection || !Array.isArray(saved.records)) throw Error('Backup scope mismatch')
  records = saved.records.map(row)
  legacyTokens = row(saved.legacyTokens)
}
let changed = 0
for (const item of records) {
  if (blocks) {
    if (typeof item._id !== 'string' || !Array.isArray(item.blockedBy)) throw Error('Invalid legacy block')
    const originalVersion = version(item.version)
    if (!item.blockedBy.length) continue
    const operations = item.operations === undefined ? {} : { ...row(item.operations) }
    for (const owner of item.blockedBy) {
      if (typeof owner !== 'string') throw Error('Invalid owner')
      const prior = operations[owner]
      const conversations = Array.isArray(prior) && prior.length ? prior : [legacyTokens[hash(item._id, owner)]]
      if (conversations.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))) throw Error('Invalid block operation token')
      operations[owner] = conversations
    }
    changed++
    if (!apply) continue
    const actual = query({ _id: item._id }, 2)[0]
    const resumed = actual && JSON.stringify(actual.operations) === JSON.stringify(operations)
      && JSON.stringify(actual.blockedBy) === JSON.stringify(item.blockedBy) && version(actual.version) === originalVersion + 1
    if (!actual || (!resumed && JSON.stringify(actual) !== JSON.stringify(item))) throw Error('Block changed since backup')
    for (const owner of item.blockedBy as string[]) for (const conversation of operations[owner] as string[]) {
      const operationId = hash('block-operation', owner, conversation)
      execute({ update: 'messaging_block_operations', updates: [{ q: { _id: operationId }, u: { $setOnInsert: {
        owner, conversation, blockId: item._id, label: '历史屏蔽记录', active: true, createdAt: item.updatedAt,
      } }, upsert: true, multi: false }] }, 'UPDATE', 'messaging_block_operations')
      const record = query({ _id: operationId }, 2, 'messaging_block_operations')[0]
      if (!record || record.owner !== owner || record.blockId !== item._id || record.conversation !== conversation) throw Error('Block operation verification failed')
    }
    if (!resumed) execute({ update: 'messaging_blocks', updates: [{ q: { _id: item._id, version: item.version },
      u: { $set: { operations, version: originalVersion + 1 } }, multi: false }] }, 'UPDATE')
    const verified = query({ _id: item._id }, 2)[0]
    if (JSON.stringify(verified?.operations) !== JSON.stringify(operations)) throw Error('Block migration readback failed')
    continue
  }
  const id = destination(item)
  if (!id) continue
  changed++
  if (!apply) continue
  const actual = query({ _id: item._id }, 2)[0]
  if (!actual) {
    if (!query({ _id: id }, 2)[0]) throw Error('Both old and new notification are missing')
    continue
  }
  if (JSON.stringify(actual) !== JSON.stringify(item)) throw Error('Source changed since backup; create a fresh reviewed snapshot')
  const { _id: ignored, ...data } = item
  execute({ update: 'notifications', updates: [{ q: { _id: id }, u: { $setOnInsert: data }, upsert: true, multi: false }] }, 'UPDATE')
  const copied = query({ _id: id }, 2)[0]
  if (!copied || copied.to !== item.to || copied.type !== item.type || row(copied.target).comment_id !== row(item.target).comment_id) throw Error('Destination verification failed')
  if (item.read === true && copied.read !== true) execute({ update: 'notifications', updates: [{ q: { _id: id }, u: { $set: { read: true } }, multi: false }] }, 'UPDATE')
  execute({ delete: 'notifications', deletes: [{ q: { _id: item._id, read: item.read, created_at: item.created_at }, limit: 1 }] }, 'DELETE')
  if (query({ _id: item._id }, 2).length || !query({ _id: id }, 2).length) throw Error('Migration verification failed')
}
process.stdout.write(JSON.stringify({ mode: apply ? 'applied' : 'dry-run', collection, count: records.length, changed, backupPath, sha256: digest }) + '\n')
