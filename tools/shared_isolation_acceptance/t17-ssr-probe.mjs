import net from 'node:net'
const listen = net.Server.prototype.listen
net.Server.prototype.listen = function (...args) {
  args[0] = { ...args[0], host: '127.0.0.1', port: 0 }; delete args[0].path
  this.once('listening', () => process.send?.({ bound: this.address() }))
  return listen.apply(this, args)
}
const connect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  const value = args[0]; const options = Array.isArray(value) ? value[0] : value
  if (!options || options.host !== '127.0.0.1' || String(options.port) !== process.env.T17_ALLOWED_PORT) throw Error('t17_outbound_denied')
  return connect.apply(this, args)
}
