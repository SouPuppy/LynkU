import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { root, project } from './cloudbase-api.mjs'

const allowed = new Set(['--apply'])
if (process.argv.slice(2).some(argument => !allowed.has(argument))) throw Error('Usage: node tooling/reset-message-protocol.mjs [--apply]')
const apply = process.argv.includes('--apply')
const collections = ['messages', 'conversation_entries', 'conversation_counters']
const cli = path.join(root, 'node_modules/@cloudbase/cli/bin/tcb')

function execute(table, command, type = 'QUERY') {
  const payload = JSON.stringify([{ TableName: table, CommandType: type, Command: JSON.stringify(command) }])
  const result = spawnSync(process.execPath, [cli, 'db', 'nosql', 'execute', '-e', project.cloudEnvironment,
    '--command', payload, '--json'], { cwd: root, encoding: 'utf8' })
  if (result.error || result.status !== 0) throw Error(`Cloud database ${type} failed for ${table}`)
  let parsed
  try { parsed = JSON.parse(result.stdout) } catch { throw Error(`Cloud database returned unreadable ${table} output`) }
  const results = parsed.data?.results
  if (!Array.isArray(results) || results.length !== 1) throw Error(`Cloud database returned invalid ${table} envelope`)
  return results[0]
}

function numeric(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if (value && typeof value === 'object') for (const key of ['$numberInt', '$numberLong', '$numberDouble']) {
    if (typeof value[key] === 'string' && Number.isSafeInteger(Number(value[key])) && Number(value[key]) >= 0) return Number(value[key])
  }
  throw Error('Invalid database count')
}

function snapshot(table) {
  const rows = []
  let cursor = ''
  while (true) {
    const page = execute(table, { find: table, filter: cursor ? { _id: { $gt: cursor } } : {}, sort: { _id: 1 }, limit: 100 })
    if (!Array.isArray(page) || page.length > 100) throw Error(`Invalid ${table} page`)
    for (const row of page) {
      if (!row || typeof row._id !== 'string' || !row._id || row._id <= cursor) throw Error(`Invalid ${table} ordering`)
      cursor = row._id
      rows.push(row)
      if (rows.length > 50000) throw Error(`${table} exceeds the reviewed migration limit`)
    }
    if (page.length < 100) break
  }
  const counted = execute(table, { count: table, query: {} }, 'COMMAND')
  const count = numeric((Array.isArray(counted) ? counted[0] : counted).n)
  if (count !== rows.length) throw Error(`${table} changed while creating backup`)
  return rows
}

const before = Object.fromEntries(collections.map(collection => [collection, snapshot(collection)]))
const directory = path.join(root, 'dist', 'private-backups', 'message-protocol-reset', new Date().toISOString().replaceAll(':', '-'))
mkdirSync(directory, { recursive: true })
const backupPath = path.join(directory, 'backup.json')
writeFileSync(backupPath, JSON.stringify({ environment: project.cloudEnvironment, appId: project.appId, collections: before }, null, 2))
const backupText = readFileSync(backupPath, 'utf8')
const backup = JSON.parse(backupText)
if (backup.environment !== project.cloudEnvironment || backup.appId !== project.appId
  || collections.some(collection => JSON.stringify(backup.collections?.[collection]) !== JSON.stringify(before[collection]))) {
  throw Error('Message backup verification failed')
}
const report = { environment: project.cloudEnvironment, appId: project.appId, apply,
  counts: Object.fromEntries(collections.map(collection => [collection, before[collection].length])),
  backupSha256: createHash('sha256').update(backupText).digest('hex'), deleted: {}, verified: false }
const reportPath = path.join(directory, 'report.json')
const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2))
save()

if (apply) for (const collection of collections) {
  const ids = before[collection].map(row => row._id)
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100)
    execute(collection, { delete: collection, deletes: [{ q: { _id: { $in: batch } }, limit: 0 }] }, 'DELETE')
  }
  const remaining = snapshot(collection)
  if (remaining.length !== 0) throw Error(`${collection} deletion verification failed`)
  report.deleted[collection] = ids.length
  save()
}
report.verified = true
save()
console.log(JSON.stringify({ mode: apply ? 'applied' : 'dry-run', environment: project.cloudEnvironment, counts: report.counts,
  verified: true, backup: backupPath, report: reportPath }))
