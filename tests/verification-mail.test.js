const assert = require('node:assert/strict')
const test = require('node:test')
const { verificationMail, parseMailAcceptance } = require('@lynku/server')
test('verification mail uses the confirmed sender and restricts recipients to school email', () => {
  const mail = verificationMail('student@nottingham.edu.cn', '012345')
  assert.equal(mail.domain, 'mail.oikoss.cc')
  assert.equal(mail.from, 'LynkU <noreply@oikoss.cc>')
  assert.equal(mail.to, 'student@nottingham.edu.cn')
  assert.match(mail.text, /012345/)
  assert.match(mail.text, /10 分钟/)
  for (const email of ['student@nottingham.edu.cn.attacker.test', 'a@other.test', 'a\r\nbcc:someone@nottingham.edu.cn', null]) {
    assert.throws(() => verificationMail(email, '012345'))
  }
  for (const code of [123456, '12345', '1234567', '123456\n']) assert.throws(() => verificationMail('student@nottingham.edu.cn', code))
})
test('mail submission requires an acceptance id and discards provider response extras', () => {
  assert.deepEqual(parseMailAcceptance({ id: '<test@mail.oikoss.cc>', internal: 'not returned' }), { id: '<test@mail.oikoss.cc>' })
  for (const result of [null, {}, { message: 'ok' }, { id: '' }, { id: 123 }]) assert.throws(() => parseMailAcceptance(result))
})
