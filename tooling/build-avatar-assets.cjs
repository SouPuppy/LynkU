const fs = require('node:fs')
const path = require('node:path')
const { PNG } = require('pngjs')

const names = ['anonymous', 'avatar_01', 'avatar_02', 'avatar_03', 'avatar_04']
/** Area averaging preserves the original composition; originals are never overwritten. */
function buildAvatarAssets(root) {
  const source = path.join(root, 'apps/miniprogram/assets/avatar')
  const destination = path.join(source, 'runtime')
  fs.mkdirSync(destination, { recursive: true })
  let bytes = 0
  for (const name of names) {
    const input = PNG.sync.read(fs.readFileSync(path.join(source, name + '.png')))
    if (input.width !== input.height || input.width < 256 || input.width > 4096) throw Error('Invalid avatar source dimensions')
    const size = 256, output = new PNG({ width: size, height: size })
    const scale = input.width / size
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const totals = [0, 0, 0, 0]; let weight = 0
      for (let sy = Math.floor(y * scale); sy < Math.ceil((y + 1) * scale); sy++) {
        for (let sx = Math.floor(x * scale); sx < Math.ceil((x + 1) * scale); sx++) {
          const w = (Math.min(sx + 1, (x + 1) * scale) - Math.max(sx, x * scale))
            * (Math.min(sy + 1, (y + 1) * scale) - Math.max(sy, y * scale))
          const offset = (sy * input.width + sx) * 4
          for (let c = 0; c < 4; c++) totals[c] += input.data[offset + c] * w
          weight += w
        }
      }
      for (let c = 0; c < 4; c++) output.data[(y * size + x) * 4 + c] = Math.round(totals[c] / weight)
    }
    const data = PNG.sync.write(output, { deflateLevel: 9, deflateStrategy: 1 })
    fs.writeFileSync(path.join(destination, name + '.png'), data)
    bytes += data.length
  }
  if (bytes > 250 * 1024) throw Error(`Avatar runtime assets exceed 250 KB: ${bytes}`)
  return bytes
}
module.exports = { buildAvatarAssets, names }
if (require.main === module) console.log(`Built five avatar assets: ${buildAvatarAssets(path.resolve(__dirname, '..'))} bytes.`)
