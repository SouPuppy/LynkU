// These miniature source trees are written into an isolated temporary directory by
// the test. The production checker parses and resolves them exactly like real code.
export const validArchitecture = {
  'packages/contracts/src/index.ts': 'export interface View { title: string }',
  'packages/server/src/content/index.ts': "export { publish } from './publish'",
  'packages/server/src/content/publish.ts': "import type { View } from '@lucky/contracts'; export function publish(value: View): string { return value.title }",
  'packages/server/src/workflows/index.ts': "export { publish } from '../content'",
  'packages/server/src/index.ts': "export * from './content'; export * from './workflows'",
  'packages/adapters/src/index.ts': "import { publish } from '@lucky/server'; export const adapter = publish",
  'apps/miniprogram/generated/contracts/index.ts': 'export interface View { title: string }',
  'apps/miniprogram/features/editor/index.ts': "import type { View } from '../../generated/contracts'; export function title(value: View): string { return value.title }",
  'apps/miniprogram/platform/storage.ts': 'export const storage = { save(value: string) { return value } }',
  'apps/miniprogram/composition/editor.ts': "import { title } from '../features/editor'; import { storage } from '../platform/storage'; export const editor = { title, storage }",
  'apps/miniprogram/subpkg-chat/features/thread/index.ts': "export function label(value: string) { return value }",
}

export const violations = [
  {
    name: 'runtime CommonJS cycles', rule: 'no-circular-dependencies',
    files: {
      'apps/cloudfunctions/a/index.js': "module.exports = require('../b')",
      'apps/cloudfunctions/b/index.js': "module.exports = require('../a')",
    },
  },
  {
    name: 'type-only TypeScript cycles', rule: 'no-circular-dependencies',
    files: {
      'packages/contracts/src/a.ts': "import type { B } from './b'; export interface A { peer: B }",
      'packages/contracts/src/b.ts': "import type { A } from './a'; export interface B { peer: A }",
    },
  },
  {
    name: 'contracts importing server through a package alias', rule: 'contracts-are-platform-independent',
    files: {
      'packages/contracts/src/invalid.ts': "import { publish } from '@lucky/server'; export const invalid = publish",
    },
  },
  {
    name: 'server importing an adapter through a package alias', rule: 'server-does-not-import-platform',
    files: {
      'packages/server/src/content/invalid.ts': "import { adapter } from '@lucky/adapters'; export const invalid = adapter",
    },
  },
  {
    name: 'server importing the CloudBase SDK', rule: 'server-does-not-import-platform',
    files: {
      'packages/server/src/content/invalid.ts': "import sdk from 'wx-server-sdk'; export const invalid = sdk",
    },
  },
  {
    name: 'server importing Node infrastructure', rule: 'server-does-not-import-node',
    files: {
      'packages/server/src/content/invalid.ts': "import { readFileSync } from 'node:fs'; export const invalid = readFileSync",
    },
  },
  {
    name: 'server importing an installed SDK', rule: 'server-does-not-import-platform',
    files: {
      'packages/server/src/content/invalid.ts': "import sdk from 'wx-server-sdk'; export const invalid = sdk",
      'node_modules/wx-server-sdk/package.json': '{"name":"wx-server-sdk","main":"index.js"}',
      'node_modules/wx-server-sdk/index.js': 'module.exports = {}',
    },
  },
  {
    name: 'workflow importing business internals', rule: 'server-content-public-entry',
    files: {
      'packages/server/src/workflows/invalid.ts': "import { publish } from '../content/publish'; export const invalid = publish",
    },
  },
  {
    name: 'business modules importing peer services', rule: 'server-messaging-does-not-import-peer-services',
    files: {
      'packages/server/src/messaging/index.ts': "export { publish } from '../content'",
    },
  },
  {
    name: 'main-package re-exports of chat implementation', rule: 'main-package-does-not-import-chat',
    files: {
      'apps/miniprogram/pages/home.ts': "export { label } from '../subpkg-chat/features/thread'",
    },
  },
  {
    name: 'feature dynamic imports of a platform adapter', rule: 'features-use-injected-platform',
    files: {
      'apps/miniprogram/features/editor/invalid.ts': "export function load() { return import('../../platform/storage') }",
    },
  },
  {
    name: 'feature imports of existing platform services', rule: 'features-use-injected-platform',
    files: {
      'apps/miniprogram/services/storage.ts': 'export const storage = {}',
      'apps/miniprogram/features/editor/invalid.ts': "export { storage } from '../../services/storage'",
    },
  },
  {
    name: 'chat features accessing wx globals', rule: 'no-platform-globals',
    files: {
      'apps/miniprogram/subpkg-chat/features/thread/invalid.ts': "export function load() { return wx.getStorageSync('thread') }",
    },
  },
  {
    name: 'chat features importing their own platform adapter', rule: 'features-use-injected-platform',
    files: {
      'apps/miniprogram/subpkg-chat/platform/storage.ts': 'export const storage = {}',
      'apps/miniprogram/subpkg-chat/features/thread/invalid.ts': "export { storage } from '../../platform/storage'",
    },
  },
  {
    name: 'computed globalThis platform access', rule: 'no-platform-globals',
    files: {
      'apps/miniprogram/features/editor/invalid.ts': "export const invalid = globalThis['wx']",
    },
  },
  {
    name: 'contracts accessing environment variables', rule: 'no-platform-globals',
    files: {
      'packages/contracts/src/invalid.ts': 'export const environment = process.env.NODE_ENV',
    },
  },
  {
    name: 'domains importing API DTOs', rule: 'domain-does-not-import-contracts',
    files: {
      'packages/server/src/content/domain/invalid.ts': "import type { View } from '@lucky/contracts'; export type Invalid = View",
    },
  },
  {
    name: 'deep imports of contracts implementation', rule: 'packages-use-contracts-public-entry',
    files: {
      'packages/contracts/src/internal.ts': 'export const internal = 1',
      'packages/server/src/content/invalid.ts': "export { internal } from '../../../contracts/src/internal'",
    },
  },
  {
    name: 'client type-only imports of server code', rule: 'client-does-not-import-server',
    files: {
      'apps/miniprogram/pages/invalid.ts': "import type { publish } from '@lucky/server'; export type Invalid = typeof publish",
    },
  },
  {
    name: 'declaration-file paths into a chat subpackage', rule: 'main-package-does-not-import-chat',
    files: {
      'apps/miniprogram/subpkg-chat/private.d.ts': 'export interface Thread { id: string }',
      'apps/miniprogram/pages/invalid.ts': "import type { Thread } from '../subpkg-chat/private'; export type Invalid = Thread",
    },
  },
  {
    name: 'imports of stale compiled package code', rule: 'source-does-not-import-build-output',
    files: {
      'packages/server/dist/index.js': 'module.exports = {}',
      'apps/miniprogram/pages/invalid.ts': "import server from '../../../packages/server/dist'; export const invalid = server",
    },
  },
  {
    name: 'unresolved source dependencies', rule: 'no-unresolved-imports',
    files: {
      'apps/miniprogram/pages/invalid.ts': "export { missing } from '../does-not-exist'",
    },
  },
]
