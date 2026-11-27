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
import { runSessionTeardown } from '../app/utils/sessionTeardown'

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
  hold = vi.fn(() => { this.emit('hold') })
  unhold = vi.fn(() => { this.emit('unhold') })
  sendDTMF = vi.fn()
  refer = vi.fn((_target: string, opts?: { eventHandlers?: Record<string, (e?: any) => void> }) => {
    this.lastReferOpts = opts
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
    expect(ua.registerCalls).toBe(1)

    await phone.stop()
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

    const handle = createCallChip(
      {
        $api,
        t: key => key,
        me,
        can: cap => (cap === 'customers.manage' ? canManageCustomers : true),
        currentPath: () => '/calls?state=answered',
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

    // Unknown caller with customers.manage
    ua.simulateIncoming('+966559876543')
    await flush()
    expect(handle.seam.state.value.callerCard).toMatchObject({
      partnerName: null,
      number: '+966559876543',
      saveContactTo: '/customers/new?phone=%2B966559876543&returnTo=%2Fcalls%3Fstate%3Danswered',
    })

    // Unknown caller without customers.manage
    handle.seam.actions.reject()
    await flush()
    canManageCustomers = false
    ua.simulateIncoming('+966559876543')
    await flush()
    expect(handle.seam.state.value.callerCard?.saveContactTo).toBeNull()

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

    mounted.unmount()
  })
})
