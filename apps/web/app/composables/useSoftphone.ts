import { computed, getCurrentInstance, onBeforeUnmount, reactive } from 'vue'
import { TelephonySessionSchema, type TelephonySession } from '@liwan/contracts'
import type { ZodType } from 'zod'

/**
 * The softphone: the one place the browser talks to Asterisk (design D3, 4.1, 4.2).
 *
 * The phone holds no credential of its own. Only the single elected leader tab per `(userId, companyId)` asks Odoo for
 * a short-lived SIP session (`POST /api/v1/telephony/session`), opens the JsSIP WebSocket, attaches remote audio and
 * ringtone, and renews credentials before expiry. Follower tabs mirror the leader's state over `BroadcastChannel` and
 * forward every user command to the leader, claiming leadership automatically if the leader tab closes or expires.
 */

export type PhonePhase = 'idle' | 'connecting' | 'registered' | 'ringing' | 'calling' | 'in-call' | 'failed'

export type PhoneFailureCode =
  | 'connection_closed'
  | 'registration_failed'
  | 'renewal_failed'
  | 'start_failed'
  | 'call_failed'

export interface SoftphoneStopOptions {
  revoke?: boolean
  notifyTeardown?: boolean
  releaseFailover?: boolean
}

export interface PhoneState {
  phase: PhonePhase
  remote: string | null
  registeredAs: string | null
  since: number | null
  failure: PhoneFailureCode | null
  hasExtension: boolean
  isLeader: boolean
  muted: boolean
  held: boolean
  transferring: boolean
  transferError: string | null
}

export interface SoftphoneIdentity {
  userId: number
  companyId: number
}

export interface BroadcastChannelLike {
  postMessage: (message: unknown) => void
  close: () => void
  addEventListener: (type: 'message', listener: (event: { data: unknown }) => void) => void
  removeEventListener: (type: 'message', listener: (event: { data: unknown }) => void) => void
}

export interface StorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export interface AudioSinkLike {
  autoplay: boolean
  srcObject: unknown
  play?: () => Promise<void> | void
}

export interface RingtonePlayer {
  start: () => void
  stop: () => void
}

export interface SoftphoneApi {
  <T>(
    path: string,
    opts?: { method?: string; body?: unknown; query?: Record<string, unknown>; schema?: ZodType<T>; signal?: AbortSignal },
  ): Promise<T>
}

export interface SoftphoneOptions {
  $api?: SoftphoneApi
  identity?: SoftphoneIdentity | (() => SoftphoneIdentity | null)
  loadLibrary?: () => Promise<any>
  createChannel?: (name: string) => BroadcastChannelLike | null
  storage?: StorageLike | null
  now?: () => number
  tabId?: string
  createAudio?: () => AudioSinkLike | null
  ringtone?: RingtonePlayer
  registerUnload?: (handler: () => void) => () => void
  leaseTtlMs?: number
  heartbeatMs?: number
  revokeTimeoutMs?: number
}

export type DialTargetResult =
  | { ok: true; kind: 'extension' | 'e164'; value: string }
  | { ok: false; reason: 'empty' | 'invalid' }

export type DialActionError = 'empty' | 'invalid' | 'unavailable' | null

const LEASE_TTL_MS = 10_000
const HEARTBEAT_MS = 4_000
const REVOKE_TIMEOUT_MS = 2_000
const MIN_RENEWAL_MS = 15_000
const MIN_RECONNECT_RENEWAL_MS = 1_000
const RENEWAL_LEAD_SECONDS = 20

const E164_PATTERN = /^\+[1-9]\d{6,14}$/
const EXTENSION_PATTERN = /^\d{2,10}$/
const DTMF_PATTERN = /^[0-9*#A-D]$/i

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits as ASCII digits. */
function toAsciiDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06F0))
}

/**
 * Normalizes what a user typed for dialing or blind transfer.
 *
 * International numbers (`+...`, `00...`) and local Saudi mobile numbers (`05xxxxxxxx`, `5xxxxxxxx`, `966...`) are
 * normalized to E.164 (`^\+[1-9]\d{6,14}$`). Otherwise, 2–10 ASCII digits are dialed as an internal extension.
 */
