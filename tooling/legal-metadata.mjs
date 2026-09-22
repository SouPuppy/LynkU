// Public policy metadata has one source: config/project.json.
export const LEGAL_KEYS = [
  'status', 'operatorName', 'supportEmail', 'filingNumber', 'filingNumberVerified',
  'termsVersion', 'privacyVersion', 'rulesVersion', 'thirdPartyVersion', 'updatedAt', 'effectiveAt',
  'wechatProviderName', 'wechatPrivacyUrl', 'cloudProviderName', 'cloudPrivacyUrl', 'cloudRegion',
  'mailProviderName', 'mailPrivacyContact', 'mailPrivacyUrl',
]

export function validateLegalMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !LEGAL_KEYS.includes(key))
    || LEGAL_KEYS.some(key => !Object.hasOwn(value, key))) throw new Error('Invalid public legal metadata keys')
  if (!['draft', 'active'].includes(value.status)) throw new Error('Invalid policy status')
  if (typeof value.filingNumberVerified !== 'boolean') throw new Error('Invalid filing verification flag')
  for (const key of LEGAL_KEYS.filter(key => !['status', 'filingNumberVerified'].includes(key))) {
    if (value[key] === null && !['supportEmail', 'filingNumber', 'termsVersion', 'privacyVersion', 'rulesVersion', 'thirdPartyVersion'].includes(key)) continue
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key] !== value[key].trim()
      || value[key].length > 300 || /[\x00-\x1f<>]/.test(value[key])) throw new Error(`Invalid legal field: ${key}`)
  }
  for (const key of ['supportEmail', 'mailPrivacyContact']) {
    if (value[key] !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value[key])) throw new Error(`Invalid legal email: ${key}`)
  }
  for (const key of ['wechatPrivacyUrl', 'cloudPrivacyUrl', 'mailPrivacyUrl']) {
    if (value[key] === null) continue
    const url = new URL(value[key])
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`Invalid legal URL: ${key}`)
  }
  for (const key of ['updatedAt', 'effectiveAt']) {
    if (value[key] === null) continue
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value[key]) || new Date(`${value[key]}T00:00:00.000Z`).toISOString().slice(0, 10) !== value[key]) {
      throw new Error(`Invalid policy date: ${key}`)
    }
  }
  if (value.updatedAt && value.effectiveAt && value.updatedAt > value.effectiveAt) throw new Error('Policy update follows effective date')
  if (value.status === 'active') assertLegalMetadataReady(value)
  return value
}

export function assertLegalMetadataReady(value) {
  // Public articles can be finalized without publishing optional personal or unverified metadata.
  const unresolved = ['supportEmail', 'termsVersion', 'privacyVersion', 'rulesVersion', 'updatedAt', 'effectiveAt']
    .filter(key => value[key] === null || (typeof value[key] === 'string' && /\*|待填|待核|尚待|\{\{/.test(value[key])))
  if (unresolved.length) throw new Error(`Unverified policy facts: ${unresolved.join(', ')}`)
  if (value.filingNumberVerified && !/^[\u4e00-\u9fff]ICP备\d{8,12}号-\d+X$/.test(value.filingNumber)) {
    throw new Error('Filing display must match a verified mini-program filing record')
  }
}
