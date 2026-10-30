// Test-only preload; never ships in the Nitro runtime tree.
import net from 'node:net'
const listen = net.Server.prototype.listen
net.Server.prototype.listen = function (...args) {
  process.stdout.write('T16_LISTEN_ATTEMPT\n')
  args[0] = { ...args[0], host: '127.0.0.1', port: 0 }
  delete args[0].path
  this.once('listening', () => process.send?.({ bound: this.address() }))
  return listen.apply(this, args)
}
net.Socket.prototype.connect = function () { process.stdout.write('T16_OUTBOUND_ATTEMPT\n'); throw Error('t16_outbound_denied') }
process.on('message', (message) => {
  if (message?.mode) { process.env.LIWAN_TENANCY_MODE = message.mode; process.send?.({ mutated: message.mode }) }
})
