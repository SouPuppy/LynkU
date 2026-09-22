import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { createRequire } from 'node:module'
import { compileLegalBundle, generateLegalBundle } from '../tooling/build-legal-policies.mjs'
import { validateLegalMetadata } from '../tooling/legal-metadata.mjs'
import { parseLegalManifest } from '@lynku/contracts'

const config = JSON.parse(fs.readFileSync(new URL('../config/project.json', import.meta.url), 'utf8'))
const source = fs.readFileSync(new URL('../docs/product/community-policies.md', import.meta.url), 'utf8')

test('about navigation opens a child document and never copies contact data or records agreement', () => {
  const navigations = [], require = createRequire(import.meta.url)
  let page
  const code = ts.transpileModule(fs.readFileSync(new URL('../apps/miniprogram/pages/legal/legal.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  vm.runInNewContext(code, {
    exports: {},
    require: name => {
      if (name.endsWith('/contracts/index')) return require('@lynku/contracts')
      if (name.endsWith('/legal-policies')) return { legalPolicies: compileLegalBundle(config, source) }
      if (name.endsWith('/version')) return { APP_VERSION: '0.2.0' }
      throw new Error(`Unexpected page dependency: ${name}`)
    },
    wx: { navigateTo: options => navigations.push(options.url) },
    Page: definition => { page = definition; page.setData = change => Object.assign(page.data, change) },
  })
  page.onLoad({})
  assert.equal(page.data.document.kind, 'about')
  assert.equal(page.data.supportEmail, 'quin@asro.cc')
  assert.equal(page.data.filingNumber, '')
  for (const kind of ['terms', 'privacy', 'rules', 'about', 'invalid']) page.openDocument({ currentTarget: { dataset: { kind } } })
  assert.deepEqual(navigations, ['terms', 'privacy', 'rules'].map(kind => `/pages/legal/legal?kind=${kind}`))
  page.onLoad({ kind: 'privacy' })
  assert.equal(page.data.title, 'LynkU 隐私政策')
  assert.equal(page.copyContact, undefined)
  assert.equal(page.copyFiling, undefined)
  assert.equal(page.acceptAgreement, undefined)
  page.onLoad({ kind: 'invalid' })
  assert.ok(page.data.error)
})

test('public articles describe current services without private identity, placeholders or future screens', () => {
  const bundle = compileLegalBundle(config, source)
  assert.deepEqual(Object.keys(bundle.documents), ['terms', 'privacy', 'rules', 'about'])
  const text = JSON.stringify(bundle)
  assert.match(text, /quin@asro.cc/)
  assert.match(text, /Mailgun/)
  assert.match(text, /美国区域接口/)
  assert.match(text, /注销账号/)
  assert.match(text, /不需要等待人工批准/)
  assert.doesNotMatch(text, /zihannuo|outlook|尚待|待核实|草案|个人信息与同意|保护模式|内部保留规则|最小关闭|MAIL_PROVIDER|\{\{|\uFFFD/)
  assert.equal(bundle.filingNumber, '')
  assert.equal(bundle.documents.privacy.status, 'active')
  assert.equal(bundle.documents.privacy.effectiveAt, '2026-09-22')
  const privateMetadata = compileLegalBundle({ ...config, legal: { ...config.legal, operatorName: 'PRIVATE_OPERATOR',
    mailProviderName: 'PRIVATE_PROVIDER' } }, source)
  assert.doesNotMatch(JSON.stringify(privateMetadata), /PRIVATE_OPERATOR|PRIVATE_PROVIDER/)
})

test('policy evidence changes with the actual article or public operator facts and is reproducible', () => {
  const first = compileLegalBundle(config, source)
  assert.deepEqual(compileLegalBundle(config, source.replace(/\n/g, '\r\n')), first)
  const textChange = compileLegalBundle(config, source.replace('用于方便再次搜索', '用于再次搜索').replace('本政策说明', '本政策具体说明'))
  assert.notEqual(textChange.documents.privacy.hash, first.documents.privacy.hash)
  assert.equal(textChange.documents.terms.hash, first.documents.terms.hash)
  const metadataChange = compileLegalBundle({ ...config, legal: { ...config.legal, supportEmail: 'support@example.com' } }, source)
  assert.notEqual(metadataChange.documents.terms.hash, first.documents.terms.hash)
  assert.throws(() => compileLegalBundle(config, source.replace('{{SUPPORT_EMAIL}}', '{{SECRET}}')), /Unknown public policy variable/)
  assert.throws(() => compileLegalBundle(config, source.replace('{{SUPPORT_EMAIL}}', '{{OPERATOR_NAME}}')), /Unknown public policy variable/)
  assert.throws(() => compileLegalBundle(config, source.replace('## 2. 隐私政策正文', '## removed')), /Missing or duplicate/)
})

test('formal articles require real dates and contact; optional facts are omitted rather than invented', () => {
  const legal = config.legal
  for (const patch of [
    { effectiveAt: null }, { updatedAt: null }, { status: 'enabled' }, { supportEmail: 'bad' },
    { mailPrivacyUrl: 'javascript:alert(1)' }, { mailPrivacyUrl: 'https://secret@example.com/' },
    { updatedAt: '2026-02-30' }, { updatedAt: '2026-10-01', effectiveAt: '2026-09-21' },
    { operatorName: '<script>' }, { MAILGUN_API_KEY: 'fixture-secret' }, { filingNumberVerified: 'true' },
  ]) assert.throws(() => validateLegalMetadata({ ...legal, ...patch }))
  const ready = { ...legal, status: 'active', operatorName: '测试运营者', filingNumber: '浙ICP备2026058998号-1X',
    filingNumberVerified: true, updatedAt: '2026-09-21', effectiveAt: '2026-09-21',
    wechatProviderName: '测试微信服务方', wechatPrivacyUrl: 'https://example.com/wechat',
    cloudProviderName: '测试云服务方', cloudPrivacyUrl: 'https://example.com/cloud', cloudRegion: '测试地区',
    mailProviderName: '测试邮件服务方' }
  assert.doesNotThrow(() => validateLegalMetadata(ready))
  assert.doesNotThrow(() => validateLegalMetadata(legal))
  assert.throws(() => validateLegalMetadata({ ...ready, termsVersion: '待核实' }), /Unverified/)
  assert.throws(() => validateLegalMetadata({ ...ready, filingNumber: legal.filingNumber }), /Filing display/)
  assert.equal(compileLegalBundle({ ...config, legal: ready }, source).filingNumber, ready.filingNumber)
})

test('client articles and server version manifest use identical hashes; check mode never repairs drift', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lynku-legal-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.mkdirSync(path.join(directory, 'config'), { recursive: true })
  fs.mkdirSync(path.join(directory, 'docs/product'), { recursive: true })
  fs.writeFileSync(path.join(directory, 'config/project.json'), JSON.stringify(config))
  fs.writeFileSync(path.join(directory, 'docs/product/community-policies.md'), source)
  const bundle = generateLegalBundle(directory)
  assert.doesNotThrow(() => generateLegalBundle(directory, true))
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'dist/legal/manifest.json'), 'utf8'))
  for (const kind of Object.keys(bundle.documents)) assert.equal(manifest[kind].hash, bundle.documents[kind].hash)
  const file = path.join(directory, 'apps/miniprogram/generated/legal-policies.ts')
  fs.writeFileSync(file, 'tampered')
  assert.throws(() => generateLegalBundle(directory, true), /drift/)
  assert.equal(fs.readFileSync(file, 'utf8'), 'tampered')
  generateLegalBundle(directory)
  const adminFile = path.join(directory, 'apps/admin/src/generated/legal-policies.ts')
  assert.match(fs.readFileSync(adminFile, 'utf8'), new RegExp(bundle.documents.privacy.hash))
  fs.writeFileSync(adminFile, 'independent admin copy')
  assert.throws(() => generateLegalBundle(directory, true), /drift/)
  assert.equal(fs.readFileSync(adminFile, 'utf8'), 'independent admin copy')
})

test('admin manifest boundary rejects incomplete releases and impossible dates, projecting only public metadata', () => {
  const bundle = compileLegalBundle(config, source)
  const manifest = Object.fromEntries(Object.entries(bundle.documents).map(([kind, doc]) => [kind, {
    version: doc.version, hash: doc.hash, status: doc.status, effectiveAt: doc.effectiveAt,
  }]))
  assert.deepEqual(parseLegalManifest(manifest), manifest)
  assert.deepEqual(parseLegalManifest({ ...manifest, secret: 'not-public', terms: { ...manifest.terms, secret: 'not-public' } }), manifest)
  for (const patch of [{ privacy: null }, { privacy: { ...manifest.privacy, hash: 'bad' } },
    { privacy: { ...manifest.privacy, effectiveAt: '2026-02-30' } }, { privacy: { ...manifest.privacy, status: 'published' } }]) {
    assert.throws(() => parseLegalManifest({ ...manifest, ...patch }))
  }
})
