import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { root, project } from './cloudbase-api.mjs'
const apply = process.argv.includes('--apply')
function execute(command, type = 'QUERY') {
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/@cloudbase/cli/bin/tcb'), 'db', 'nosql', 'execute', '-e', project.cloudEnvironment,
    '--command', JSON.stringify([{ TableName: 'audit_events', CommandType: type, Command: JSON.stringify(command) }]), '--json'], { cwd: root, encoding: 'utf8' })
  if (result.error || result.status !== 0) throw Error('Audit database command failed')
  const results = JSON.parse(result.stdout).data?.results
  if (!Array.isArray(results) || results.length !== 1) throw Error('Invalid audit database response')
  return results[0]
}
function number(value) {
  if (typeof value === 'number') return value
  for (const key of ['$numberInt', '$numberLong', '$numberDouble']) if (typeof value?.[key] === 'string') return Number(value[key])
  throw Error('Invalid database count')
}
const rows = []
let cursor = ''
while (true) {
  const page = execute({ find: 'audit_events', filter: cursor ? { _id: { $gt: cursor } } : {}, sort: { _id: 1 }, limit: 100 })
  if (!Array.isArray(page) || page.length > 100) throw Error('Invalid audit page')
  for (const row of page) {
    if (typeof row._id !== 'string' || row._id <= cursor) throw Error('Invalid audit ordering')
    cursor = row._id; rows.push(row)
  }
  if (rows.length > 10000) throw Error('Audit migration exceeds reviewed bound')
  if (page.length < 100) break
}
const counted = execute({ count: 'audit_events', query: {} }, 'COMMAND')
if (number((Array.isArray(counted) ? counted[0] : counted).n) !== rows.length) throw Error('Audit snapshot changed; retry during a quiet window')
const pending = rows.filter(row => typeof row.at === 'string')
for (const row of rows) {
  const value = typeof row.at === 'string' ? row.at : row.at?.$date
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw Error('Unexpected stored audit date; no writes performed')
}
const directory = path.join(root, 'dist/audit-date-migration', new Date().toISOString().replaceAll(':', '-'))
mkdirSync(directory, { recursive: true })
const backupPath = path.join(directory, 'backup.json')
writeFileSync(backupPath, JSON.stringify({ environment: project.cloudEnvironment, rows }, null, 2))
const saved = readFileSync(backupPath, 'utf8'), backup = JSON.parse(saved)
if (backup.environment !== project.cloudEnvironment || JSON.stringify(backup.rows) !== JSON.stringify(rows)) throw Error('Backup verification failed')
const report = { environment: project.cloudEnvironment, apply, total: rows.length, pending: pending.length, backupSha256: createHash('sha256').update(saved).digest('hex'), completed: [], verified: false }
const save = () => writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
save()
if (apply) for (const row of pending) {
  const expected = new Date(row.at).toISOString()
  execute({ update: 'audit_events', updates: [{ q: { _id: row._id, at: row.at }, u: { $set: { at: { $date: expected } } }, multi: false, upsert: false }] }, 'UPDATE')
  const actual = execute({ find: 'audit_events', filter: { _id: row._id }, limit: 1 })
  if (actual.length !== 1 || actual[0].at?.$date !== expected) throw Error('Audit migration readback failed')
  const { at: ignoredOld, ...before } = row, { at: ignoredNew, ...after } = actual[0]
  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('Unexpected audit field change')
  report.completed.push(row._id); save()
}
report.verified = true; save()
console.log(JSON.stringify({ apply, total: rows.length, pending: pending.length, verified: true, directory }))
