import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { configureProject } from './configure-project.mjs'
import { runInstalledCommand } from './wechat-cli.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const config = configureProject(root, true)
const schema = JSON.parse(fs.readFileSync(path.join(root, 'config/cloudbase-schema.json'), 'utf8'))
const cli = process.env.WECHAT_SKILL_CLI || 'C:/Program Files (x86)/Tencent/微信web开发者工具/wechatide.cmd'
const directory = path.join(root, 'dist/cloud-initialization')
fs.mkdirSync(directory, { recursive: true })
const journalPath = path.join(directory, 'journal.json')
const journal = fs.existsSync(journalPath) ? JSON.parse(fs.readFileSync(journalPath, 'utf8'))
  : { appId: config.appId, environment: config.cloudEnvironment, operations: [] }
if (journal.appId !== config.appId || journal.environment !== config.cloudEnvironment) throw new Error('Initialization journal belongs to another target. Do not reuse it.')
const context = ['--appid', config.appId, '--env', config.cloudEnvironment]
const save = () => fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2) + '\n')
function tool(name, args) {
  const raw = runInstalledCommand(cli, ['-c', 'Codex', name, ...args], 65000)
  const response = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
  if (response.ok !== true || response.result?.success !== true) throw new Error(`WeChat tool failed: ${name}`)
  return response.result
}

// Resume each existing platform confirmation once; never poll in a background loop or resend it.
for (const operation of journal.operations.filter(item => item.status === 'pending')) {
  const result = tool('polling_task_result', ['--task-id', operation.taskId])
  operation.status = result.status
  save()
}
if (journal.operations.some(item => !['success', 'pending'].includes(item.status))) {
  throw new Error('A previous operation did not succeed. Inspect the journal; cancelled/failed writes are not retried automatically.')
}
const current = tool('cloud_db_read_struct', [...context, '--action', 'listCollections', '--limit', '100'])
if (current.pager?.Total > current.collections.length) throw new Error('Collection listing is truncated')
const existing = new Set(current.collections.map(item => item.TableName))
const apply = process.argv.includes('--apply')
const missing = schema.collections.filter(item => !existing.has(item.name))
console.log(`Target ${config.appId} / ${config.cloudEnvironment}; ${existing.size} existing collections, ${missing.length} missing.`)
if (apply) {
  // Collections are independent. Queue each missing collection at most once, then stop before dependent indexes.
  for (const collection of missing) {
    const key = `collection:${collection.name}`
    if (journal.operations.some(item => item.key === key)) continue
    const result = tool('cloud_db_write_struct', [...context, '--action', 'createCollection', '--collection-name', collection.name])
    journal.operations.push({ key, status: result.status || 'success', ...(result.taskId ? { taskId: result.taskId } : {}) })
    save()
    console.log(`${collection.name}: ${result.status || 'success'}`)
  }
}

const indexPlan = []
for (const collection of schema.collections.filter(item => existing.has(item.name) && item.indexes?.length)) {
  const live = tool('cloud_db_read_struct', [...context, '--action', 'listIndexes', '--collection-name', collection.name])
  for (const index of collection.indexes) {
    const keys = index.fields.map(Name => ({ Name, Direction: ['created_at', 'updated_at', '_id'].includes(Name) ? '-1' : '1' }))
    const compatible = live.indexes.find(candidate => JSON.stringify(candidate.Keys) === JSON.stringify(keys) && !!candidate.Unique === !!index.unique)
    if (compatible) continue
    const conflict = live.indexes.find(candidate => JSON.stringify(candidate.Keys) === JSON.stringify(keys))
    const IndexName = `lynku_${index.fields.join('_').replaceAll(/^_+/g, '')}${index.unique ? '_unique' : ''}`
    indexPlan.push({ collection: collection.name, conflict: conflict?.Name || null,
      options: { CreateIndexes: [{ IndexName, MgoKeySchema: { MgoIndexKeys: keys, MgoIsUnique: !!index.unique, MgoIsSparse: false } }] } })
  }
}
fs.writeFileSync(path.join(directory, 'remaining.json'), JSON.stringify({ appId: config.appId, environment: config.cloudEnvironment,
  missingCollections: missing.map(item => item.name), pending: journal.operations.filter(item => item.status === 'pending'),
  missingIndexes: indexPlan, requiredPermissions: schema.collections.map(item => ({ collection: item.name, permission: item.clientPermission })),
  permissionStatus: 'Requires independent platform verification; collection creation does not apply permissions.' }, null, 2) + '\n')
if (apply && !missing.length && !journal.operations.some(item => item.status === 'pending')) {
  for (const collection of schema.collections) {
    const indexes = indexPlan.filter(item => item.collection === collection.name && !item.conflict)
    if (!indexes.length) continue
    const definition = JSON.stringify(indexes.map(item => item.options.CreateIndexes))
    const key = `indexes:${collection.name}:${createHash('sha256').update(definition).digest('hex').slice(0, 16)}`
    if (journal.operations.some(item => item.key === key)) continue
    const optionsPath = path.join(directory, `${collection.name}-indexes.json`)
    fs.writeFileSync(optionsPath, JSON.stringify({ CreateIndexes: indexes.flatMap(item => item.options.CreateIndexes) }, null, 2))
    const result = tool('cloud_db_write_struct', [...context, '--action', 'updateCollection', '--collection-name', collection.name, '--update-options-file', optionsPath])
    journal.operations.push({ key, status: result.status || 'success', ...(result.taskId ? { taskId: result.taskId } : {}) })
    save()
    console.log(`${key}: ${result.status || 'success'}`)
  }
}
console.log(`Saved initialization evidence. ${indexPlan.length} index definitions require application/verification; permissions are not implied by collection creation.`)
if (missing.length || indexPlan.length || journal.operations.some(item => item.status === 'pending')) process.exitCode = 2
