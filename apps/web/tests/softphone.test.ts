import * as Vue from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelephonyLookupSchema, TelephonySessionSchema, type TelephonySession } from '@liwan/contracts'
import { ApiError } from '../app/composables/useApi'
import {
  normalizeDialTarget,
  useSoftphone,
  type AudioSinkLike,
  type BroadcastChannelLike,
  type RingtonePlayer,
  type StorageLike,
} from '../app/composables/useSoftphone'
import { createCallChip } from '../app/composables/telephony/createCallChip'
import { useCallChipHost } from '../app/composables/useCallChipHost'
import { restoreSessionTeardown, runSessionTeardown } from '../app/utils/sessionTeardown'

const SESSION_GRANT: TelephonySession = {
  wsUrl: 'wss://pbx.example.sa/ws',
  extension: '1001',
  authUsername: '1001-t1',
  password: 'ephemeral-password-1',
  iceServers: [
    { urls: 'stun:stun.example.sa:3478' },
    { urls: ['turn:turn.example.sa:3478'], username: 'u1', credential: 'c1' },
  ],
  expiresInSeconds: 60,
}

class FakeStorage implements StorageLike {
  map = new Map<string, string>()
  getItem(key: string) { return this.map.get(key) ?? null }
  setItem(key: string, value: string) { this.map.set(key, value) }
  removeItem(key: string) { this.map.delete(key) }
}

class FakeBroadcastHub {
  channels = new Map<string, Set<FakeBroadcastChannel>>()
  open(name: string): FakeBroadcastChannel {
    const ch = new FakeBroadcastChannel(name, this)
    if (!this.channels.has(name)) this.channels.set(name, new Set())
    this.channels.get(name)!.add(ch)
    return ch
  }
  deliver(sender: FakeBroadcastChannel, name: string, data: unknown) {
    for (const peer of this.channels.get(name) ?? []) {
      if (peer !== sender && !peer.closed) peer.receive(data)
    }
  }
  close(ch: FakeBroadcastChannel) {
    this.channels.get(ch.name)?.delete(ch)
  }
}

class FakeBroadcastChannel implements BroadcastChannelLike {
  closed = false
  listeners = new Set<(event: { data: unknown }) => void>()
  constructor(public name: string, private hub: FakeBroadcastHub) {}
  postMessage(message: unknown) {
    if (this.closed) return
    this.hub.deliver(this, this.name, JSON.parse(JSON.stringify(message)))
  }
  addEventListener(_type: 'message', listener: (event: { data: unknown }) => void) {
    this.listeners.add(listener)
  }
  removeEventListener(_type: 'message', listener: (event: { data: unknown }) => void) {
    this.listeners.delete(listener)
  }
  receive(data: unknown) {
    for (const listener of [...this.listeners]) listener({ data })
  }
  close() {
    this.closed = true
    this.hub.close(this)
  }
}

class FakeEmitter {
  private handlers = new Map<string, Set<(...args: any[]) => void>>()
  on(event: string, fn: (...args: any[]) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(fn)
  }
  emit(event: string, ...args: any[]) {
    for (const fn of [...(this.handlers.get(event) ?? [])]) fn(...args)
  }
}

class FakeRtcSession extends FakeEmitter {
  remote_identity: { uri: { user: string } }
  answer = vi.fn((_opts?: any) => { this.emit('confirmed') })
  terminate = vi.fn((opts?: any) => {
    if (opts?.status_code === 486) this.emit('failed', { cause: 'Rejected' })
    else this.emit('ended')
  })
  mute = vi.fn((_opts?: any) => { this.emit('muted') })
  unmute = vi.fn((_opts?: any) => { this.emit('unmuted') })
  hold = vi.fn(() => { this.emit('hold', { originator: 'local' }); return true })
  unhold = vi.fn(() => { this.emit('unhold', { originator: 'local' }); return true })
  sendDTMF = vi.fn()
  refer = vi.fn((_target: string, opts?: { eventHandlers?: Record<string, (e?: any) => void> }): unknown => {
    this.lastReferOpts = opts
    return {}
  })
  lastReferOpts?: { eventHandlers?: Record<string, (e?: any) => void> }
  constructor(remoteUser = '+966501234567') {
    super()
    this.remote_identity = { uri: { user: remoteUser } }
  }
}

class FakeUA extends FakeEmitter {
  started = false
  stopped = false
  registered = false
  config: Record<string, any>
  setCalls: Array<[string, unknown]> = []
  registerCalls = 0
  outgoingCalls: Array<{ target: string; options: any; session: FakeRtcSession }> = []
  constructor(config: Record<string, any>) {
    super()
    this.config = config
  }
  start() {
    this.started = true
    this.registered = true
    this.emit('registered')
  }
  stop() {
    this.stopped = true
    this.registered = false
  }
  isRegistered() { return this.registered }
  set(key: string, value: unknown) {
    this.setCalls.push([key, value])
    this.config[key] = value
  }
  register() {
    this.registerCalls += 1
  }
  call(target: string, options: any) {
    const session = new FakeRtcSession(target.replace(/^sip:/, '').split('@')[0])
    this.outgoingCalls.push({ target, options, session })
    this.emit('newRTCSession', { originator: 'local', session })
    return session
  }
  simulateIncoming(remoteUser: string) {
    const session = new FakeRtcSession(remoteUser)
    this.emit('newRTCSession', { originator: 'remote', session })
    return session
  }
}

function createFakeJsSip() {
  const agents: FakeUA[] = []
  const sockets: string[] = []
  const lib = {
    WebSocketInterface: class {
      constructor(public url: string) { sockets.push(url) }
    },
    UA: class extends FakeUA {
      constructor(config: Record<string, any>) {
        super(config)
        agents.push(this)
      }
    },
  }
  return { lib, agents, sockets }
}