export function normalizeDialTarget(raw: string): DialTargetResult {
  const cleaned = toAsciiDigits(raw).trim().replace(/[\s\-().]/g, '')
  if (!cleaned) return { ok: false, reason: 'empty' }

  // Explicit international prefix (`+` or `00`) or local Saudi number (`05xxxxxxxx`, `5xxxxxxxx`, `966...`).
  const isInternationalOrLocalMobile =
    cleaned.startsWith('+')
    || cleaned.startsWith('00')
    || /^05\d{8}$/.test(cleaned)
    || /^5\d{8}$/.test(cleaned)
    || /^966\d{8,9}$/.test(cleaned)

  if (isInternationalOrLocalMobile) {
    let e164 = cleaned
    if (e164.startsWith('00')) e164 = `+${e164.slice(2)}`
    else if (e164.startsWith('966')) e164 = `+${e164}`
    else if (e164.startsWith('05')) e164 = `+966${e164.slice(1)}`
    else if (e164.startsWith('5')) e164 = `+966${e164}`
    e164 = e164.replace(/^\+9660/, '+966')
    return E164_PATTERN.test(e164)
      ? { ok: true, kind: 'e164', value: e164 }
      : { ok: false, reason: 'invalid' }
  }

  if (EXTENSION_PATTERN.test(cleaned)) {
    return { ok: true, kind: 'extension', value: cleaned }
  }

  return { ok: false, reason: 'invalid' }
}

/** Web Audio API two-tone ringtone (440 Hz + 480 Hz, pulsing), safe in headless / autoplay-restricted environments. */
function createWebAudioRingtone(): RingtonePlayer {
  let ctx: AudioContext | null = null
  let pulseTimer: ReturnType<typeof setInterval> | null = null
  let activeNodes: Array<{ stop?: () => void; disconnect?: () => void }> = []

  function silencePulse() {
    for (const node of activeNodes) {
      try { node.stop?.() } catch {}
      try { node.disconnect?.() } catch {}
    }
    activeNodes = []
  }

  function playBurst() {
    if (!ctx) return
    silencePulse()
    try {
      const gain = ctx.createGain()
      gain.gain.value = 0.08
      gain.connect(ctx.destination)
      const oscA = ctx.createOscillator()
      const oscB = ctx.createOscillator()
      oscA.type = 'sine'
      oscB.type = 'sine'
      oscA.frequency.value = 440
      oscB.frequency.value = 480
      oscA.connect(gain)
      oscB.connect(gain)
      const startAt = ctx.currentTime
      oscA.start(startAt)
      oscB.start(startAt)
      oscA.stop(startAt + 1.0)
      oscB.stop(startAt + 1.0)
      activeNodes = [oscA, oscB, gain]
    } catch {
      silencePulse()
    }
  }

  return {
    start() {
      if (pulseTimer || typeof window === 'undefined') return
      const AudioCtx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioCtx) return
      try {
        ctx = new AudioCtx()
        playBurst()
        pulseTimer = setInterval(playBurst, 3_000)
      } catch {
        this.stop()
      }
    },
    stop() {
      if (pulseTimer) clearInterval(pulseTimer)
      pulseTimer = null
      silencePulse()
      if (ctx) {
        try { void ctx.close() } catch {}
        ctx = null
      }
    },
  }
}

interface LeaseRecord {
  tabId: string
  expiresAt: number
}

interface ChannelMessage {
  type: 'state' | 'state-request' | 'cmd' | 'leader-released' | 'teardown'
  tabId: string
  state?: Omit<PhoneState, 'isLeader'>
  action?: 'answer' | 'reject' | 'hangUp' | 'call' | 'toggleMute' | 'toggleHold' | 'transfer' | 'sendDtmf' | 'retry'
  arg?: string
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { status?: unknown; statusCode?: unknown }
  return e.status === 404 || e.statusCode === 404
}

