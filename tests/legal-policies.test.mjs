import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { compileLegalBundle, generateLegalBundle } from '../tooling/build-legal-policies.mjs'
import { validateLegalMetadata } from '../tooling/legal-metadata.mjs'

const config = JSON.parse(fs.readFileSync(new URL('../config/project.json', import.meta.url), 'utf8'))
const source = fs.readFileSync(new URL('../docs/product/community-policies.md', import.meta.url), 'utf8')

test('bundled public articles preserve full policy tables and exclude internal authoring notes', () => {
  const bundle = compileLegalBundle(config, source)
  assert.deepEqual(Object.keys(bundle.documents), ['terms', 'privacy', 'rules', 'about'])
  const text = JSON.stringify(bundle)
  assert.match(text, /备案号/)
  assert.match(text, /同意记录/)
  assert.match(text, /最小关闭/)
  assert.match(text, /网络安全日志/)
  assert.match(text, /注销账号/)
  assert.match(text, /不需要等待人工批准/)
  assert.doesNotMatch(text, /可直接使用的短文案|发布时的替换字段|MAIL_PROVIDER|\{\{/)
  assert.equal(bundle.filingNumber, '浙CP备2026058998号-1X')
  assert.equal(bundle.documents.privacy.status, 'draft')
  assert.equal(bundle.documents.privacy.effectiveAt, null)
})

test('policy evidence changes with the actual article or public operator facts and is reproducible', () => {
  const first = compileLegalBundle(config, source)
  assert.deepEqual(compileLegalBundle(config, source.replace(/\n/g, '\r\n')), first)
  const textChange = compileLegalBundle(config, source.replace('用于方便再次搜索', '用于再次搜索').replace('本政策说明', '本政策具体说明'))
  assert.notEqual(textChange.documents.privacy.hash, first.documents.privacy.hash)
  assert.equal(textChange.documents.terms.hash, first.documents.terms.hash)
  const metadataChange = compileLegalBundle({ ...config, legal: { ...config.legal, operatorName: '测试运营者' } }, source)
  assert.notEqual(metadataChange.documents.terms.hash, first.documents.terms.hash)
  assert.throws(() => compileLegalBundle(config, source.replace('{{OPERATOR_NAME}}', '{{SECRET}}')), /Unknown public policy variable/)
  assert.throws(() => compileLegalBundle(config, source.replace('## 2. 隐私政策正文', '## removed')), /Missing or duplicate/)
})

test('unverified facts, malformed metadata and hidden secret keys cannot become active public policies', () => {
  const legal = config.legal
  for (const patch of [
    { status: 'active' }, { status: 'enabled' }, { supportEmail: 'bad' },
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
  assert.throws(() => validateLegalMetadata({ ...ready, operatorName: '郑**' }), /Unverified/)
  assert.throws(() => validateLegalMetadata({ ...ready, filingNumber: legal.filingNumber }), /Filing display/)
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
})
