const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../apps/miniprogram')
const failures = []
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) { walk(file); continue }
    if (!file.endsWith('.ts') || file.endsWith('.d.ts')) continue
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    for (const node of source.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue
      const specifier = node.moduleSpecifier
      if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('.')) continue
      const target = path.resolve(path.dirname(file), specifier.text)
      const fileExists = ['', '.ts', '.js', '.json', '.wxs'].some(extension => fs.existsSync(target + extension) && fs.statSync(target + extension).isFile())
      if (!fileExists && fs.existsSync(target) && fs.statSync(target).isDirectory()) failures.push(`${path.relative(root, file)}: ${specifier.text} requires an explicit /index file for WeChat`)
    }
  }
}
walk(root)
if (failures.length) { process.stderr.write(failures.join('\n') + '\n'); process.exitCode = 1 }
else console.log('WeChat relative imports use explicit files.')
