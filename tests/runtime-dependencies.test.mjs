import assert from 'node:assert/strict'
import test from 'node:test'
import http from 'node:http'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const sdkRequire = createRequire(require.resolve('@cloudbase/node-sdk'))
const axios = sdkRequire('axios')

test('patched SDK HTTP dependency retains JSON, status and timeout semantics', async () => {
  const sockets = new Set()
  const server = http.createServer((request, response) => {
    if (request.url === '/wait') return
    if (request.url === '/fail') { response.writeHead(503); response.end(); return }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ ok: true }))
  })
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const baseURL = `http://127.0.0.1:${server.address().port}`
    assert.deepEqual((await axios.get(baseURL, { proxy: false })).data, { ok: true })
    await assert.rejects(axios.get(`${baseURL}/fail`, { proxy: false }), error => error.response.status === 503)
    await assert.rejects(axios.get(`${baseURL}/wait`, { proxy: false, timeout: 30 }), error => error.code === 'ECONNABORTED')
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => server.close(resolve))
  }
})
