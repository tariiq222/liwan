// Test-only preload for build-mode.test.mjs; never ships in the Nitro runtime tree.
// It pins every listen to 127.0.0.1 on a free port, refuses outbound sockets and lets the test change
// LIWAN_TENANCY_MODE inside the running server.
import net from 'node:net'
const listen = net.Server.prototype.listen
net.Server.prototype.listen = function (...args) {
  process.stdout.write('BUILD_MODE_LISTEN_ATTEMPT\n')
  args[0] = { ...args[0], host: '127.0.0.1', port: 0 }
  delete args[0].path
  this.once('listening', () => process.send?.({ bound: this.address() }))
  return listen.apply(this, args)
}
net.Socket.prototype.connect = function () { process.stdout.write('BUILD_MODE_OUTBOUND_ATTEMPT\n'); throw Error('build_mode_outbound_denied') }
process.on('message', (message) => {
  if (message?.mode) { process.env.LIWAN_TENANCY_MODE = message.mode; process.send?.({ mutated: message.mode }) }
})
