// Read-only planner. Private records and the executable plan stay in ignored local storage.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
function normalized(value) {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(normalized)
  if (Object.keys(value).length === 1 && '$date' in value) {
    const date = typeof value.$date === 'string' ? new Date(value.$date) : new Date(Number(value.$date.$numberLong))
    return { $date: date.toISOString() }
  }
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalized(value[key])]))
}
function compareIdentitySnapshot(expected, current) {
  const previous = new Map(expected.map(row => [row._id, JSON.stringify(normalized(row))]))
  const actual = new Map(current.map(row => [row._id, JSON.stringify(normalized(row))]))
  if (actual.size !== current.length || previous.size !== expected.length) throw Error('Duplicate record IDs')
  const changed = current.filter(row => previous.get(row._id) !== actual.get(row._id)).length
  const missing = expected.filter(row => !actual.has(row._id)).length
  return { changedOrAdded: changed, missing, unchanged: changed === 0 && missing === 0 }
}
function planIdentityMigration(records) {
  const groups = new Map()
  const ids = new Set()
  for (const record of records) {
    if (!record || typeof record._id !== 'string' || !record._id || ids.has(record._id)
      || typeof record._openid !== 'string' || !record._openid) throw Error('Invalid or duplicate account record ID')
    ids.add(record._id)
    if (record.verified !== undefined && typeof record.verified !== 'boolean') throw Error('Ambiguous verification state')
    if (record.role !== 'user' && record.role !== 'admin') throw Error('Unknown account role')
    const group = groups.get(record._openid) || []
    group.push(record); groups.set(record._openid, group)
  }
  const canonical = [], archives = [], claims = [], claimedEmails = new Set()
  for (const group of groups.values()) {
    const verified = group.filter(record => record.verified === true)
    if (verified.length > 1) throw Error('Multiple verified records for one WeChat identity require reconciliation')
    // Never guess between conflicting unverified profiles.
    if (!verified.length && group.length > 1) throw Error('Ambiguous unverified duplicate profiles')
    const keep = verified[0] || group[0]
    if (group.some(record => record.role !== keep.role)) throw Error('Conflicting account roles')
    if (typeof keep.nickname !== 'string' || !keep.nickname || typeof keep.avatar_url !== 'string') throw Error('Invalid profile fields')
    const defaults = {}
    if (keep.email === undefined) defaults.email = ''
    if (keep.verified === undefined) defaults.verified = false
    if (keep.profile_version === undefined) defaults.profile_version = 0
    else if (!Number.isSafeInteger(keep.profile_version) || keep.profile_version < 0) throw Error('Invalid profile version')
    if (keep.verified) {
      if (typeof keep.email !== 'string' || !keep.email.trim() || keep.email !== keep.email.trim().toLowerCase()) throw Error('Verified email needs normalization review')
      if (claimedEmails.has(keep.email)) throw Error('Email assigned to multiple verified identities')
      claimedEmails.add(keep.email)
      const id = crypto.createHash('sha256').update(['email:claim', keep.email].join('\0')).digest('hex')
      claims.push({ _id: id, email: keep.email, owner_openid: keep._openid, verified_at: keep.verified_at })
    }
    canonical.push({ id: keep._id, owner: keep._openid, defaults, source: keep })
    for (const duplicate of group) if (duplicate !== keep) archives.push({ canonical_id: keep._id, source: duplicate })
  }
  return { version: 1, canonical, archives, claims, summary: { records: records.length, identities: groups.size,
    verified: claims.length, duplicateRecordsToArchive: archives.length, accountsNeedingDefaults: canonical.filter(item => Object.keys(item.defaults).length).length } }
}
if (require.main === module) {
  const input = process.argv[2], output = process.argv[3]
  if (!input || !output) throw Error('Usage: node scripts/plan-identity-migration.js <export.json> <ignored-output-directory>')
  const destination = path.resolve(output)
  const privateRoot = path.resolve('dist/private-backups')
  if (!destination.startsWith(privateRoot + path.sep)) throw Error('Output must be under dist/private-backups')
  const raw = fs.readFileSync(input, 'utf8')
  let records
  try { const parsed = JSON.parse(raw); records = Array.isArray(parsed) ? parsed : [parsed] }
  catch { records = raw.trim().split(/\r?\n/).map(line => JSON.parse(line)) }
  const plan = planIdentityMigration(records)
  plan.sourceSha256 = crypto.createHash('sha256').update(raw).digest('hex')
  fs.mkdirSync(destination, { recursive: true })
  fs.writeFileSync(path.join(destination, 'identity-plan.json'), JSON.stringify(plan, null, 2))
  console.log(JSON.stringify({ ...plan.summary, sourceSha256: plan.sourceSha256, applied: false }))
}
module.exports = { planIdentityMigration, compareIdentitySnapshot }
