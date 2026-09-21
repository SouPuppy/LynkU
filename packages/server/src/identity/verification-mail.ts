export interface VerificationMail { domain: string; from: string; to: string; subject: string; text: string }
export function verificationMail(email: unknown, code: unknown): VerificationMail {
  if (typeof email !== 'string' || email.trim() !== email || !/^[a-z0-9._%+-]+@nottingham\.edu\.cn$/.test(email) || email.length > 254) throw Error('Invalid verification recipient')
  if (typeof code !== 'string' || code.length !== 6 || !/^\d{6}$/.test(code)) throw Error('Invalid verification code')
  return { domain: 'mail.oikoss.cc', from: 'LynkU <noreply@oikoss.cc>', to: email, subject: 'LynkU 学校邮箱验证码',
    text: `你的 LynkU 学校邮箱验证码是：${code}\n\n验证码 10 分钟内有效。如非本人操作，请忽略此邮件。请勿将验证码提供给他人。未在收件箱看到邮件时，请查看垃圾邮件。` }
}
export function parseMailAcceptance(value: unknown): { id: string } {
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string' || !value.id || value.id.length > 1024) throw Error('Invalid mail acceptance')
  return { id: value.id }
}
