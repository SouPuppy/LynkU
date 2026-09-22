import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(readFileSync(path.join(root, 'config/project.json'), 'utf8'))
const apply = process.argv.includes('--apply')
function execute(command, type = 'QUERY') {
  const payload = JSON.stringify([{ TableName: 'categories', CommandType: type, Command: JSON.stringify(command) }])
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/@cloudbase/cli/bin/tcb'), 'db', 'nosql', 'execute', '-e', config.cloudEnvironment, '--command', payload, '--json'], { cwd: root, encoding: 'utf8' })
  if (result.error || result.status !== 0) throw Error('Cloud database command failed')
  let response
  try { response = JSON.parse(result.stdout) } catch { throw Error('Cloud database returned unreadable output') }
  if (!response.data || !Array.isArray(response.data.results) || response.data.results.length !== 1) throw Error('Cloud database returned an invalid envelope')
  return response.data.results[0]
}
function number(value) {
  if (typeof value === 'number') return value
  if (value && typeof value === 'object') for (const key of ['$numberInt', '$numberLong', '$numberDouble']) {
    if (typeof value[key] === 'string') return Number(value[key])
  }
  throw Error('Invalid numeric category field')
}
function read() {
  const rows = execute({ find: 'categories', filter: {}, limit: 101 })
  const countResult = execute({ count: 'categories', query: {} }, 'COMMAND')
  const countRow = Array.isArray(countResult) ? countResult[0] : countResult
  if (!countRow || number(countRow.n) !== rows.length) throw Error('Category snapshot is truncated or changed during reading')
  if (!Array.isArray(rows) || rows.length > 100) throw Error('Category snapshot exceeds supported size')
  const ids = new Set()
  for (const row of rows) {
    if (!row || typeof row._id !== 'string' || !row._id || ids.has(row._id) || typeof row.name !== 'string'
      || typeof row.description !== 'string' || !['active', 'hidden'].includes(row.status)
      || !Number.isSafeInteger(number(row.sort_order)) || !Number.isSafeInteger(number(row.post_count)) || number(row.post_count) < 0) throw Error('Invalid category snapshot')
    if (row.managementRevision !== undefined && (!Number.isSafeInteger(number(row.managementRevision)) || number(row.managementRevision) < 0)) throw Error('Invalid existing management revision')
    ids.add(row._id)
  }
  return rows
}
const before = read(), missing = before.filter(row => row.managementRevision === undefined)
const directory = path.join(root, 'dist/admin-category-migration', config.cloudEnvironment)
mkdirSync(directory, { recursive: true })
const snapshotPath = path.join(directory, 'backup.json')
if (!existsSync(snapshotPath)) writeFileSync(snapshotPath, JSON.stringify({ environment: config.cloudEnvironment, appId: config.appId, rows: before }, null, 2))
const savedText = readFileSync(snapshotPath, 'utf8'), saved = JSON.parse(savedText)
if (saved.environment !== config.cloudEnvironment || saved.appId !== config.appId || !Array.isArray(saved.rows)) throw Error('Backup target mismatch')
if (missing.some(row => !saved.rows.some(original => original._id === row._id))) throw Error('New categories require a fresh reviewed backup before migration')
const backupSha256 = createHash('sha256').update(savedText).digest('hex')
writeFileSync(path.join(directory, 'plan.json'), JSON.stringify({ environment: config.cloudEnvironment, total: before.length, initializeIds: missing.map(row => row._id), backupSha256, apply }, null, 2))
if (apply) {
  const completed = []
  for (const row of missing) {
    // Only the new field is written. Counts, names, identities and existing revisions are never replaced.
    execute({ update: 'categories', updates: [{ q: { _id: row._id, managementRevision: { $exists: false } }, u: { $set: { managementRevision: 0 } }, multi: false, upsert: false }] }, 'UPDATE')
    const actual = read().find(item => item._id === row._id)
    if (!actual || actual.managementRevision === undefined || number(actual.managementRevision) < 0) throw Error('Category migration readback failed')
    completed.push(row._id)
    writeFileSync(path.join(directory, 'checkpoint.json'), JSON.stringify({ environment: config.cloudEnvironment, completed, backupSha256 }, null, 2))
  }
  const after = read()
  if (after.some(row => row.managementRevision === undefined) || before.some(row => !after.some(item => item._id === row._id))) throw Error('Category migration final verification failed')
}
process.stdout.write(JSON.stringify({ mode: apply ? 'applied' : 'dry-run', environment: config.cloudEnvironment, categories: before.length, missingRevisions: missing.length, backup: snapshotPath }) + '\n')
