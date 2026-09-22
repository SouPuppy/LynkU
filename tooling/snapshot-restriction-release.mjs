import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { root, project } from './cloudbase-api.mjs'
const directory = path.join(root, 'dist/restriction-release', new Date().toISOString().replaceAll(':', '-'))
mkdirSync(directory, { recursive: true })
const tables = ['users', 'posts', 'comments', 'messages', 'conversation_entries', 'conversation_counters', 'comment_changes', 'comment_counters', 'categories', 'notification_outbox', 'profile_outbox']
function execute(table, command, type = 'QUERY') {
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/@cloudbase/cli/bin/tcb'), 'db', 'nosql', 'execute', '-e', project.cloudEnvironment,
    '--command', JSON.stringify([{ TableName: table, CommandType: type, Command: JSON.stringify(command) }]), '--json'], { cwd: root, encoding: 'utf8' })
  if (result.error || result.status !== 0) throw Error(`Snapshot failed for ${table}`)
  const parsed = JSON.parse(result.stdout)
  if (!Array.isArray(parsed.data?.results) || parsed.data.results.length !== 1) throw Error(`Invalid snapshot result for ${table}`)
  return parsed.data.results[0]
}
const report = { environment: project.cloudEnvironment, appId: project.appId, completed: false, tables: [] }
for (const table of tables) {
  const rows = []
  let after = null
  for (;;) {
    const page = execute(table, { find: table, filter: after ? { _id: { $gt: after } } : {}, sort: { _id: 1 }, limit: 100 })
    if (!Array.isArray(page) || page.length > 100) throw Error(`Invalid page for ${table}`)
    for (const row of page) {
      if (!row || typeof row._id !== 'string' || after !== null && row._id <= after) throw Error(`Unstable order in ${table}`)
      rows.push(row); after = row._id
    }
    if (page.length < 100) break
    if (rows.length >= 10000) throw Error(`Snapshot bound exceeded for ${table}`)
  }
  const rawCount = execute(table, { count: table, query: {} }, 'COMMAND')
  const count = (Array.isArray(rawCount) ? rawCount[0] : rawCount).n
  const number = typeof count === 'number' ? count : Number(count?.$numberInt ?? count?.$numberLong)
  if (number !== rows.length) throw Error(`Snapshot changed during read for ${table}`)
  const file = path.join(directory, `${table}.json`)
  writeFileSync(file, JSON.stringify(rows))
  const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex')
  report.tables.push({ table, rows: rows.length, sha256 })
  writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(report, null, 2))
  console.log(`${table}: ${rows.length} records saved`)
}
report.completed = true
writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(report, null, 2))
console.log(`Snapshot complete: ${directory}`)
