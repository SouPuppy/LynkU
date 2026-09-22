export type LegalDocumentKind = 'terms' | 'privacy' | 'rules' | 'about'
export interface LegalSection {
  id: string
  heading: string
  paragraphs: string[]
}
export interface LegalDocument {
  kind: LegalDocumentKind
  title: string
  version: string
  status: 'draft' | 'active'
  updatedAt: string | null
  effectiveAt: string | null
  hash: string
  sections: LegalSection[]
}
export interface LegalBundle {
  appName: string
  supportEmail: string
  filingNumber: string
  filingNumberVerified: boolean
  documents: Record<LegalDocumentKind, LegalDocument>
}

export function legalDocumentKind(value: unknown): LegalDocumentKind | null {
  return value === 'terms' || value === 'privacy' || value === 'rules' || value === 'about' ? value : null
}

export type LegalManifest = Record<LegalDocumentKind, Pick<LegalDocument, 'version' | 'hash' | 'status' | 'effectiveAt'>>
export function parseLegalManifest(value: unknown): LegalManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid legal manifest')
  const input = value as Record<string, unknown>
  const parse = (kind: LegalDocumentKind): LegalManifest[LegalDocumentKind] => {
    const item = input[kind]
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw Error('Missing legal document')
    const row = item as Record<string, unknown>
    if (typeof row.version !== 'string' || !row.version || row.version.length > 64
      || typeof row.hash !== 'string' || !/^[a-f0-9]{64}$/.test(row.hash)
      || (row.status !== 'draft' && row.status !== 'active')
      || (row.effectiveAt !== null && (typeof row.effectiveAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.effectiveAt)
        || !Number.isFinite(Date.parse(row.effectiveAt)) || new Date(row.effectiveAt).toISOString().slice(0, 10) !== row.effectiveAt))) throw Error('Invalid legal document')
    return { version: row.version, hash: row.hash, status: row.status, effectiveAt: row.effectiveAt }
  }
  return { terms: parse('terms'), privacy: parse('privacy'), rules: parse('rules'), about: parse('about') }
}
