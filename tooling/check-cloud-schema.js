const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const schemaPath = path.join(root, 'config', 'cloudbase-schema.json')
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'))
const errors = []

if (!Number.isSafeInteger(schema.version) || schema.version < 1) errors.push('Schema manifest requires a positive integer version.')
if (!Array.isArray(schema.collections) || schema.collections.length === 0) errors.push('Schema manifest requires collections.')

const declared = new Set()
for (const collection of schema.collections || []) {
  if (!collection || !/^[a-z][a-z0-9_]*$/.test(collection.name || '')) {
    errors.push(`Invalid collection name: ${collection && collection.name}`)
    continue
  }
  if (declared.has(collection.name)) errors.push(`Duplicate collection declaration: ${collection.name}`)
  declared.add(collection.name)
  if (!['admin-only', 'public-read-admin-write'].includes(collection.clientPermission)) {
    errors.push(`Collection ${collection.name} has an invalid clientPermission.`)
  }
  for (const index of collection.indexes || []) {
    if (!Array.isArray(index.fields) || index.fields.length === 0 || index.fields.some(field => typeof field !== 'string' || !field)) {
      errors.push(`Collection ${collection.name} has an invalid index.`)
    }
  }
}

const referenced = new Set()
function inspect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) inspect(file)
    else if (/\.(js|ts)$/.test(file)) {
      const source = fs.readFileSync(file, 'utf8')
      for (const match of source.matchAll(/collection\(['"]([a-z][a-z0-9_]*)['"]\)/g)) referenced.add(match[1])
    }
  }
}
inspect(path.join(root, 'apps/cloudfunctions'))
inspect(path.join(root, 'packages/adapters/src'))
for (const name of referenced) {
  if (!declared.has(name)) errors.push(`Cloud function source references undeclared collection: ${name}`)
}

const development = fs.readFileSync(path.join(root, 'docs', 'DEVELOPMENT.md'), 'utf8')
if (!development.includes('config/cloudbase-schema.json')) errors.push('Development guide must link to config/cloudbase-schema.json.')

if (errors.length > 0) {
  process.stderr.write(`${errors.join('\n')}\n`)
  process.exit(1)
}

process.stdout.write(`CloudBase schema manifest validated (${declared.size} collections).\n`)