function createFakeRingtone(): RingtonePlayer & { starts: number; stops: number } {
  const player = {
    starts: 0,
    stops: 0,
    start() { player.starts += 1 },
    stop() { player.stops += 1 },
  }
  return player
}

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Vue.nextTick()
}

describe('normalizeDialTarget', () => {
  it('accepts 2–10 digit internal extensions including Arabic-Indic digits', () => {
    expect(normalizeDialTarget('1001')).toEqual({ ok: true, kind: 'extension', value: '1001' })
    expect(normalizeDialTarget('12')).toEqual({ ok: true, kind: 'extension', value: '12' })
    expect(normalizeDialTarget('١٠٠٢')).toEqual({ ok: true, kind: 'extension', value: '1002' })
  })

  it('normalizes local Saudi mobile numbers and international formats to E.164', () => {
    expect(normalizeDialTarget('0501234567')).toEqual({ ok: true, kind: 'e164', value: '+966501234567' })
    expect(normalizeDialTarget('501234567')).toEqual({ ok: true, kind: 'e164', value: '+966501234567' })
    expect(normalizeDialTarget('٠٥٠ ١٢٣ ٤٥٦٧')).toEqual({ ok: true, kind: 'e164', value: '+966501234567' })
    expect(normalizeDialTarget('۰۵۰-۱۲۳-۴۵۶۷')).toEqual({ ok: true, kind: 'e164', value: '+966501234567' })
    expect(normalizeDialTarget('+966 050 123 4567')).toEqual({ ok: true, kind: 'e164', value: '+966501234567' })
    expect(normalizeDialTarget('00966501234567')).toEqual({ ok: true, kind: 'e164', value: '+966501234567' })
    expect(normalizeDialTarget('+1 (415) 555-2671')).toEqual({ ok: true, kind: 'e164', value: '+14155552671' })
  })

  it('rejects empty, single-digit, non-numeric, and malformed E.164 numbers', () => {
    expect(normalizeDialTarget('   ')).toEqual({ ok: false, reason: 'empty' })
    expect(normalizeDialTarget('1')).toEqual({ ok: false, reason: 'invalid' })
    expect(normalizeDialTarget('abc')).toEqual({ ok: false, reason: 'invalid' })
    expect(normalizeDialTarget('+123')).toEqual({ ok: false, reason: 'invalid' })
    expect(normalizeDialTarget('+0123456789')).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('useSoftphone', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('passes authUsername, password, register_expires and ICE servers to UA, call() and answer()', async () => {
    const storage = new FakeStorage()
    const hub = new FakeBroadcastHub()
    const jssip = createFakeJsSip()
    const ringtone = createFakeRingtone()
    const audioSink: AudioSinkLike = { autoplay: false, srcObject: null, play: vi.fn() }
    const $api = vi.fn(async (path: string, opts?: any) => {
      if (path === '/api/v1/telephony/session' && opts?.method === 'POST') {
        expect(opts.schema).toBe(TelephonySessionSchema)
        return SESSION_GRANT
      }
      return { revoked: true }
    })

    const phone = useSoftphone({
      $api,
      identity: { userId: 7, companyId: 1 },
      loadLibrary: async () => jssip.lib,
      createChannel: name => hub.open(name),
      storage,
      ringtone,
      createAudio: () => audioSink,
      tabId: 'tab-a',
      registerUnload: () => () => {},
    })

    await phone.register()
    expect(phone.state.isLeader).toBe(true)
    expect(phone.state.phase).toBe('registered')
    expect(phone.state.registeredAs).toBe('1001')

    const ua = jssip.agents[0]!
    expect(ua.config).toMatchObject({
      uri: 'sip:1001@pbx.example.sa',
      authorization_user: '1001-t1',
      password: 'ephemeral-password-1',
      register: true,
      register_expires: 60,
      session_timers: false,
    })

    // Outgoing call passes ICE servers and normalizes Saudi mobile number to E.164.
    expect(phone.call('0501234567')).toBeNull()
    expect(ua.outgoingCalls).toHaveLength(1)
    expect(ua.outgoingCalls[0]!.target).toBe('sip:+966501234567@pbx.example.sa')
    expect(ua.outgoingCalls[0]!.options.pcConfig).toEqual({ iceServers: SESSION_GRANT.iceServers })
    phone.hangUp()
    expect(phone.state.phase).toBe('registered')
    expect(phone.state.failure).toBeNull()

    // Incoming call starts ringtone, passes ICE servers to answer(), attaches remote track, and supports full D3 controls.
    const incoming = ua.simulateIncoming('+966551112233')
    expect(phone.state.phase).toBe('ringing')
    expect(ringtone.starts).toBe(1)

    const trackHandlers: Array<(e: any) => void> = []
    incoming.emit('peerconnection', {
      peerconnection: { addEventListener: (_type: string, fn: (e: any) => void) => trackHandlers.push(fn) },
    })
    const fakeStream = { id: 'remote-stream-1' }
    trackHandlers[0]!({ streams: [fakeStream] })
    expect(audioSink.srcObject).toBe(fakeStream)

    phone.answer()
    expect(ringtone.stops).toBeGreaterThanOrEqual(1)
    expect(incoming.answer).toHaveBeenCalledWith({
      mediaConstraints: { audio: true, video: false },
      pcConfig: { iceServers: SESSION_GRANT.iceServers },
    })
    expect(phone.state.phase).toBe('in-call')

    // Mute & unmute
    phone.toggleMute()
    expect(incoming.mute).toHaveBeenCalledWith({ audio: true })
    expect(phone.state.muted).toBe(true)
    phone.toggleMute()
    expect(incoming.unmute).toHaveBeenCalledWith({ audio: true })
    expect(phone.state.muted).toBe(false)

    // Hold & unhold
    phone.toggleHold()
    expect(incoming.hold).toHaveBeenCalledTimes(1)
    expect(phone.state.held).toBe(true)
    phone.toggleHold()
    expect(incoming.unhold).toHaveBeenCalledTimes(1)
    expect(phone.state.held).toBe(false)

    // DTMF
    phone.sendDtmf('5')
    phone.sendDtmf('#')
    expect(incoming.sendDTMF).toHaveBeenNthCalledWith(1, '5')
    expect(incoming.sendDTMF).toHaveBeenNthCalledWith(2, '#')

    // Blind transfer (extension)
    expect(phone.transfer('1002')).toBeNull()
    expect(phone.state.transferring).toBe(true)
    expect(incoming.refer).toHaveBeenCalledWith('sip:1002@pbx.example.sa', expect.any(Object))
    incoming.lastReferOpts?.eventHandlers?.requestFailed?.({ cause: 'Declined' })
    expect(phone.state.transferring).toBe(false)
    expect(phone.state.transferError).toBe('Declined')

    // Local hang-up returns cleanly to registered, never failed, and detaches audio.
    phone.hangUp()
    expect(phone.state.phase).toBe('registered')
    expect(phone.state.failure).toBeNull()
    expect(audioSink.srcObject).toBeNull()

    // Reject incoming call uses SIP 486 and returns cleanly to registered (never failed).
    const incoming2 = ua.simulateIncoming('+966559998877')
    expect(phone.state.phase).toBe('ringing')
    phone.reject()
    expect(incoming2.terminate).toHaveBeenCalledWith({ status_code: 486, reason_phrase: 'Busy Here' })
    expect(phone.state.phase).toBe('registered')
    expect(phone.state.failure).toBeNull()

    await phone.stop()
  })

  it('treats 404 (no extension) as quiet idle with hasExtension=false and never retries', async () => {
    const storage = new FakeStorage()
    const hub = new FakeBroadcastHub()
    const loadLibrary = vi.fn()
    const $api = vi.fn(async () => { throw new ApiError(404, 'not_found', 'No extension') })

    const phone = useSoftphone({
      $api,
      identity: { userId: 7, companyId: 1 },
      loadLibrary,
      createChannel: name => hub.open(name),
      storage,
      ringtone: createFakeRingtone(),
      tabId: 'tab-no-ext',
      registerUnload: () => () => {},
    })

    await phone.register()
    expect(phone.state.hasExtension).toBe(false)
    expect(phone.state.phase).toBe('idle')
    expect(phone.state.failure).toBeNull()
    expect(loadLibrary).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(120_000)
    expect($api).toHaveBeenCalledTimes(1)
    await phone.stop()
  })

  it('elects a single leader tab, mirrors state, forwards follower commands, and fails over on leader close or expiry', async () => {
    const storage = new FakeStorage()
    const hub = new FakeBroadcastHub()
    const jssip = createFakeJsSip()
    let clock = 1_000_000
    const $api = vi.fn(async (_path: string, opts?: any) => (opts?.method === 'DELETE' ? { revoked: true } : SESSION_GRANT))

    const tabA = useSoftphone({
      $api,
      identity: { userId: 7, companyId: 1 },
      loadLibrary: async () => jssip.lib,
      createChannel: name => hub.open(name),
      storage,
      now: () => clock,
      ringtone: createFakeRingtone(),
      tabId: 'tab-a',
      registerUnload: () => () => {},
    })
    const tabB = useSoftphone({
      $api,
      identity: { userId: 7, companyId: 1 },
      loadLibrary: async () => jssip.lib,
      createChannel: name => hub.open(name),
      storage,
      now: () => clock,
      ringtone: createFakeRingtone(),
      tabId: 'tab-b',
      registerUnload: () => () => {},
    })

    await tabA.register()
    await tabB.register()

    expect(tabA.state.isLeader).toBe(true)
    expect(tabB.state.isLeader).toBe(false)
    expect($api).toHaveBeenCalledTimes(1)
    expect(jssip.agents).toHaveLength(1)
    expect(tabB.state.phase).toBe('registered')
    expect(tabB.state.registeredAs).toBe('1001')

    // Leader receives incoming call → follower mirrors ringing and forwards answer + mute + hangUp.
    const incoming = jssip.agents[0]!.simulateIncoming('+966501234567')
    expect(tabB.state.phase).toBe('ringing')
    expect(tabB.state.remote).toBe('+966501234567')

    tabB.answer()
    expect(incoming.answer).toHaveBeenCalledTimes(1)
    expect(tabB.state.phase).toBe('in-call')

    tabB.toggleMute()
    expect(incoming.mute).toHaveBeenCalledTimes(1)
    expect(tabB.state.muted).toBe(true)

    tabB.hangUp()
    expect(tabA.state.phase).toBe('registered')
    expect(tabB.state.phase).toBe('registered')

    // Leader closes tab (revoke=false) → follower immediately fails over and opens its own session.
    await tabA.stop({ revoke: false })
    await flush()
    expect(tabB.state.isLeader).toBe(true)
    expect($api).toHaveBeenCalledTimes(2)
    expect(jssip.agents).toHaveLength(2)

    // Lease expiry failover when a third tab sees an expired lease.
    clock += 20_000
    // Freeze tabB heartbeat by stopping it silently without releasing lease.
    storage.setItem('liwan-softphone-leader:7:1', JSON.stringify({ tabId: 'crashed-tab', expiresAt: clock - 1 }))
    const tabC = useSoftphone({
      $api,
      identity: { userId: 7, companyId: 1 },
      loadLibrary: async () => jssip.lib,
      createChannel: name => hub.open(name),
      storage,
      now: () => clock,
      ringtone: createFakeRingtone(),
      tabId: 'tab-c',
      registerUnload: () => () => {},
    })
    await tabC.register()
    expect(tabC.state.isLeader).toBe(true)

    await tabB.stop({ revoke: false })
    await tabC.stop({ revoke: false })
  })

  it('renews short-lived session credentials before expiry', async () => {
    const storage = new FakeStorage()
    const hub = new FakeBroadcastHub()
    const jssip = createFakeJsSip()
    let grantSeq = 0
    const $api = vi.fn(async (_path: string, opts?: any) => {
      if (opts?.method === 'DELETE') return { revoked: true }
      grantSeq += 1
      return { ...SESSION_GRANT, password: `pw-${grantSeq}`, expiresInSeconds: 60 }
    })

    const phone = useSoftphone({
      $api,
      identity: { userId: 7, companyId: 1 },
      loadLibrary: async () => jssip.lib,
      createChannel: name => hub.open(name),
      storage,
      ringtone: createFakeRingtone(),
      tabId: 'tab-renew',
      registerUnload: () => () => {},
    })

    await phone.register()
    expect($api).toHaveBeenCalledTimes(1)

    // 60 - 20 = 40 seconds until renewal.
    await vi.advanceTimersByTimeAsync(40_000)
    await flush()

    expect($api).toHaveBeenCalledTimes(2)
    const ua = jssip.agents[0]!
    expect(ua.setCalls).toContainEqual(['password', 'pw-2'])
    expect(ua.setCalls.some(([key]) => key === 'register_expires')).toBe(false)
    expect(ua.registerCalls).toBe(1)

    await phone.stop()
  })

  it('re-arms credential renewal when JsSIP auto-reconnects after a disconnect', async () => {
    const storage = new FakeStorage()
    const hub = new FakeBroadcastHub()
    const jssip = createFakeJsSip()
    let grantSeq = 0
    const $api = vi.fn(async (_path: string, opts?: any) => {
      if (opts?.method === 'DELETE') return { revoked: true }
      grantSeq += 1
      return {
        ...SESSION_GRANT,
        authUsername: `1001-t${grantSeq}`,
        password: `pw-${grantSeq}`,
        expiresInSeconds: 60,
      }
    })

    const phone = useSoftphone({
      $api,
      identity: { userId: 7, companyId: 1 },
      loadLibrary: async () => jssip.lib,
      createChannel: name => hub.open(name),
      storage,
      ringtone: createFakeRingtone(),
      tabId: 'tab-reconnect-renew',
      registerUnload: () => () => {},
    })

    await phone.register()
    expect($api).toHaveBeenCalledTimes(1)
    const ua = jssip.agents[0]!

    // Disconnect clears the renewal timer and moves to failed.
    await vi.advanceTimersByTimeAsync(10_000)
    ua.emit('disconnected')
    expect(phone.state.phase).toBe('failed')
    expect(phone.state.failure).toBe('connection_closed')

    // JsSIP auto-reconnects 5s later (t=15s): state returns to registered and renewal re-arms for remaining 25s.
    await vi.advanceTimersByTimeAsync(5_000)
    ua.emit('registered')
    expect(phone.state.phase).toBe('registered')
    expect(phone.state.failure).toBeNull()

    await vi.advanceTimersByTimeAsync(24_000)
    await flush()
    expect($api).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1_000)
    await flush()
    expect($api).toHaveBeenCalledTimes(2)
    expect($api).toHaveBeenLastCalledWith('/api/v1/telephony/session', expect.objectContaining({ method: 'POST' }))
    expect(ua.setCalls).toContainEqual(['authorization_user', '1001-t2'])
    expect(ua.setCalls).toContainEqual(['password', 'pw-2'])
    expect(ua.registerCalls).toBe(1)

    // If a disconnect lasts past the renewal lead window, auto-reconnect schedules renewal within 1s.
    ua.emit('disconnected')
    await vi.advanceTimersByTimeAsync(50_000)
    await flush()
    expect($api).toHaveBeenCalledTimes(2)

    ua.emit('registered')
    await vi.advanceTimersByTimeAsync(1_000)
    await flush()
    expect($api).toHaveBeenCalledTimes(3)
    expect(ua.setCalls).toContainEqual(['authorization_user', '1001-t3'])
    expect(ua.setCalls).toContainEqual(['password', 'pw-3'])
    expect(ua.registerCalls).toBe(2)

    await phone.stop()
  })

  it('does not re-arm renewal if agent.start() synchronously triggers disconnected', async () => {
    const storage = new FakeStorage()
    const hub = new FakeBroadcastHub()
    const agents: FakeUA[] = []
    let grantSeq = 0
    const lib = {
      WebSocketInterface: class { constructor(public url: string) {} },
      UA: class extends FakeUA {
        constructor(config: Record<string, any>) {
          super(config)
          agents.push(this)
        }
        override start() {
          this.started = true
          this.registered = false
          this.emit('disconnected')
        }
      },
    }
    const $api = vi.fn(async (_path: string, opts?: any) => {
      if (opts?.method === 'DELETE') return { revoked: true }
      grantSeq += 1
      return { ...SESSION_GRANT, password: `pw-${grantSeq}`, expiresInSeconds: 60 }
    })

    const phone = useSoftphone({
      $api,
      identity: { userId: 7, companyId: 1 },
      loadLibrary: async () => lib,
      createChannel: name => hub.open(name),
      storage,
      ringtone: createFakeRingtone(),
      tabId: 'tab-sync-disconnect',
      registerUnload: () => () => {},
    })

    await phone.register()
    expect(phone.state.phase).toBe('failed')
    expect(phone.state.failure).toBe('connection_closed')
    expect($api).toHaveBeenCalledTimes(1)

    // Renewal timer was cleared by synchronous failUa() and not re-armed after start().
    await vi.advanceTimersByTimeAsync(120_000)
    await flush()
    expect($api).toHaveBeenCalledTimes(1)

    // Subsequent auto-reconnect re-arms renewal promptly.
    agents[0]!.emit('registered')
    await vi.advanceTimersByTimeAsync(1_000)
    await flush()
    expect($api).toHaveBeenCalledTimes(2)
    expect(agents[0]!.setCalls).toContainEqual(['password', 'pw-2'])

    await phone.stop()
  })

  it('rejects a second incoming call with 486 while busy without disturbing the active call, and refuses concurrent call()', async () => {
    const storage = new FakeStorage()
    const hub = new FakeBroadcastHub()
    const jssip = createFakeJsSip()
    const ringtone = createFakeRingtone()
    const $api = vi.fn(async (_path: string, opts?: any) => (opts?.method === 'DELETE' ? { revoked: true } : SESSION_GRANT))

    const phone = useSoftphone({
      $api,
      identity: { userId: 7, companyId: 1 },
      loadLibrary: async () => jssip.lib,
      createChannel: name => hub.open(name),
      storage,
      ringtone,
      tabId: 'tab-busy',
      registerUnload: () => () => {},
    })

    await phone.register()
    const ua = jssip.agents[0]!

    const first = ua.simulateIncoming('+966501234567')
    phone.answer()
    expect(phone.state.phase).toBe('in-call')
    expect(phone.state.remote).toBe('+966501234567')
    const startsBefore = ringtone.starts

    // Second incoming call while active must be rejected with 486 without touching current call or ringtone.
    const second = ua.simulateIncoming('+966559998877')
    expect(second.terminate).toHaveBeenCalledWith({ status_code: 486, reason_phrase: 'Busy Here' })
    expect(phone.state.phase).toBe('in-call')
    expect(phone.state.remote).toBe('+966501234567')
    expect(ringtone.starts).toBe(startsBefore)

    // Outgoing call while busy returns 'unavailable' and never touches UA.
    expect(phone.call('+966551112233')).toBe('unavailable')
    expect(ua.outgoingCalls).toHaveLength(0)

    // Original call still hangs up normally.
    phone.hangUp()
    expect(first.terminate).toHaveBeenCalledTimes(1)
    expect(phone.state.phase).toBe('registered')

    await phone.stop()
  })

  it('ignores remote hold/unhold events, checks hold/unhold boolean returns, and guards refer() false & stale callbacks', async () => {
    const storage = new FakeStorage()
    const hub = new FakeBroadcastHub()
    const jssip = createFakeJsSip()
    const $api = vi.fn(async (_path: string, opts?: any) => (opts?.method === 'DELETE' ? { revoked: true } : SESSION_GRANT))

    const phone = useSoftphone({
      $api,
      identity: { userId: 7, companyId: 1 },
      loadLibrary: async () => jssip.lib,
      createChannel: name => hub.open(name),
      storage,
      ringtone: createFakeRingtone(),
      tabId: 'tab-hold-refer',
      registerUnload: () => () => {},
    })

    await phone.register()
    const ua = jssip.agents[0]!

    const call1 = ua.simulateIncoming('+966501234567')
    phone.answer()

    // Remote hold/unhold must not corrupt local held state.
    call1.emit('hold', { originator: 'remote' })
    expect(phone.state.held).toBe(false)
    call1.emit('hold', { originator: 'local' })
    expect(phone.state.held).toBe(true)
    call1.emit('unhold', { originator: 'remote' })
    expect(phone.state.held).toBe(true)
    call1.emit('unhold', { originator: 'local' })
    expect(phone.state.held).toBe(false)

    // hold()/unhold() returning false must leave state.held untouched.
    call1.hold.mockReturnValueOnce(false)
    phone.toggleHold()
    expect(phone.state.held).toBe(false)

    phone.toggleHold()
    expect(phone.state.held).toBe(true)

    call1.unhold.mockReturnValueOnce(false)
    phone.toggleHold()
    expect(phone.state.held).toBe(true)

    // refer() returning false resets transferring and records transferError='failed'.
    call1.refer.mockReturnValueOnce(false)
    expect(phone.transfer('1002')).toBeNull()
    expect(phone.state.transferring).toBe(false)
    expect(phone.state.transferError).toBe('failed')

    // Stale refer callback after call ends / newer call starts must not corrupt state.
    expect(phone.transfer('1002')).toBeNull()
    const staleHandlers = call1.lastReferOpts!.eventHandlers!
    phone.hangUp()
    expect(phone.state.phase).toBe('registered')
    staleHandlers.requestFailed?.({ cause: 'LateFailure' })
    expect(phone.state.transferError).toBeNull()

    const call2 = ua.simulateIncoming('+966559998877')
    phone.answer()
    staleHandlers.failed?.({ cause: 'VeryLateFailure' })
    expect(phone.state.transferError).toBeNull()
    expect(call2.terminate).not.toHaveBeenCalled()

    await phone.stop()
  })

  it('guards concurrent connectSession/retry with connectGeneration, terminates activeSession on disconnect/registrationFailed, and emits structured failure codes', async () => {
    const storage = new FakeStorage()
    const hub = new FakeBroadcastHub()
    const jssip = createFakeJsSip()
    const pendingResolvers: Array<(grant: TelephonySession) => void> = []
    const $api = vi.fn(async (_path: string, opts?: any) => {
      if (opts?.method === 'DELETE') return { revoked: true }
      return new Promise<TelephonySession>(resolve => { pendingResolvers.push(resolve) })
    })

    const phone = useSoftphone({
      $api,
      identity: { userId: 7, companyId: 1 },
      loadLibrary: async () => jssip.lib,
      createChannel: name => hub.open(name),
      storage,
      ringtone: createFakeRingtone(),
      tabId: 'tab-gen',
      registerUnload: () => () => {},
    })

    const p1 = phone.register()
    const p2 = phone.retry()
    expect(pendingResolvers).toHaveLength(2)

    // Resolve the second request first, then the stale first request.
    pendingResolvers[1]!(SESSION_GRANT)
    pendingResolvers[0]!(SESSION_GRANT)
    await Promise.all([p1, p2])
    await flush()

    // Only one JsSIP.UA was constructed; the stale attempt was discarded.
    expect(jssip.agents).toHaveLength(1)
    const ua = jssip.agents[0]!

    // Active call during disconnect must be terminated, renewalTimer cleared, and failure code set.
    const active = ua.simulateIncoming('+966501234567')
    phone.answer()
    ua.emit('disconnected')
    expect(active.terminate).toHaveBeenCalledTimes(1)
    expect(phone.state.phase).toBe('failed')
    expect(phone.state.failure).toBe('connection_closed')

    // Renewal timer was cleared so advancing timers triggers no renewal API call.
    const callsBeforeAdvance = $api.mock.calls.length
    await vi.advanceTimersByTimeAsync(120_000)
    expect($api.mock.calls.length).toBe(callsBeforeAdvance)

    // registrationFailed emits structured 'registration_failed' code.
    ua.emit('registrationFailed', { cause: 'Rejected' })
    expect(phone.state.phase).toBe('failed')
    expect(phone.state.failure).toBe('registration_failed')

    await phone.stop()
  })

  it('releases lease silently without triggering sibling failover when receiving a remote teardown message', async () => {
    const storage = new FakeStorage()
    const hub = new FakeBroadcastHub()
    const jssip = createFakeJsSip()
    const $api = vi.fn(async (_path: string, opts?: any) => (opts?.method === 'DELETE' ? { revoked: true } : SESSION_GRANT))

    const makeTab = (tabId: string) => useSoftphone({
      $api,
      identity: { userId: 7, companyId: 1 },
      loadLibrary: async () => jssip.lib,
      createChannel: name => hub.open(name),
      storage,
      ringtone: createFakeRingtone(),
      tabId,
      registerUnload: () => () => {},
    })

    const leader = makeTab('tab-leader')
    const followerInitiator = makeTab('tab-logout')
    const followerBystander = makeTab('tab-bystander')

    await leader.register()
    await followerInitiator.register()
    await followerBystander.register()

    expect(leader.state.isLeader).toBe(true)
    expect(jssip.agents).toHaveLength(1)

    // Follower initiates logout teardown -> leader must stop and release lease WITHOUT broadcasting leader-released.
    await followerInitiator.stop({ revoke: true, notifyTeardown: true, releaseFailover: false })
    await flush()

    expect(leader.state.isLeader).toBe(false)
    expect(followerBystander.state.isLeader).toBe(false)
    expect(jssip.agents).toHaveLength(1)
    expect(storage.getItem('liwan-softphone-leader:7:1')).toBeNull()

    await leader.stop({ revoke: false, notifyTeardown: false, releaseFailover: false })
    await followerBystander.stop({ revoke: false, notifyTeardown: false, releaseFailover: false })
  })

  it('revokes session on stop and swallows errors so logout is never blocked', async () => {
    const storage = new FakeStorage()
    const hub = new FakeBroadcastHub()
    const jssip = createFakeJsSip()
    const $api = vi.fn(async (_path: string, opts?: any) => {
      if (opts?.method === 'DELETE') throw new Error('network down')
      return SESSION_GRANT
    })

    const phone = useSoftphone({
      $api,
      identity: { userId: 7, companyId: 1 },
      loadLibrary: async () => jssip.lib,
      createChannel: name => hub.open(name),
      storage,
      ringtone: createFakeRingtone(),
      tabId: 'tab-stop',
      registerUnload: () => () => {},
    })

    await phone.register()
    const ua = jssip.agents[0]!
    await expect(phone.stop()).resolves.toBeUndefined()

    expect(ua.stopped).toBe(true)
    expect($api).toHaveBeenCalledWith('/api/v1/telephony/session', expect.objectContaining({ method: 'DELETE' }))
    expect(storage.getItem('liwan-softphone-leader:7:1')).toBeNull()
  })
})

describe('createCallChip & useCallChipHost lifecycle', () => {
  it('loads caller card via /api/v1/telephony/lookup and builds saveContactTo only for unknown callers with customers.manage', async () => {
    const storage = new FakeStorage()
    const hub = new FakeBroadcastHub()
    const jssip = createFakeJsSip()
    const me = Vue.ref({
      id: 7,
      tz: 'Asia/Riyadh',
      company: { id: 1 },
      capabilities: ['telephony.use', 'customers.manage'],
    })
    let canManageCustomers = true
    const $api = vi.fn(async (path: string, opts?: any) => {
      if (path === '/api/v1/telephony/session' && opts?.method === 'POST') return SESSION_GRANT
      if (path === '/api/v1/telephony/session' && opts?.method === 'DELETE') return { revoked: true }
      if (path === '/api/v1/telephony/lookup') {
        expect(opts.schema).toBe(TelephonyLookupSchema)
        if (opts.query.number === '+966501234567') {
          return {
            number: '+966501234567',
            partner: { id: 42, name: 'سارة العتيبي', isCompany: false, company: { id: 9, name: 'الرواد' } },
            calls: [{
              id: 11,
              linkedid: 'l-1',
              direction: 'in',
              state: 'answered',
              remoteNumber: '+966501234567',
              partner: { id: 42, name: 'سارة العتيبي' },
              user: { id: 7, name: 'أحمد' },
              extension: { id: 1, name: '1001' },
              startedAt: '2026-11-27T10:00:00Z',
              answeredAt: '2026-11-27T10:00:05Z',
              endedAt: '2026-11-27T10:01:05Z',
              durationSeconds: 60,
              recordingState: 'none',
              companyId: 1,
            }],
          }
        }
        return { number: '+966559876543', partner: null, calls: [] }
      }
      throw new Error(`unexpected api call: ${path}`)
    })

    let currentPath = '/calls?state=answered'
    const handle = createCallChip(
      {
        $api,
        t: key => key,
        me,
        can: cap => (cap === 'customers.manage' ? canManageCustomers : true),
        currentPath: () => currentPath,
      },
      {
        loadLibrary: async () => jssip.lib,
        createChannel: name => hub.open(name),
        storage,
        ringtone: createFakeRingtone(),
        registerUnload: () => () => {},
      },
    )

    await flush()
    const ua = jssip.agents[0]!

    // Known caller
    ua.simulateIncoming('+966501234567')
    await flush()
    expect(handle.seam.state.value.callerCard).toMatchObject({
      partnerName: 'سارة العتيبي',
      companyName: 'الرواد',
      number: '+966501234567',
      saveContactTo: null,
    })
    expect(handle.seam.state.value.callerCard?.recentCalls).toHaveLength(1)
    expect(handle.seam.state.value.callerCard?.recentCalls[0]?.duration).toBe('1:00')

    handle.seam.actions.reject()
    await flush()
    expect(handle.seam.state.value.callerCard).toBeNull()

    // Unknown external caller on a non-/customers path omits returnTo.
    ua.simulateIncoming('+966559876543')
    await flush()
    expect(handle.seam.state.value.callerCard).toMatchObject({
      partnerName: null,
      number: '+966559876543',
      saveContactTo: '/customers/new?phone=%2B966559876543',
    })

    // Unknown external caller while on /customers?q=sara appends returnTo.
    handle.seam.actions.reject()
    await flush()
    currentPath = '/customers?q=sara'
    ua.simulateIncoming('+966559876543')
    await flush()
    expect(handle.seam.state.value.callerCard?.saveContactTo).toBe('/customers/new?phone=%2B966559876543&returnTo=%2Fcustomers%3Fq%3Dsara')

    // Unknown caller without customers.manage
    handle.seam.actions.reject()
    await flush()
    canManageCustomers = false
    ua.simulateIncoming('+966559876543')
    await flush()
    expect(handle.seam.state.value.callerCard?.saveContactTo).toBeNull()

    // Internal extension skips /api/v1/telephony/lookup and never offers saveContactTo.
    handle.seam.actions.reject()
    await flush()
    canManageCustomers = true
    const lookupCallsBefore = $api.mock.calls.filter(([path]) => path === '/api/v1/telephony/lookup').length
    ua.simulateIncoming('1002')
    await flush()
    expect($api.mock.calls.filter(([path]) => path === '/api/v1/telephony/lookup').length).toBe(lookupCallsBefore)
    expect(handle.seam.state.value.callerCard).toBeNull()

    // Dial/transfer unavailable error translates to telephony.chip.phoneNotReady, distinct from invalidNumber.
    expect(handle.seam.actions.call('bad')).toBe('telephony.chip.invalidNumber')
    expect(handle.seam.actions.call('1002')).toBe('telephony.chip.phoneNotReady')
    expect(handle.seam.actions.transfer('1002')).toBe('telephony.chip.phoneNotReady')

    // Failure codes are translated through telephony.chip.failure.* keys (never raw English strings).
    ua.emit('disconnected')
    await flush()
    expect(handle.seam.state.value.failure).toBe('telephony.chip.failure.connectionClosed')
    ua.emit('registrationFailed', { cause: 'Rejected' })
    await flush()
    expect(handle.seam.state.value.failure).toBe('telephony.chip.failure.registrationFailed')

    await handle.stop()
  })

  it('clears callerCard immediately on remote change and ignores stale out-of-order lookup responses', async () => {
    const storage = new FakeStorage()
    const hub = new FakeBroadcastHub()
    const jssip = createFakeJsSip()
    const me = Vue.ref({
      id: 7,
      tz: 'Asia/Riyadh',
      company: { id: 1 },
      capabilities: ['telephony.use', 'customers.manage'],
    })
    const lookupResolvers = new Map<string, (value: any) => void>()
    const $api = vi.fn(async (path: string, opts?: any) => {
      if (path === '/api/v1/telephony/session' && opts?.method === 'POST') return SESSION_GRANT
      if (path === '/api/v1/telephony/session' && opts?.method === 'DELETE') return { revoked: true }
      if (path === '/api/v1/telephony/lookup') {
        return new Promise((resolve) => {
          lookupResolvers.set(opts.query.number, resolve)
        })
      }
      throw new Error(`unexpected api call: ${path}`)
    })

    const handle = createCallChip(
      {
        $api,
        t: key => key,
        me,
        can: () => true,
        currentPath: () => '/calls',
      },
      {
        loadLibrary: async () => jssip.lib,
        createChannel: name => hub.open(name),
        storage,
        ringtone: createFakeRingtone(),
        registerUnload: () => () => {},
      },
    )

    await flush()
    const ua = jssip.agents[0]!

    // First call lookup resolves normally.
    ua.simulateIncoming('+966501111111')
    await flush()
    lookupResolvers.get('+966501111111')!({
      number: '+966501111111',
      partner: { id: 1, name: 'المتصل الأول', isCompany: false, company: null },
      calls: [],
    })
    await flush()
    expect(handle.seam.state.value.callerCard?.partnerName).toBe('المتصل الأول')

    // End first call, start second call (pending lookup), then end and start third call.
    handle.seam.actions.reject()
    await flush()
    ua.simulateIncoming('+966502222222')
    await flush()
    expect(handle.seam.state.value.callerCard).toBeNull()

    handle.seam.actions.reject()
    await flush()
    ua.simulateIncoming('+966503333333')
    await flush()

    // Stale response for #2 resolves AFTER #3 started — must be ignored.
    lookupResolvers.get('+966502222222')!({
      number: '+966502222222',
      partner: { id: 2, name: 'متصل قديم', isCompany: false, company: null },
      calls: [],
    })
    await flush()
    expect(handle.seam.state.value.callerCard).toBeNull()

    // Current response for #3 resolves and updates callerCard.
    lookupResolvers.get('+966503333333')!({
      number: '+966503333333',
      partner: { id: 3, name: 'المتصل الثالث', isCompany: false, company: null },
      calls: [],
    })
    await flush()
    expect(handle.seam.state.value.callerCard?.partnerName).toBe('المتصل الثالث')

    await handle.stop()
  })

  it('tears down immediately on capability loss and on runSessionTeardown (logout/company switch)', async () => {
    const storage = new FakeStorage()
    const hub = new FakeBroadcastHub()
    const jssip = createFakeJsSip()
    const $api = vi.fn(async (_path: string, opts?: any) => (opts?.method === 'DELETE' ? { revoked: true } : SESSION_GRANT))

    const me = Vue.ref<any>({
      id: 7,
      company: { id: 1 },
      capabilities: ['telephony.use'],
      platform: { readable_features: ['telephony.enabled'], writable_features: ['telephony.enabled'] },
    })
    const hydrated = Vue.ref(true)

    let host!: ReturnType<typeof useCallChipHost>
    const container = { nodeType: 1 } as any
    const renderer = Vue.createRenderer({
      patchProp: () => {},
      insert: () => {},
      remove: () => {},
      createElement: () => ({}),
      createText: () => ({}),
      createComment: () => ({}),
      setText: () => {},
      setElementText: () => {},
      parentNode: () => null,
      nextSibling: () => null,
    })
    const mounted = renderer.createApp({
      setup() {
        host = useCallChipHost({
          surface: {
            capability: 'telephony.use',
            load: async () => ({
              createCallChip: ctx => createCallChip(ctx, {
                loadLibrary: async () => jssip.lib,
                createChannel: name => hub.open(name),
                storage,
                ringtone: createFakeRingtone(),
                registerUnload: () => () => {},
              }),
            }),
          },
          context: {
            $api,
            t: key => key,
            me,
            can: () => true,
            currentPath: () => '/calls',
          },
          hydrated,
          client: true,
        })
        return () => Vue.h('div')
      },
    })
    mounted.mount(container)
    await flush()

    expect(host.seam.value).not.toBeNull()
    expect(jssip.agents).toHaveLength(1)

    // Capability loss triggers immediate teardown + hides chip.
    me.value = { ...me.value, capabilities: [] }
    await flush()
    expect(host.seam.value).toBeNull()
    expect(jssip.agents[0]!.stopped).toBe(true)
    expect($api).toHaveBeenCalledWith('/api/v1/telephony/session', expect.objectContaining({ method: 'DELETE' }))

    // Restore capability -> re-mounts cleanly, then runSessionTeardown() tears down before logout / company switch.
    me.value = { ...me.value, capabilities: ['telephony.use'] }
    await flush()
    expect(host.seam.value).not.toBeNull()
    expect(jssip.agents).toHaveLength(2)

    await runSessionTeardown()
    expect(host.seam.value).toBeNull()
    expect(jssip.agents[1]!.stopped).toBe(true)

    // Failed company switch recovery: restoreSessionTeardown remounts the call chip cleanly.
    await restoreSessionTeardown()
    await flush()
    expect(host.seam.value).not.toBeNull()
    expect(jssip.agents).toHaveLength(3)

    mounted.unmount()
  })

  it('layout unmount releases leadership to sibling tabs without revoking the server session or broadcasting teardown', async () => {
    const storage = new FakeStorage()
    const hub = new FakeBroadcastHub()
    const jssip = createFakeJsSip()
    const $api = vi.fn(async (_path: string, opts?: any) => (opts?.method === 'DELETE' ? { revoked: true } : SESSION_GRANT))

    const me = Vue.ref<any>({
      id: 7,
      company: { id: 1 },
      capabilities: ['telephony.use'],
      platform: { readable_features: ['telephony.enabled'], writable_features: ['telephony.enabled'] },
    })
    const hydrated = Vue.ref(true)

    const renderer = Vue.createRenderer({
      patchProp: () => {},
      insert: () => {},
      remove: () => {},
      createElement: () => ({}),
      createText: () => ({}),
      createComment: () => ({}),
      setText: () => {},
      setElementText: () => {},
      parentNode: () => null,
      nextSibling: () => null,
    })

    const mountTab = (tabId: string) => {
      let host!: ReturnType<typeof useCallChipHost>
      const app = renderer.createApp({
        setup() {
          host = useCallChipHost({
            surface: {
              capability: 'telephony.use',
              load: async () => ({
                createCallChip: ctx => createCallChip(ctx, {
                  loadLibrary: async () => jssip.lib,
                  createChannel: name => hub.open(name),
                  storage,
                  tabId,
                  ringtone: createFakeRingtone(),
                  registerUnload: () => () => {},
                }),
              }),
            },
            context: {
              $api,
              t: key => key,
              me,
              can: () => true,
              currentPath: () => '/calls',
            },
            hydrated,
            client: true,
          })
          return () => Vue.h('div')
        },
      })
      app.mount({ nodeType: 1 } as any)
      return { app, getHost: () => host }
    }

    const tabA = mountTab('host-tab-a')
    await flush()
    const tabB = mountTab('host-tab-b')
    await flush()

    expect(tabA.getHost().seam.value?.state.value.isLeader).toBe(true)
    expect(tabB.getHost().seam.value?.state.value.isLeader).toBe(false)
    expect(jssip.agents).toHaveLength(1)

    // Unmounting tab A's layout must NOT DELETE /api/v1/telephony/session and must let tab B take over leadership.
    tabA.app.unmount()
    await flush()
    await flush()

    expect($api).not.toHaveBeenCalledWith('/api/v1/telephony/session', expect.objectContaining({ method: 'DELETE' }))
    expect(tabB.getHost().seam.value?.state.value.isLeader).toBe(true)
    expect(jssip.agents).toHaveLength(2)

    tabB.app.unmount()
    await flush()
  })
})
