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