function defaultTabId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function useSoftphone(options: SoftphoneOptions = {}) {
  const $api: SoftphoneApi = options.$api ?? useApi().$api
  const now = options.now ?? (() => Date.now())
  const tabId = options.tabId ?? defaultTabId()
  const leaseTtlMs = options.leaseTtlMs ?? LEASE_TTL_MS
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS
  const revokeTimeoutMs = options.revokeTimeoutMs ?? REVOKE_TIMEOUT_MS
  const ringtone = options.ringtone ?? createWebAudioRingtone()

  const storage: StorageLike | null = 'storage' in options
    ? (options.storage ?? null)
    : (typeof localStorage !== 'undefined' ? localStorage : null)

  const createChannel = options.createChannel ?? ((name: string): BroadcastChannelLike | null => {
    if (typeof BroadcastChannel === 'undefined') return null
    try { return new BroadcastChannel(name) } catch { return null }
  })

  const createAudio = options.createAudio ?? ((): AudioSinkLike | null => {
    if (typeof Audio === 'undefined') return null
    const el = new Audio()
    el.autoplay = true
    return el
  })

  const loadLibrary = options.loadLibrary ?? (async (): Promise<any> => {
    // Loaded on demand only when the leader tab actually registers; kept out of the initial page payload.
    const module = await import('jssip')
    return (module as any).default ?? module
  })

  const registerUnload = options.registerUnload ?? ((handler: () => void) => {
    if (typeof window === 'undefined') return () => {}
    window.addEventListener('beforeunload', handler)
    window.addEventListener('pagehide', handler)
    return () => {
      window.removeEventListener('beforeunload', handler)
      window.removeEventListener('pagehide', handler)
    }
  })

  const state = reactive<PhoneState>({
    phase: 'idle',
    remote: null,
    registeredAs: null,
    since: null,
    failure: null,
    hasExtension: true,
    isLeader: false,
    muted: false,
    held: false,
    transferring: false,
    transferError: null,
  })

  const isBusy = computed(() => state.phase === 'ringing' || state.phase === 'calling' || state.phase === 'in-call')

  let ua: any = null
  let activeSession: any = null
  let currentGrant: TelephonySession | null = null
  let grantExpiresAt: number | null = null
  let sipHost = ''
  let channel: BroadcastChannelLike | null = null
  let leaseKey: string | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let monitorTimer: ReturnType<typeof setInterval> | null = null
  let renewalTimer: ReturnType<typeof setTimeout> | null = null
  let remoteAudio: AudioSinkLike | null = null
  let unregisterUnload: (() => void) | null = null
  let localTerminating = false
  let stopped = false
  let hadGrantedSession = false
  let connectGeneration = 0
  let renewGeneration = 0
  const attachedSessions = new WeakSet<object>()

  function resolveIdentity(): SoftphoneIdentity | null {
    if (typeof options.identity === 'function') return options.identity()
    if (options.identity) return options.identity
    return null
  }

  function snapshotState(): Omit<PhoneState, 'isLeader'> {
    return {
      phase: state.phase,
      remote: state.remote,
      registeredAs: state.registeredAs,
      since: state.since,
      failure: state.failure,
      hasExtension: state.hasExtension,
      muted: state.muted,
      held: state.held,
      transferring: state.transferring,
      transferError: state.transferError,
    }
  }

  function broadcast(message: ChannelMessage) {
    try { channel?.postMessage(message) } catch {}
  }

  function broadcastState() {
    if (!state.isLeader) return
    broadcast({ type: 'state', tabId, state: snapshotState() })
  }

  function applyState(patch: Partial<Omit<PhoneState, 'isLeader'>>) {
    Object.assign(state, patch)
    if (state.phase !== 'ringing') ringtone.stop()
    broadcastState()
  }

  function clearCallFields(nextPhase?: PhonePhase, failure: PhoneFailureCode | null = null) {
    ringtone.stop()
    detachAudio()
    activeSession = null
    localTerminating = false
    const fallbackPhase: PhonePhase = nextPhase ?? (ua?.isRegistered?.() ? 'registered' : 'idle')
    applyState({
      phase: fallbackPhase,
      remote: null,
      since: null,
      failure,
      muted: false,
      held: false,
      transferring: false,
      transferError: null,
    })
  }

  function detachAudio() {
    if (remoteAudio) {
      remoteAudio.srcObject = null
    }
  }

  function attachRemoteStream(stream: unknown) {
    if (!remoteAudio) remoteAudio = createAudio()
    if (!remoteAudio) return
    remoteAudio.autoplay = true
    remoteAudio.srcObject = stream
    try {
      const result = remoteAudio.play?.()
      if (result && typeof (result as Promise<void>).catch === 'function') {
        void (result as Promise<void>).catch(() => {})
      }
    } catch {}
  }

  function readLease(): LeaseRecord | null {
    if (!storage || !leaseKey) return null
    try {
      const raw = storage.getItem(leaseKey)
      if (!raw) return null
      const parsed = JSON.parse(raw) as Partial<LeaseRecord>
      if (typeof parsed.tabId === 'string' && typeof parsed.expiresAt === 'number') {
        return { tabId: parsed.tabId, expiresAt: parsed.expiresAt }
      }
    } catch {}
    return null
  }

  function writeLease(): boolean {
    if (!storage || !leaseKey) return true
    try {
      storage.setItem(leaseKey, JSON.stringify({ tabId, expiresAt: now() + leaseTtlMs }))
      const confirmed = readLease()
      return confirmed?.tabId === tabId
    } catch {
      return true
    }
  }

  function releaseLease(notify = true) {
    if (storage && leaseKey) {
      const current = readLease()
      if (current?.tabId === tabId) {
        try { storage.removeItem(leaseKey) } catch {}
      }
    }
    if (notify) broadcast({ type: 'leader-released', tabId })
  }

  function clearTimers() {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    heartbeatTimer = null
    if (monitorTimer) clearInterval(monitorTimer)
    monitorTimer = null
    if (renewalTimer) clearTimeout(renewalTimer)
    renewalTimer = null
  }

  function stopUaOnly() {
    connectGeneration += 1
    ringtone.stop()
    detachAudio()
    if (renewalTimer) clearTimeout(renewalTimer)
    renewalTimer = null
    grantExpiresAt = null
    const agent = ua
    ua = null
    activeSession = null
    localTerminating = false
    if (agent) {
      try { agent.stop() } catch {}
    }
  }

  function failUa(code: PhoneFailureCode) {
    if (renewalTimer) clearTimeout(renewalTimer)
    renewalTimer = null
    const current = activeSession
    activeSession = null
    localTerminating = true
    if (current) {
      try { current.terminate() } catch {}
    }
    clearCallFields('failed', code)
  }

  function armRenewal(delayMs: number) {
    if (renewalTimer) clearTimeout(renewalTimer)
    renewalTimer = setTimeout(() => {
      renewalTimer = null
      void renewSession()
    }, delayMs)
  }

  function scheduleRenewal(expiresInSeconds: number) {
    const delayMs = Math.max((expiresInSeconds - RENEWAL_LEAD_SECONDS) * 1000, MIN_RENEWAL_MS)
    armRenewal(delayMs)
  }

  function scheduleRenewalFromExpiry() {
    if (grantExpiresAt === null) return
    const delayMs = Math.max(grantExpiresAt - now() - RENEWAL_LEAD_SECONDS * 1000, MIN_RECONNECT_RENEWAL_MS)
    armRenewal(delayMs)
  }

  async function renewSession() {
    if (stopped || !state.isLeader) return
    const myConnectGen = connectGeneration
    const myRenewGen = ++renewGeneration
    try {
      const nextGrant = await $api('/api/v1/telephony/session', { method: 'POST', schema: TelephonySessionSchema })
      if (stopped || !state.isLeader || myConnectGen !== connectGeneration || myRenewGen !== renewGeneration) return
      hadGrantedSession = true
      currentGrant = nextGrant
      grantExpiresAt = now() + nextGrant.expiresInSeconds * 1000
      sipHost = new URL(nextGrant.wsUrl).hostname
      scheduleRenewal(nextGrant.expiresInSeconds)
      if (ua) {
        try {
          ua.set?.('authorization_user', nextGrant.authUsername)
          ua.set?.('password', nextGrant.password)
          if (typeof ua.register === 'function') ua.register()
        } catch {}
      }
    } catch (error) {
      if (stopped || !state.isLeader || myConnectGen !== connectGeneration || myRenewGen !== renewGeneration) return
      if (isNotFoundError(error)) {
        stopUaOnly()
        applyState({
          hasExtension: false,
          phase: 'idle',
          registeredAs: null,
          remote: null,
          since: null,
          failure: null,
          muted: false,
          held: false,
          transferring: false,
          transferError: null,
        })
        return
      }
      // Never drop an active call on a transient renewal failure; retry on the minimum cadence.
      if (activeSession) {
        scheduleRenewal(RENEWAL_LEAD_SECONDS)
        return
      }
      applyState({
        phase: 'failed',
        failure: 'renewal_failed',
      })
    }
  }

  function attachSessionHandlers(session: any) {
    if (!session || typeof session !== 'object' || attachedSessions.has(session)) return
    attachedSessions.add(session)

    session.on?.('peerconnection', (data: any) => {
      const pc = data?.peerconnection
      if (!pc || typeof pc.addEventListener !== 'function') return
      pc.addEventListener('track', (event: any) => {
        const stream = event?.streams?.[0] ?? (event?.track && typeof MediaStream !== 'undefined' ? new MediaStream([event.track]) : null)
        if (stream) attachRemoteStream(stream)
      })
    })

    session.on?.('confirmed', () => {
      if (activeSession !== session) return
      ringtone.stop()
      applyState({
        phase: 'in-call',
        since: now(),
        failure: null,
      })
    })

    session.on?.('muted', () => {
      if (activeSession !== session) return
      applyState({ muted: true })
    })

    session.on?.('unmuted', () => {
      if (activeSession !== session) return
      applyState({ muted: false })
    })

    session.on?.('hold', (event: any) => {
      if (activeSession !== session || event?.originator !== 'local') return
      applyState({ held: true })
    })

    session.on?.('unhold', (event: any) => {
      if (activeSession !== session || event?.originator !== 'local') return
      applyState({ held: false })
    })

    session.on?.('ended', () => {
      if (activeSession !== session) return
      clearCallFields()
    })

    session.on?.('failed', (event: any) => {
      if (activeSession !== session) return
      if (localTerminating) {
        clearCallFields()
        return
      }
      clearCallFields(ua?.isRegistered?.() ? 'registered' : 'idle', null)
      // Remote failure on an active attempt reports only if UA itself is no longer registered.
      if (!ua?.isRegistered?.() && event?.cause) {
        applyState({ phase: 'failed', failure: 'call_failed' })
      }
    })
  }

  async function connectSession() {
    if (stopped || !state.isLeader) return
    stopUaOnly()
    const gen = ++connectGeneration
    applyState({
      phase: 'connecting',
      failure: null,
      hasExtension: true,
      remote: null,
      since: null,
      muted: false,
      held: false,
      transferring: false,
      transferError: null,
    })

    try {
      const granted = await $api('/api/v1/telephony/session', { method: 'POST', schema: TelephonySessionSchema })
      if (stopped || !state.isLeader || gen !== connectGeneration) return
      hadGrantedSession = true
      currentGrant = granted
      grantExpiresAt = now() + granted.expiresInSeconds * 1000
      sipHost = new URL(granted.wsUrl).hostname

      const JsSIP = await loadLibrary()
      if (stopped || !state.isLeader || gen !== connectGeneration) return

      const socket = new JsSIP.WebSocketInterface(granted.wsUrl)
      const agent = new JsSIP.UA({
        sockets: [socket],
        uri: `sip:${granted.extension}@${sipHost}`,
        authorization_user: granted.authUsername,
        password: granted.password,
        register: true,
        register_expires: granted.expiresInSeconds,
        session_timers: false,
      })

      agent.on('registered', () => {
        if (ua !== agent) return
        applyState({
          phase: activeSession ? state.phase : 'registered',
          registeredAs: granted.extension,
          hasExtension: true,
          failure: null,
        })
        if (!renewalTimer && currentGrant && grantExpiresAt !== null) {
          scheduleRenewalFromExpiry()
        }
      })

      agent.on('registrationFailed', () => {
        if (ua !== agent) return
        failUa('registration_failed')
      })

      agent.on('disconnected', () => {
        if (ua !== agent || stopped) return
        if (state.phase !== 'idle') {
          failUa('connection_closed')
        }
      })

      agent.on('newRTCSession', (event: any) => {
        if (ua !== agent) return
        const incoming = event?.session
        if (!incoming) return
        if (event.originator === 'remote' && (activeSession || isBusy.value)) {
          try { incoming.terminate({ status_code: 486, reason_phrase: 'Busy Here' }) } catch {}
          return
        }
        activeSession = incoming
        localTerminating = false
        attachSessionHandlers(incoming)
        if (event.originator === 'remote') {
          applyState({
            phase: 'ringing',
            remote: incoming.remote_identity?.uri?.user ?? null,
            since: null,
            failure: null,
            muted: false,
            held: false,
            transferring: false,
            transferError: null,
          })
          ringtone.start()
        }
      })

      ua = agent
      scheduleRenewal(granted.expiresInSeconds)
      agent.start()
    } catch (error) {
      if (stopped || !state.isLeader || gen !== connectGeneration) return
      if (renewalTimer) clearTimeout(renewalTimer)
      renewalTimer = null
      grantExpiresAt = null
      if (isNotFoundError(error)) {
        // 404 means this user has no assigned extension: stay quietly idle, never enter failed or retry.
        currentGrant = null
        applyState({
          hasExtension: false,
          phase: 'idle',
          registeredAs: null,
          remote: null,
          since: null,
          failure: null,
          muted: false,
          held: false,
          transferring: false,
          transferError: null,
        })
        return
      }
      applyState({
        phase: 'failed',
        failure: 'start_failed',
      })
    }
  }

  function startLeaderHeartbeat() {
    if (monitorTimer) clearInterval(monitorTimer)
    monitorTimer = null
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    heartbeatTimer = setInterval(() => {
      if (stopped || !state.isLeader) return
      const current = readLease()
      if (current && current.tabId !== tabId && current.expiresAt > now()) {
        // Another tab took leadership; demote cleanly.
        state.isLeader = false
        stopUaOnly()
        startFollowerMonitor()
        broadcast({ type: 'state-request', tabId })
        return
      }
      writeLease()
    }, heartbeatMs)
  }

  function startFollowerMonitor() {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    heartbeatTimer = null
    if (monitorTimer) clearInterval(monitorTimer)
    monitorTimer = setInterval(() => {
      if (stopped || state.isLeader) return
      const lease = readLease()
      if (!lease || lease.expiresAt <= now()) {
        void tryClaimLeadership()
      }
    }, heartbeatMs)
  }

  async function tryClaimLeadership() {
    if (stopped) return
    const existing = readLease()
    const canClaim = !existing || existing.expiresAt <= now() || existing.tabId === tabId
    if (canClaim && writeLease()) {
      const wasLeader = state.isLeader
      state.isLeader = true
      startLeaderHeartbeat()
      if (!wasLeader || (!ua && state.hasExtension && state.phase === 'idle')) {
        await connectSession()
      } else {
        broadcastState()
      }
      return
    }
    state.isLeader = false
    startFollowerMonitor()
    broadcast({ type: 'state-request', tabId })
  }

  function onChannelMessage(event: { data: unknown }) {
    if (stopped) return
    const msg = event?.data as ChannelMessage | undefined
    if (!msg || typeof msg !== 'object' || msg.tabId === tabId) return

    if (msg.type === 'teardown') {
      void stop({ revoke: false, notifyTeardown: false, releaseFailover: false })
      return
    }

    if (state.isLeader) {
      if (msg.type === 'state-request') {
        broadcastState()
      } else if (msg.type === 'cmd' && msg.action) {
        if (msg.action === 'answer') answer()
        else if (msg.action === 'reject') reject()
        else if (msg.action === 'hangUp') hangUp()
        else if (msg.action === 'call' && msg.arg) call(msg.arg)
        else if (msg.action === 'toggleMute') toggleMute()
        else if (msg.action === 'toggleHold') toggleHold()
        else if (msg.action === 'transfer' && msg.arg) transfer(msg.arg)
        else if (msg.action === 'sendDtmf' && msg.arg) sendDtmf(msg.arg)
        else if (msg.action === 'retry') void retry()
      }
      return
    }

    // Follower handling
    if (msg.type === 'state' && msg.state) {
      Object.assign(state, msg.state)
      state.isLeader = false
    } else if (msg.type === 'leader-released') {
      void tryClaimLeadership()
    }
  }

  function ensureCoordination() {
    const identity = resolveIdentity()
    const scope = identity ? `${identity.userId}:${identity.companyId}` : 'default'
    const nextLeaseKey = `liwan-softphone-leader:${scope}`
    const nextChannelName = `liwan-softphone:${scope}`

    if (leaseKey !== nextLeaseKey || !channel) {
      if (channel) {
        channel.removeEventListener('message', onChannelMessage)
        try { channel.close() } catch {}
      }
      leaseKey = nextLeaseKey
      channel = createChannel(nextChannelName)
      channel?.addEventListener('message', onChannelMessage)
    }

    if (!unregisterUnload) {
      unregisterUnload = registerUnload(() => {
        if (state.isLeader) releaseLease(true)
        stopUaOnly()
      })
    }
  }

  async function register() {
    stopped = false
    ensureCoordination()
    await tryClaimLeadership()
  }

  function call(raw: string): DialActionError {
    const parsed = normalizeDialTarget(raw)
    if (!parsed.ok) return parsed.reason

    if (isBusy.value) return 'unavailable'

    if (!state.isLeader) {
      if (state.phase !== 'registered') return 'unavailable'
      broadcast({ type: 'cmd', tabId, action: 'call', arg: parsed.value })
      return null
    }

    if (!ua?.isRegistered?.() || activeSession) return 'unavailable'
    const host = sipHost || ua._configuration?.uri?.host || ''
    const targetUri = `sip:${parsed.value}@${host}`
    const iceServers = currentGrant?.iceServers ?? []

    applyState({
      phase: 'calling',
      remote: parsed.value,
      since: null,
      failure: null,
      muted: false,
      held: false,
      transferring: false,
      transferError: null,
    })

    const outgoing = ua.call(targetUri, {
      mediaConstraints: { audio: true, video: false },
      pcConfig: { iceServers },
    })
    activeSession = outgoing
    localTerminating = false
    attachSessionHandlers(outgoing)
    return null
  }

  function answer() {
    if (!state.isLeader) {
      broadcast({ type: 'cmd', tabId, action: 'answer' })
      return
    }
    ringtone.stop()
    if (!activeSession) return
    const iceServers = currentGrant?.iceServers ?? []
    activeSession.answer({
      mediaConstraints: { audio: true, video: false },
      pcConfig: { iceServers },
    })
  }

  function reject() {
    if (!state.isLeader) {
      broadcast({ type: 'cmd', tabId, action: 'reject' })
      return
    }
    ringtone.stop()
    const current = activeSession
    localTerminating = true
    if (current) {
      try { current.terminate({ status_code: 486, reason_phrase: 'Busy Here' }) } catch {}
    }
    clearCallFields(ua?.isRegistered?.() ? 'registered' : 'idle', null)
  }

  function hangUp() {
    if (!state.isLeader) {
      broadcast({ type: 'cmd', tabId, action: 'hangUp' })
      return
    }
    ringtone.stop()
    const current = activeSession
    localTerminating = true
    if (current) {
      try { current.terminate() } catch {}
    }
    clearCallFields(ua?.isRegistered?.() ? 'registered' : 'idle', null)
  }

  function toggleMute() {
    if (!state.isLeader) {
      broadcast({ type: 'cmd', tabId, action: 'toggleMute' })
      return
    }
    if (!activeSession) return
    if (state.muted) {
      activeSession.unmute?.({ audio: true })
      applyState({ muted: false })
    } else {
      activeSession.mute?.({ audio: true })
      applyState({ muted: true })
    }
  }

  function toggleHold() {
    if (!state.isLeader) {
      broadcast({ type: 'cmd', tabId, action: 'toggleHold' })
      return
    }
    if (!activeSession) return
    if (state.held) {
      if (activeSession.unhold?.() === true) {
        applyState({ held: false })
      }
    } else {
      if (activeSession.hold?.() === true) {
        applyState({ held: true })
      }
    }
  }

  function transfer(raw: string): DialActionError {
    const parsed = normalizeDialTarget(raw)
    if (!parsed.ok) return parsed.reason

    if (!state.isLeader) {
      if (state.phase !== 'in-call') return 'unavailable'
      broadcast({ type: 'cmd', tabId, action: 'transfer', arg: parsed.value })
      return null
    }

    const session = activeSession
    if (!session || state.phase !== 'in-call') return 'unavailable'
    const host = sipHost || ua?._configuration?.uri?.host || ''
    const targetUri = `sip:${parsed.value}@${host}`

    applyState({ transferring: true, transferError: null })
    try {
      if (typeof session.refer !== 'function') {
        applyState({ transferring: false, transferError: 'failed' })
        return null
      }
      const started = session.refer(targetUri, {
        eventHandlers: {
          requestSucceeded() {
            if (activeSession !== session) return
            applyState({ transferring: false, transferError: null })
          },
          requestFailed(event: any) {
            if (activeSession !== session) return
            applyState({ transferring: false, transferError: event?.cause ? String(event.cause) : 'failed' })
          },
          accepted() {
            if (activeSession !== session) return
            applyState({ transferring: false, transferError: null })
          },
          failed(event: any) {
            if (activeSession !== session) return
            applyState({ transferring: false, transferError: event?.cause ? String(event.cause) : 'failed' })
          },
        },
      })
      if (started === false && activeSession === session) {
        applyState({ transferring: false, transferError: 'failed' })
      }
    } catch {
      if (activeSession === session) {
        applyState({ transferring: false, transferError: 'failed' })
      }
    }
    return null
  }

  function sendDtmf(digit: string) {
    if (!DTMF_PATTERN.test(digit)) return
    if (!state.isLeader) {
      broadcast({ type: 'cmd', tabId, action: 'sendDtmf', arg: digit })
      return
    }
    if (activeSession && state.phase === 'in-call') {
      activeSession.sendDTMF?.(digit)
    }
  }

  async function retry() {
    if (!state.isLeader) {
      broadcast({ type: 'cmd', tabId, action: 'retry' })
      return
    }
    await connectSession()
  }

  async function revokeServerSession() {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), revokeTimeoutMs)
    try {
      await $api('/api/v1/telephony/session', { method: 'DELETE', signal: controller.signal })
    } catch {
      // Best-effort revocation: never block logout, company switch, or unmount.
    } finally {
      clearTimeout(timer)
    }
  }

  async function stop(stopOptions: SoftphoneStopOptions = {}): Promise<void> {
    const {
      revoke = true,
      notifyTeardown = revoke,
      releaseFailover = !notifyTeardown,
    } = stopOptions
    const wasLeader = state.isLeader
    const shouldRevoke = revoke && (hadGrantedSession || (state.hasExtension && !wasLeader))
    stopped = true

    clearTimers()
    stopUaOnly()

    if (notifyTeardown) {
      broadcast({ type: 'teardown', tabId })
    }
    if (wasLeader) {
      releaseLease(releaseFailover)
    }

    if (channel) {
      channel.removeEventListener('message', onChannelMessage)
      try { channel.close() } catch {}
      channel = null
    }

    if (unregisterUnload) {
      unregisterUnload()
      unregisterUnload = null
    }

    currentGrant = null
    hadGrantedSession = false
    Object.assign(state, {
      phase: 'idle',
      remote: null,
      registeredAs: null,
      since: null,
      failure: null,
      isLeader: false,
      muted: false,
      held: false,
      transferring: false,
      transferError: null,
    })

    if (shouldRevoke) {
      await revokeServerSession()
    }
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(() => { void stop({ revoke: false, notifyTeardown: false, releaseFailover: true }) })
  }

  return {
    state,
    isBusy,
    register,
    call,
    answer,
    reject,
    hangUp,
    toggleMute,
    toggleHold,
    transfer,
    sendDtmf,
    retry,
    stop,
  }
}
