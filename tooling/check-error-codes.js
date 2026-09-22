const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const resultContract = fs.readFileSync(path.join(root, 'packages', 'contracts', 'src', 'result.ts'), 'utf8')
const declared = new Set([...resultContract.matchAll(/^\s*\|\s+'([A-Z_]+)'/gm)].map(match => match[1]))
const errors = []

for (const directory of fs.readdirSync(path.join(root, 'apps', 'cloudfunctions'), { withFileTypes: true })) {
  if (!directory.isDirectory()) continue
  const file = path.join(root, 'apps', 'cloudfunctions', directory.name, 'index.ts')
  if (!fs.existsSync(file)) continue
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, index) => {
    if (!line.includes('fail(') || line.includes('function fail(')) return
    for (const match of line.matchAll(/['"]([A-Z][A-Z_]+)['"]/g)) {
      if (!declared.has(match[1])) errors.push(`${path.relative(root, file)}:${index + 1} uses undeclared error code ${match[1]}`)
    }
  })
}

if (errors.length > 0) {
  process.stderr.write(`${errors.join('\n')}\n`)
  process.exit(1)
}

process.stdout.write(`Cloud error codes validated (${declared.size} contract codes).\n`)
