const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const { ACTION_ACCESS } = require(path.join(root, 'apps', 'cloudfunctions', 'common'))
const errors = []

for (const [functionName, actions] of Object.entries(ACTION_ACCESS)) {
  const sourcePath = path.join(root, 'apps', 'cloudfunctions', functionName, 'index.js')
  if (!fs.existsSync(sourcePath)) {
    errors.push(`Action policy references missing cloud function: ${functionName}`)
    continue
  }
  const source = fs.readFileSync(sourcePath, 'utf8')
  const exposed = new Set([...source.matchAll(/case\s+['"]([A-Za-z][A-Za-z0-9]*)['"]\s*:/g)].map(match => match[1]))
  for (const action of exposed) {
    if (!Object.hasOwn(actions, action)) errors.push(`${functionName}.${action} is exposed without an access policy.`)
  }
  for (const action of Object.keys(actions)) {
    if (!exposed.has(action)) errors.push(`${functionName}.${action} has an access policy but no handler.`)
  }
}

if (errors.length > 0) {
  process.stderr.write(`${errors.join('\n')}\n`)
  process.exit(1)
}

process.stdout.write(`Action policy validated (${Object.keys(ACTION_ACCESS).length} cloud functions).\n`)
