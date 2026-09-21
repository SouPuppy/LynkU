import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

const client = '^(?:apps/)?miniprogram/'
const functions = '^(?:apps/)?cloudfunctions/'
const server = '^packages/server/src/'
const contracts = '^packages/contracts/src/'
const features = `${client}(?:features/|subpkg-[^/]+/features/)`
const platform = '(?:^|/)(?:wx-server-sdk|@cloudbase/[^/]+)(?:/|$)'
const rule = (name, from, to, comment) => ({ name, severity: 'error', from, to, comment })

export function createArchitectureConfig(root) {
  const moduleRoot = path.join(root, 'packages/server/src')
  const modules = existsSync(moduleRoot)
    ? readdirSync(moduleRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
    : []
  const forbidden = [
    rule('no-circular-dependencies', {}, { circular: true }, 'Runtime and type-only imports must form an acyclic graph.'),
    // The SDK is installed inside each independent deployment artifact, not in the source tree.
    // The bundle build owns its exact SDK declaration; artifact checks exercise
    // independent loading. Actual SDK installation remains a deployment check.
    rule('no-unresolved-imports', { pathNot: functions }, { couldNotResolve: true }, 'A missing source dependency must fail the architecture check.'),
    rule('cloud-functions-resolve-imports', { path: functions }, { couldNotResolve: true, pathNot: '^wx-server-sdk$' }, 'Only the independently installed deployment SDK may be absent from function sources.'),
    rule('source-does-not-import-build-output', {}, { path: '^packages/[^/]+/dist/' }, 'Source analysis resolves workspace public exports to source, never stale build output.'),
    rule('contracts-are-platform-independent', { path: contracts }, { pathNot: contracts }, 'Shared DTOs cannot depend on applications, server code, adapters, Node or SDKs.'),
    rule('server-does-not-import-platform', { path: server }, { path: [client, functions, '^packages/adapters/', platform] }, 'Application rules receive infrastructure through ports.'),
    rule('server-does-not-import-node', { path: server }, { dependencyTypes: ['core'] }, 'Node facilities belong in adapters, not business rules.'),
    rule('client-does-not-import-server', { path: client }, { path: [server, '^packages/adapters/', functions, platform] }, 'Server implementation and SDKs cannot enter the miniprogram.'),
    rule('main-package-does-not-import-chat', { path: client, pathNot: `${client}subpkg-chat/` }, { path: `${client}subpkg-chat/` }, 'Keep chat implementation inside its WeChat subpackage.'),
    rule('features-use-injected-platform', { path: features }, { path: [
      `${client}(?:platform|composition|services|pages|components|utils)/`,
      `${client}subpkg-[^/]+/(?:platform|composition|services|pages|components|utils)/`,
      `${client}(?:app|config)\\.ts$`,
    ] }, 'Migrated features use ports; existing services remain an explicit migration area.'),
    rule('features-do-not-import-sdk-or-node', { path: features }, { path: platform }, 'Features cannot create SDK clients.'),
    rule('features-do-not-import-node', { path: features }, { dependencyTypes: ['core'] }, 'Client features must stay platform-independent.'),
    rule('domain-does-not-import-contracts', { path: `${server}[^/]+/domain/` }, { path: contracts }, 'Domain models and API DTOs are separate.'),
    rule('packages-use-contracts-public-entry', { pathNot: contracts }, { path: contracts, pathNot: `${contracts}index\\.ts$` }, 'Other packages consume the contracts public export.'),
  ]

  for (const name of modules) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const own = `${server}${escaped}/`
    forbidden.push(rule(`server-${name}-public-entry`, { pathNot: own }, { path: own, pathNot: `${own}index\\.ts$` }, 'Access another business module through its explicit public index.'))
    if (name !== 'workflows' && name !== 'shared') {
      forbidden.push(rule(`server-${name}-does-not-import-peer-services`, { path: own }, {
        path: `${server}[^/]+/`, pathNot: [own, `${server}shared/`],
      }, 'Cross-module orchestration belongs in workflows; business modules declare narrow ports.'))
    }
  }

  return {
    forbidden,
    options: {
      baseDir: root,
      // Keep the edge to installed packages in the graph so SDK boundaries cannot
      // disappear after npm install. Only their internal trees are left unvisited.
      doNotFollow: { path: '(?:^|/)(?:node_modules|dist)(?:/|$)' },
      tsPreCompilationDeps: true,
      moduleSystems: ['es6', 'cjs', 'tsd'],
    },
  }
}

export function sourceRoots(root) {
  return ['apps/miniprogram', 'miniprogram', 'apps/cloudfunctions', 'cloudfunctions',
    'packages/contracts/src', 'packages/server/src', 'packages/adapters/src']
    .filter(directory => existsSync(path.join(root, directory)))
}

export function sourceAliases(root) {
  return Object.fromEntries(['contracts', 'server', 'adapters']
    .filter(name => existsSync(path.join(root, `packages/${name}/src/index.ts`)))
    .map(name => [`@lucky/${name}$`, path.join(root, `packages/${name}/src/index.ts`)]))
}
