const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const contractsRoot = path.join(root, 'packages', 'contracts', 'src')
const serverRoot = path.join(root, 'packages', 'server', 'src')
const clientRoot = path.join(root, 'apps', 'miniprogram')
const errors = []

function sourceFiles(directory) {
  const files = []
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (entry.name.endsWith('.ts')) files.push(full)
    }
  }
  visit(directory)
  return files
}

function inspect(files, rule) {
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    rule(file, source)
  }
}

inspect(sourceFiles(contractsRoot), (file, source) => {
  if (/\b(?:wx|process|require)\b/.test(source)) {
    errors.push(`${path.relative(root, file)}: contracts cannot use platform globals`)
  }
  if (/from\s+['"](?:@lynku\/server|.*cloudbase|.*miniprogram)/.test(source)) {
    errors.push(`${path.relative(root, file)}: contracts cannot depend on implementation code`)
  }
})

inspect(sourceFiles(serverRoot), (file, source) => {
  const relative = path.relative(serverRoot, file).replace(/\\/g, '/')
  if (relative.includes('/domain/') && /from\s+['"](?:@lynku\/contracts|.*(?:cloudbase|wx|adapter|platform))/.test(source)) {
    errors.push(`${path.relative(root, file)}: domain cannot depend on contracts or platform adapters`)
  }
  if (/from\s+['"][^'"]+\/src\//.test(source)) {
    errors.push(`${path.relative(root, file)}: use package public exports instead of another package's src path`)
  }
})

function legacyClientScripts(directory) {
  const files = []
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (entry.name.endsWith('.js')) files.push(full)
    }
  }
  visit(directory)
  return files
}

for (const file of legacyClientScripts(clientRoot)) {
  errors.push(`${path.relative(root, file)}: client source must use TypeScript`)
}

inspect(sourceFiles(clientRoot), (file, source) => {
  const relative = path.relative(clientRoot, file).replace(/\\/g, '/')
  if (/\bany\b|as\s+unknown\s+as|@ts-ignore|@ts-expect-error/.test(source)) {
    errors.push(`${path.relative(root, file)}: client source cannot use unchecked TypeScript escape hatches`)
  }
  if (/wx\.cloud\.database|cloud\.database|\.collection\s*\(/.test(source)) {
    errors.push(`${path.relative(root, file)}: client source must access data through typed cloud-function services`)
  }
  if (relative !== 'services/cloud.ts' && /wx\.cloud\.callFunction/.test(source)) {
    errors.push(`${path.relative(root, file)}: client source must call cloud functions through services/cloud.ts`)
  }
})

if (errors.length > 0) {
  process.stderr.write(`${errors.join('\n')}\n`)
  process.exit(1)
}

process.stdout.write('Architecture boundary checks passed.\n')
