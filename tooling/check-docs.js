const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const documentedFiles = [
  'README.md',
  'AGENTS.md',
  'docs/README.md',
  'docs/DEVELOPMENT.md',
  'docs/DEMO.md',
  'docs/architecture/decisions/002-lynku-cutover.md',
  'docs/architecture/decisions/001-project-structure.md',
  'docs/architecture/target-architecture.md',
  'docs/architecture/module-boundaries.md',
  'docs/architecture/contracts-and-data.md',
  'docs/product/behavior-contract.md',
  'docs/governance/documentation.md',
  'docs/governance/engineering-standards.md',
  'docs/governance/quality-gates.md',
  'docs/runbooks/release-and-operations.md',
  'docs/plans/refactor/plan.md',
  'docs/plans/refactor/status.md',
  'docs/plans/refactor/goal-prompt.md',
]
const errors = []

for (const relative of documentedFiles) {
  const file = path.join(root, relative)
  if (!fs.existsSync(file)) {
    errors.push(`Missing documentation file: ${relative}`)
    continue
  }
  const source = fs.readFileSync(file, 'utf8')
  if (source.split(/\r?\n/).filter(line => /^```/.test(line)).length % 2 !== 0) {
    errors.push(`Unclosed code fence: ${relative}`)
  }
  for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0]
    if (!target || /^(?:https?:|mailto:)/.test(target)) continue
    if (!fs.existsSync(path.resolve(path.dirname(file), target))) {
      errors.push(`Broken documentation link: ${relative} -> ${target}`)
    }
  }
}

if (errors.length > 0) {
  process.stderr.write(`${errors.join('\n')}\n`)
  process.exit(1)
}

process.stdout.write('Documentation checks passed.\n')
