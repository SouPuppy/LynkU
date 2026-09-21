import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { cruise } from 'dependency-cruiser'
import ts from 'typescript'
import { createArchitectureConfig, sourceAliases, sourceRoots } from './config.mjs'

function sourceFiles(root, directories) {
  const result = []
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name)
      if (entry.isDirectory() && !['node_modules', 'dist'].includes(entry.name)) visit(filename)
      else if (entry.isFile() && /\.[cm]?[jt]s$/.test(entry.name) && !entry.name.endsWith('.d.ts')) result.push(filename)
    }
  }
  for (const directory of directories) visit(path.join(root, directory))
  return result
}

function forbiddenGlobals(root, directories) {
  const violations = []
  for (const filename of sourceFiles(root, directories)) {
    const relative = path.relative(root, filename).replaceAll('\\', '/')
    if (!/^packages\/(?:contracts|server)\/src\//.test(relative)
      && !/^(?:apps\/)?miniprogram\/(?:features\/|subpkg-[^/]+\/features\/)/.test(relative)) continue
    const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true)
    const visit = node => {
      if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression)
        && node.expression.text === 'globalThis' && ts.isStringLiteral(node.argumentExpression)
        && ['wx', 'getApp', 'process', 'require'].includes(node.argumentExpression.text)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart())
        violations.push({ rule: { name: 'no-platform-globals', severity: 'error' }, from: `${relative}:${line + 1}`, to: node.argumentExpression.text })
      }
      if (ts.isIdentifier(node) && ['wx', 'getApp', 'process', 'require'].includes(node.text)) {
        const parent = node.parent
        const isPropertyName = (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)
          || ts.isMethodSignature(parent)) && parent.name === node
        if (!isPropertyName) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart())
          violations.push({ rule: { name: 'no-platform-globals', severity: 'error' }, from: `${relative}:${line + 1}`, to: node.text })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return violations
}

export async function checkArchitecture(root) {
  const directories = sourceRoots(root)
  if (directories.length === 0) throw new Error(`No application sources found below ${root}`)
  const configuration = createArchitectureConfig(root)
  const result = await cruise(directories, {
    ...configuration.options, ruleSet: { forbidden: configuration.forbidden },
    validate: true, outputType: 'json',
  }, { alias: sourceAliases(root), bustTheCache: true })
  const graph = typeof result.output === 'string' ? JSON.parse(result.output) : result.output
  const violations = [...graph.summary.violations, ...forbiddenGlobals(root, directories)]
  return { violations, moduleCount: graph.modules.length }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await checkArchitecture(path.resolve(process.argv[2] || '.'))
    if (result.violations.length > 0) {
      for (const violation of result.violations) {
        process.stderr.write(`${violation.rule.name}: ${violation.from} → ${violation.to}\n`)
      }
      process.exitCode = 1
    } else {
      process.stdout.write(`Dependency graph and platform boundaries passed (${result.moduleCount} modules).\n`)
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    process.exitCode = 1
  }
}
