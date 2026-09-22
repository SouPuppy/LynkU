const assert = require('node:assert/strict')
const test = require('node:test')
const { isScheduledDrain } = require('@lynku/server')
test('scheduled consumers require the trusted runtime source, no client identity and exact trigger', () => {
  const event = { Type: 'Timer', TriggerName: 'profile-outbox' }
  assert.equal(isScheduledDrain('timer', undefined, event, 'profile-outbox'), true)
  assert.equal(isScheduledDrain('timer', 'client', event, 'profile-outbox'), false)
  for (const source of [undefined, '', 'wx_client', 'timer,wx_client']) {
    assert.equal(isScheduledDrain(source, undefined, { ...event, TRIGGER_SRC: 'timer' }, 'profile-outbox'), false)
  }
  assert.equal(isScheduledDrain('timer', undefined, event, 'notification-outbox'), false)
  assert.equal(isScheduledDrain('timer', undefined, null, 'profile-outbox'), false)
})
