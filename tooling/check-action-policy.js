const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { require: requireTypeScript } = require('tsx/cjs/api')

const root = path.resolve(__dirname, '..')
const { ACTION_ACCESS } = requireTypeScript(path.join(root, 'apps', 'cloudfunctions', 'common', 'index.ts'), __filename)
const errors = []

for (const [functionName, actions] of Object.entries(ACTION_ACCESS)) {
  const sourcePath = path.join(root, 'apps', 'cloudfunctions', functionName, 'index.ts')
  if (!fs.existsSync(sourcePath)) {
    errors.push(`Action policy references missing cloud function: ${functionName}`)
    continue
  }
  const source = fs.readFileSync(sourcePath, 'utf8')
  const exposed = new Set()
  const syntax = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true)
  function visit(node) {
    if (ts.isSwitchStatement(node)) {
      const expression = node.expression
      const isAction = ts.isIdentifier(expression) && expression.text === 'action'
        || ts.isPropertyAccessExpression(expression) && expression.name.text === 'action'
      if (isAction) for (const clause of node.caseBlock.clauses) {
        if (ts.isCaseClause(clause) && ts.isStringLiteral(clause.expression)) exposed.add(clause.expression.text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(syntax)
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
