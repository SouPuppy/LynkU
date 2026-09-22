import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { cloudApi, root, project } from './cloudbase-api.mjs'
const schema = JSON.parse(readFileSync(path.join(root, 'config/cloudbase-schema.json'), 'utf8'))
const apply = process.argv.includes('--apply')
const collectionArgument = process.argv.find(value => value.startsWith('--collection='))?.slice('--collection='.length)
const selectedCollections = collectionArgument ? schema.collections.filter(item => item.name === collectionArgument) : schema.collections
if (!selectedCollections.length) throw Error('Requested schema collection does not exist')
const directory = path.join(root, 'dist/admin-cloud-schema', project.cloudEnvironment)
mkdirSync(directory, { recursive: true })
const tables = cloudApi('DescribeTables', { MgoLimit: 100 })
if (!Array.isArray(tables.Tables) || tables.Pager?.Total !== tables.Tables.length) throw Error('Cloud table inventory is incomplete')
const existing = new Set(tables.Tables.map(table => table.TableName))
const report = { environment: project.cloudEnvironment, apply, collections: [], completed: false }
function save() { writeFileSync(path.join(directory, `${collectionArgument ? `${collectionArgument}-` : ''}${apply ? 'applied.json' : 'plan.json'}`), JSON.stringify(report, null, 2)) }
function sameKeys(a, b) { return JSON.stringify(a.map(key => [key.Name, String(key.Direction)])) === JSON.stringify(b.map(key => [key.Name, String(key.Direction)])) }
for (const collection of selectedCollections) {
  if (collection.clientPermission !== 'admin-only') throw Error(`Unsupported ACL policy for ${collection.name}`)
  const existed = existing.has(collection.name)
  let info = existed ? cloudApi('DescribeTable', { TableName: collection.name }) : { Indexes: [] }
  let acl = existed ? cloudApi('DescribeDatabaseACL', { CollectionName: collection.name }) : null
  if (!Array.isArray(info.Indexes)) throw Error('Invalid index description')
  const backup = path.join(directory, `${collection.name}.before.json`)
  if (!existsSync(backup)) writeFileSync(backup, JSON.stringify({ environment: project.cloudEnvironment, existed, info, acl }, null, 2))
  if (!existed && apply) { cloudApi('CreateTable', { TableName: collection.name }); info = cloudApi('DescribeTable', { TableName: collection.name }) }
  if (apply && acl?.AclTag !== 'ADMINONLY') {
    cloudApi('ModifyDatabaseACL', { CollectionName: collection.name, AclTag: 'ADMINONLY' })
    acl = cloudApi('DescribeDatabaseACL', { CollectionName: collection.name })
    if (acl.AclTag !== 'ADMINONLY') throw Error(`ACL readback failed: ${collection.name}`)
  }
  const missing = [], conflicts = []
  for (const index of collection.indexes ?? []) {
    const keys = index.fields.map(Name => ({ Name, Direction: '1' }))
    const matches = info.Indexes.filter(item => sameKeys(item.Keys, keys))
    if (matches.some(item => Boolean(item.Unique) === Boolean(index.unique) && !item.Sparse && !item.PartialFilterExpression)) continue
    if (matches.length) { conflicts.push(index); continue }
    const IndexName = `lynku_admin_${createHash('sha256').update(JSON.stringify([keys, !!index.unique])).digest('hex').slice(0, 20)}`
    missing.push({ IndexName, MgoKeySchema: { MgoIndexKeys: keys, MgoIsUnique: !!index.unique, MgoIsSparse: false } })
  }
  if (apply && missing.length) {
    cloudApi('UpdateTable', { TableName: collection.name, CreateIndexes: missing })
    const after = cloudApi('DescribeTable', { TableName: collection.name })
    for (const index of missing) if (!after.Indexes?.some(item => sameKeys(item.Keys, index.MgoKeySchema.MgoIndexKeys) && Boolean(item.Unique) === index.MgoKeySchema.MgoIsUnique)) throw Error(`Index readback failed: ${collection.name}/${index.IndexName}`)
  }
  report.collections.push({ name: collection.name, existed, acl: acl?.AclTag ?? null, missingIndexes: missing, conflicts })
  save()
  process.stdout.write(`${collection.name}: ${apply ? 'verified' : 'planned'}, ${missing.length} indexes, ${conflicts.length} conflicts\n`)
}
report.completed = !report.collections.some(collection => collection.conflicts.length)
save()
if (!report.completed) process.exitCode = 1
