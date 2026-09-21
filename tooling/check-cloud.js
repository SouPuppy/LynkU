const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const functionsRoot = path.join(root, 'apps', 'cloudfunctions')
const config = JSON.parse(fs.readFileSync(path.join(root, 'cloudbaserc.json'), 'utf8'))
const functionNames = new Set(['common', ...config.functions.map(entry => entry.name)])

function sourceFiles(directory) {
  const files = []
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (entry.name.endsWith('.js')) files.push(full)
    }
  }
  visit(directory)
  return files
}

const entries = Array.from(functionNames)
  .flatMap(name => sourceFiles(path.join(functionsRoot, name)))
  .sort()

let failed = false
const errors = []
const commonSource = fs.readFileSync(path.join(functionsRoot, 'common', 'index.js'), 'utf8')
const commonExports = new Set(
  Array.from(commonSource.matchAll(/^\s{2}([A-Za-z_$][\w$]*),?$/gm), match => match[1]),
)
for (const file of entries) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' })
  if (result.status !== 0) failed = true
  if (path.basename(file) !== 'index.js' || path.dirname(file) === path.join(functionsRoot, 'common')) continue
  const source = fs.readFileSync(file, 'utf8')
  const importMatch = source.match(/const\s*\{([\s\S]*?)\}\s*=\s*require\(['"]\.\.\/common['"]\)/)
  if (!importMatch) {
    errors.push(`${path.relative(root, file)}: missing canonical ../common import`)
    continue
  }
  const imports = new Set(Array.from(importMatch[1].matchAll(/[A-Za-z_$][\w$]*/g), match => match[0]))
  for (const imported of imports) {
    if (!commonExports.has(imported)) errors.push(`${path.relative(root, file)}: ${imported} is not exported by common utilities`)
  }
  for (const exported of commonExports) {
    if (new RegExp(`\\b${exported}\\s*\\(`).test(source) && !imports.has(exported)) {
      errors.push(`${path.relative(root, file)}: uses ${exported} without importing it from ../common`)
    }
  }
}

if (errors.length > 0) {
  process.stderr.write(`${errors.join('\n')}\n`)
  failed = true
}
if (failed) process.exit(1)
process.stdout.write(`Validated syntax for ${entries.length} cloud source files.\n`)
