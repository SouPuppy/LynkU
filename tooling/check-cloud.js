const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const functionsRoot = path.join(root, 'apps', 'cloudfunctions')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'cloudbaserc.json'), 'utf8'))
for (const name of ['common', ...manifest.functions.map(entry => entry.name)]) {
  if (!fs.existsSync(path.join(functionsRoot, name, 'index.ts'))) throw Error(`Missing TypeScript cloud entry: ${name}`)
}
const configPath = path.join(functionsRoot, 'tsconfig.json')
const config = ts.readConfigFile(configPath, ts.sys.readFile)
if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, functionsRoot)
if (parsed.options.strict !== true) throw Error('Cloud source validation requires strict TypeScript')
const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true })
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)]
if (diagnostics.length) {
  process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => root,
    getCanonicalFileName: file => file,
    getNewLine: () => '\n',
  }))
  process.exitCode = 1
} else {
  process.stdout.write(`Validated cloud TypeScript, imports and types (${parsed.fileNames.length} sources).\n`)
}
