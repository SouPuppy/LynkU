// One-time prototype cutover. Run only after deploying the new users function and retiring login.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { planIdentityMigration, compareIdentitySnapshot } = require('./plan-identity-migration')

const directory = path.resolve(process.argv[2] || '')
const privateRoot = path.resolve('dist/private-backups') + path.sep
if (!directory.startsWith(privateRoot) || process.argv[3] !== '--apply') {
  throw Error('Usage: node scripts/apply-identity-migration.js dist/private-backups/<backup> --apply')
}
const cli = process.env.TCB_CLI_PATH
if (!cli) throw Error('Set TCB_CLI_PATH to the installed CloudBase CLI entry point')
const source = fs.readFileSync(path.join(directory, 'users.json'), 'utf8')
const records = source.trim().split(/\r?\n/).map(line => JSON.parse(line))
const plan = planIdentityMigration(records)
for (const claim of plan.claims) if (claim.verified_at?.$date) claim.verified_at = claim.verified_at.$date
const journal = { environment: JSON.parse(fs.readFileSync('cloudbaserc.json', 'utf8')).envId,
  sourceSha256: crypto.createHash('sha256').update(source).digest('hex'), steps: [] }
function command(table, type, body) {
  const result = spawnSync(process.execPath, [cli, 'db', 'nosql', 'execute', '--command',
    JSON.stringify([{ TableName: table, CommandType: type, Command: JSON.stringify(body) }]), '--json'],
  { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  let response
  try { response = JSON.parse(result.stdout) } catch { throw Error('Cloud command returned invalid JSON') }
  const rows = response.data?.results?.[0]
  fs.writeFileSync(path.join(directory, 'last-migration-response.json'), JSON.stringify(response))
  if (result.status !== 0 || response.error || !Array.isArray(rows)
    || rows.some(row => row.writeErrors?.length || row.errmsg || (row.ok !== undefined && Number(row.ok?.$numberDouble ?? row.ok) !== 1))) {
    throw Error('Cloud command failed; inspect private last-migration-response.json')
  }
  journal.steps.push({ table, operation: Object.keys(body)[0], requestId: response.data.requestId })
  fs.writeFileSync(path.join(directory, 'identity-migration-journal.json'), JSON.stringify(journal, null, 2))
  return rows
}
const current = command('users', 'QUERY', { find: 'users', filter: {}, limit: 1000 })
const expectedCurrent = records.filter(row => current.some(live => live._id === row._id)).map(row => {
  const account = plan.canonical.find(item => item.id === row._id)
  const live = current.find(item => item._id === row._id)
  const defaults = Object.fromEntries(Object.entries(account?.defaults || {}).filter(([key]) => live[key] !== undefined))
  return { ...row, ...defaults }
})
if (current.length >= 1000 || plan.canonical.some(row => !current.some(live => live._id === row.id))
  || !compareIdentitySnapshot(numericValues(expectedCurrent), numericValues(current)).unchanged) {
  throw Error('Live accounts differ from backup; refresh the backup and plan before applying')
}
// Archives contain complete source records and canonical IDs; no private data enters the repository.
fs.writeFileSync(path.join(directory, 'archived-duplicate-users.json'), JSON.stringify(plan.archives, null, 2))
for (const account of plan.canonical) {
  if (Object.keys(account.defaults).length) command('users', 'UPDATE', { update: 'users', updates: [
    { q: { _id: account.id, _openid: account.owner }, u: { $set: account.defaults }, multi: false, upsert: false },
  ] })
}
const existingClaims = command('email_claims', 'QUERY', { find: 'email_claims', filter: {}, limit: 1000 })
for (const claim of plan.claims) {
  const existing = existingClaims.find(row => row._id === claim._id)
  if (existing) {
    if (!compareIdentitySnapshot([claim], [existing]).unchanged) throw Error('Existing email claim conflicts with migration')
  } else command('email_claims', 'INSERT', { insert: 'email_claims', documents: [claim] })
}
for (const duplicate of plan.archives) command('users', 'DELETE', { delete: 'users', deletes: [
  { q: { _id: duplicate.source._id, _openid: duplicate.source._openid, verified: { $ne: true } }, limit: 1 },
] })
command('users', 'COMMAND', { createIndexes: 'users', indexes: [
  { key: { _openid: 1 }, name: 'unique_openid', unique: true },
] })
const final = command('users', 'QUERY', { find: 'users', filter: {}, limit: 1000 })
const expected = plan.canonical.map(account => ({ ...account.source, ...account.defaults }))
// The database returns numeric fields as Extended JSON.
function numericValues(value) {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(numericValues)
  if (Object.keys(value).length === 1 && '$numberInt' in value) return Number(value.$numberInt)
  if (Object.keys(value).length === 1 && '$numberDouble' in value) return Number(value.$numberDouble)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, numericValues(item)]))
}
if (!compareIdentitySnapshot(numericValues(expected), numericValues(final)).unchanged) throw Error('Post-migration account verification failed')
const claims = command('email_claims', 'QUERY', { find: 'email_claims', filter: {}, limit: 1000 })
if (!compareIdentitySnapshot(plan.claims, claims).unchanged) throw Error('Post-migration email ownership verification failed')
journal.completed = true
journal.summary = plan.summary
fs.writeFileSync(path.join(directory, 'identity-migration-journal.json'), JSON.stringify(journal, null, 2))
console.log(JSON.stringify({ completed: true, accounts: final.length, verifiedClaims: claims.length, archived: plan.archives.length }))
