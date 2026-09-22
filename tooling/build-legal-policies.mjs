import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { validateLegalMetadata } from './legal-metadata.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const headings = { terms: '1. 用户协议正文', privacy: '2. 隐私政策正文', rules: '3. 社区规范正文' }
const plain = text => text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1（$2）').replace(/\*\*|`/g, '')

function sectionsFromMarkdown(markdown) {
  const sections = []
  let section = { id: 'section-0', heading: '', paragraphs: [] }
  let paragraph = []
  let tableHeader = null
  const flushParagraph = () => {
    if (paragraph.length) section.paragraphs.push(plain(paragraph.join('\n')))
    paragraph = []
  }
  const flushSection = () => {
    flushParagraph()
    if (section.heading || section.paragraphs.length) sections.push(section)
    section = { id: `section-${sections.length}`, heading: '', paragraphs: [] }
  }
  for (const line of markdown.split('\n')) {
    if (/^###\s/.test(line) || /^\*\*[^*]+\*\*$/.test(line)) {
      flushSection()
      section.heading = plain(line.replace(/^###\s+/, ''))
      tableHeader = null
    } else if (line.startsWith('|')) {
      flushParagraph()
      const cells = line.split('|').slice(1, -1).map(cell => plain(cell.trim()))
      if (!tableHeader) tableHeader = cells
      else if (!cells.every(cell => /^:?-+:?$/.test(cell))) {
        section.paragraphs.push(cells.map((cell, index) => `${tableHeader[index] || ''}：${cell}`).join('\n'))
      }
    } else if (!line.trim()) {
      flushParagraph()
    } else {
      tableHeader = null
      paragraph.push(line)
    }
  }
  flushSection()
  return sections
}

/** Pure compilation: only the three public articles are bundled, never authoring notes. */
export function compileLegalBundle(config, source) {
  const legal = validateLegalMetadata(config.legal)
  const variables = {
    APP_NAME: config.name, SUPPORT_EMAIL: legal.supportEmail,
    EFFECTIVE_DATE: legal.effectiveAt, UPDATED_DATE: legal.updatedAt,
    TERMS_VERSION: legal.termsVersion, PRIVACY_VERSION: legal.privacyVersion, RULES_VERSION: legal.rulesVersion,
    THIRD_PARTY_VERSION: legal.thirdPartyVersion,
  }
  const documents = {}
  const normalized = source.replace(/\r\n/g, '\n')
  for (const [kind, heading] of Object.entries(headings)) {
    const marker = `## ${heading}\n`
    const start = normalized.indexOf(marker)
    if (start < 0 || normalized.indexOf(marker, start + marker.length) >= 0) throw new Error(`Missing or duplicate legal article: ${kind}`)
    const next = normalized.indexOf('\n## ', start + marker.length)
    const markdown = normalized.slice(start + marker.length, next < 0 ? undefined : next).trim()
      .replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
        if (!Object.hasOwn(variables, key)) throw new Error(`Unknown public policy variable: ${key}`)
        if (variables[key] === null) throw new Error(`Missing public policy variable: ${key}`)
        return variables[key]
      })
    if (markdown.includes('{{')) throw new Error('Unresolved policy template')
    const sections = sectionsFromMarkdown(markdown)
    if (!sections.length || !sections.some(section => section.paragraphs.length)) throw new Error(`Empty legal article: ${kind}`)
    const version = legal[`${kind}Version`]
    const body = { kind, version, status: legal.status, updatedAt: legal.updatedAt, effectiveAt: legal.effectiveAt, sections }
    documents[kind] = { ...body, title: sections[0].heading, hash: createHash('sha256').update(JSON.stringify(body)).digest('hex') }
  }
  const sections = [{ id: 'about', heading: config.name, paragraphs: [
    '面向 UNNC 的校园交流社区，分享校园日常，交流想法与经验。',
    'LynkU 独立运营，非宁波诺丁汉大学官方服务。',
  ] }]
  const about = { kind: 'about', title: `关于 ${config.name}`, version: legal.thirdPartyVersion,
    status: legal.status, updatedAt: legal.updatedAt, effectiveAt: legal.effectiveAt, sections }
  documents.about = { ...about, hash: createHash('sha256').update(JSON.stringify(about)).digest('hex') }
  return { appName: config.name, supportEmail: legal.supportEmail, filingNumber: legal.filingNumberVerified ? legal.filingNumber : '',
    filingNumberVerified: legal.filingNumberVerified, documents }
}

export function generateLegalBundle(directory = root, checkOnly = false) {
  const config = JSON.parse(fs.readFileSync(path.join(directory, 'config/project.json'), 'utf8'))
  const bundle = compileLegalBundle(config, fs.readFileSync(path.join(directory, 'docs/product/community-policies.md'), 'utf8'))
  const manifest = Object.fromEntries(Object.entries(bundle.documents).map(([kind, doc]) => [kind, {
    version: doc.version, hash: doc.hash, status: doc.status, effectiveAt: doc.effectiveAt,
  }]))
  const outputs = [
    ['apps/admin/src/generated/legal-policies.ts', '// Generated from config/project.json and community-policies.md. Do not edit.\n'
      + "import type { LegalBundle } from '@lynku/contracts'\n" + `export const legalPolicies: LegalBundle = ${JSON.stringify(bundle, null, 2)}\n`],
    ['apps/miniprogram/generated/legal-policies.ts', '// Generated from config/project.json and community-policies.md.\n'
      + "import type { LegalBundle } from './contracts/index'\n" + `export const legalPolicies: LegalBundle = ${JSON.stringify(bundle, null, 2)}\n`],
    ['dist/legal/manifest.json', JSON.stringify(manifest, null, 2) + '\n'],
    ['apps/cloudfunctions/common/generated/legal-manifest.ts', '// Generated from the same source as the offline policy pages.\n'
      + `export const legalManifest = ${JSON.stringify(manifest, null, 2)} as const\n`],
  ]
  for (const [relative, content] of outputs) {
    const file = path.join(directory, relative)
    if (checkOnly) {
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== content) throw new Error(`Legal policy artifact drift: ${relative}`)
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, content)
    }
  }
  return bundle
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateLegalBundle(root, process.argv.includes('--check'))
  console.log('Public legal documents and matching manifest verified.')
}
