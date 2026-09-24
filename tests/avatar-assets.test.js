const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { PNG } = require('pngjs')
const { buildAvatarAssets, names } = require('../tooling/build-avatar-assets.cjs')

test('avatar builds preserve originals and explicitly package only the five small runtime assets', () => {
  const root = path.resolve(__dirname, '..')
  const directory = path.join(root, 'apps/miniprogram/assets/avatar')
  const hash = name => createHash('sha256').update(fs.readFileSync(path.join(directory, name + '.png'))).digest('hex')
  const originals = names.map(hash)
  const bytes = buildAvatarAssets(root)
  assert.deepEqual(names.map(hash), originals)
  assert.ok(bytes < 250 * 1024)
  const { packOptions } = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
  for (const name of names) {
    const png = PNG.sync.read(fs.readFileSync(path.join(directory, 'runtime', name + '.png')))
    assert.equal(png.width, 256); assert.equal(png.height, 256)
    assert.ok(packOptions.ignore.some(item => item.type === 'file' && item.value === `assets/avatar/${name}.png`))
    assert.ok(packOptions.include.some(item => item.type === 'file' && item.value === `assets/avatar/runtime/${name}.png`))
  }
})
