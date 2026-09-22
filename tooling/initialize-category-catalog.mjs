import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { root, project } from './cloudbase-api.mjs'
const apply = process.argv.includes('--apply')
function execute(table, command, type = 'QUERY') {
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/@cloudbase/cli/bin/tcb'), 'db', 'nosql', 'execute', '-e', project.cloudEnvironment,
    '--command', JSON.stringify([{ TableName: table, CommandType: type, Command: JSON.stringify(command) }]), '--json'], { cwd: root, encoding: 'utf8' })
  if (result.error || result.status !== 0) throw Error('Category initialization command failed')
  const results = JSON.parse(result.stdout).data?.results
  if (!Array.isArray(results) || results.length !== 1) throw Error('Invalid database response')
  return results[0]
}
function number(value) {
  if (typeof value === 'number') return value
  for (const key of ['$numberInt', '$numberLong', '$numberDouble']) if (typeof value?.[key] === 'string') return Number(value[key])
  throw Error('Invalid database count')
}
const rows = execute('categories', { find: 'categories', filter: {}, sort: { _id: 1 }, limit: 101 })
if (!Array.isArray(rows) || rows.length > 100 || new Set(rows.map(row => row._id)).size !== rows.length || new Set(rows.map(row => row.name)).size !== rows.length) throw Error('Invalid category inventory')
const countResult = execute('categories', { count: 'categories', query: {} }, 'COMMAND')
if (number((Array.isArray(countResult) ? countResult[0] : countResult).n) !== rows.length) throw Error('Category snapshot changed')
const prior = execute('category_catalog', { find: 'category_catalog', filter: { _id: 'total' }, limit: 1 })
if (!Array.isArray(prior) || prior.length > 1 || prior.length && number(prior[0].count) !== rows.length) throw Error('Catalog differs from stored categories; refusing to reset')
const directory = path.join(root, 'dist/category-catalog', new Date().toISOString().replaceAll(':', '-'))
mkdirSync(directory, { recursive: true })
const backupPath = path.join(directory, 'backup.json')
writeFileSync(backupPath, JSON.stringify({ environment: project.cloudEnvironment, rows, prior }, null, 2))
const backupText = readFileSync(backupPath, 'utf8'), saved = JSON.parse(backupText)
if (saved.environment !== project.cloudEnvironment || JSON.stringify(saved.rows) !== JSON.stringify(rows)) throw Error('Backup verification failed')
// Deploy the read-only categories function before applying. New admin creation refuses an absent catalog.
if (apply && prior.length === 0) execute('category_catalog', { update: 'category_catalog', updates: [{ q: { _id: 'total', count: { $exists: false } },
  u: { $setOnInsert: { count: rows.length } }, upsert: true, multi: false }] }, 'UPDATE')
if (apply) {
  const after = execute('category_catalog', { find: 'category_catalog', filter: { _id: 'total' }, limit: 1 })
  const categories = execute('categories', { find: 'categories', filter: {}, sort: { _id: 1 }, limit: 101 })
  if (after.length !== 1 || number(after[0].count) !== rows.length || JSON.stringify(categories) !== JSON.stringify(rows)) throw Error('Category initialization readback mismatch')
}
writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ apply, total: rows.length, previouslyInitialized: prior.length === 1, verified: true, backupSha256: createHash('sha256').update(backupText).digest('hex') }, null, 2))
console.log(JSON.stringify({ apply, total: rows.length, previouslyInitialized: prior.length === 1, verified: true, directory }))
