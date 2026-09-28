// Test-only preload: guarantees no fallback port3000 and no outbound sockets.
import net from 'node:net'
const listen = net.Server.prototype.listen
net.Server.prototype.listen = function (...args) {
  if (!args[0] || typeof args[0] !== 'object') throw Error('unexpected_listen_signature')
  process.stdout.write(`T11_LISTEN_ATTEMPT:${JSON.stringify({ requestedPort: args[0].port, requestedHost: args[0].host, enforcedPort: 0, enforcedHost: '127.0.0.1' })}\n`)
  args[0] = { ...args[0], host: '127.0.0.1', port: 0 }
  delete args[0].path
  this.once('listening', () => process.stdout.write(`T11_BOUND:${JSON.stringify(this.address())}\n`))
  return listen.apply(this, args)
}
net.Socket.prototype.connect = function () { throw Error('t11_outbound_denied') }
