import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { CHAT_TYPING_MS } from '../utils/chatState'
import { clearTaskWriteAcknowledgements, reconcileTaskWriteEvent, taskKeys } from './useTasks'
import type { Task } from '@liwan/contracts'
import { isTaskDependentProjectKey } from './projectKeys'
import { inboxEventAffectsQuery } from './inbox/inboxEventQueries'

export interface BusNotification {
  id: number
  message: { type: string; payload?: any }
}

// Pure: parse one bus frame (the server always sends a JSON array of
// notifications, per addons/bus/static/src/workers/websocket_worker.js) and
// return the notifications plus the id to remember as `last` for the next
// subscribe/reconnect. `lastId` is undefined for an empty frame so the caller
// can leave its tracked `last` untouched rather than resetting it to undefined.
export function parseBusFrame(raw: string): { notifications: BusNotification[]; lastId?: number } {
  // Guarded: this runs straight inside the socket's `onmessage`, where a throw
  // would surface as an unhandled error with the frame lost either way. A
  // malformed or non-array frame is treated as "nothing to do" — the caller
  // then leaves its tracked `last` untouched, so the next reconnect replays
  // from the last id it actually understood.
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { notifications: [] }
  }
  if (!Array.isArray(parsed)) return { notifications: [] }
  const notifications = parsed as BusNotification[]
  const last = notifications.at(-1)
  return { notifications, lastId: last?.id }
}

// Pure: the unique task ids carried by a frame's `liwan/task` notifications,
// in first-seen order. A frame with several notifications for the same task
// (e.g. two quick writes) must only trigger one invalidation per query, not
// one per occurrence.
function collectIds(notifications: BusNotification[], type: string): number[] {
  const seen = new Set<number>()
  for (const notification of notifications) {
    if (notification.message?.type !== type) continue
    const id = notification.message.payload?.id
    if (typeof id === 'number') seen.add(id)
  }
  return [...seen]
}

export function collectTaskIds(notifications: BusNotification[]): number[] {
  return collectIds(notifications, 'liwan/task')
}

export function collectChatIds(notifications: BusNotification[]): number[] {
  return collectIds(notifications, 'liwan/chat')
}

export function collectInboxIds(notifications: BusNotification[]): number[] {
  return collectIds(notifications, 'liwan/inbox')
}

// Pure: exponential backoff, 1s doubling up to a 30s ceiling, with +/-20%
// jitter so many tabs reconnecting after a server bounce don't all land on
// the same instant. `attempt` is the 0-indexed retry count.
export function nextBackoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(1000 * 2 ** attempt, 30_000)
  const jitter = base * 0.2 * (random() * 2 - 1)
  return Math.round(base + jitter)
}

// Module-level singleton: one socket per tab regardless of how many
// components call useBus(). The query client is captured exactly once, by
// setBusQueryClient() from the client-only bus.client.ts plugin, and reused
// from the async WebSocket callbacks afterwards, since those callbacks run
// outside any component's setup and can't call useQueryClient() themselves.
//
// It is NOT captured by useBus() itself: useBus() is also called from
// shell/AppSidebar.vue (for `connected`), which renders during SSR, and
// useQueryClient() there would latch onto whichever request's query client
// happened to render first in this Node process - then get reused for every
// later request/user. See setBusQueryClient() below.
let queryClient: ReturnType<typeof useQueryClient> | null = null
let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let attempt = 0
let lastId = 0
let manuallyClosed = true
// Bumped by every connect()/disconnect() so a stale socket's onclose - which
// can still fire asynchronously after disconnect() has already moved on to
// a new connect() (e.g. a fast logout immediately followed by another
// login) - can tell it belongs to a superseded generation and no-op instead
// of scheduling a duplicate reconnect.
let generation = 0
const connected = ref(false)
export type ChatTypingEvent = { conversationId: number; userId: number; userName: string; isTyping: boolean }
/** Everyone typing right now, one entry per channel and user; an entry leaves when the user stops or after `CHAT_TYPING_MS`. */
export const chatTypists = ref<ChatTypingEvent[]>([])
/** A message removed for good (the company's «permanent» delete): open histories drop it, a refetch cannot tell them to. */
export type ChatDeletedEvent = { conversationId: number; messageId: number }
/** The permanent deletes of the latest bus frame, all of them: a later frame replaces the batch, so it never grows. */
export const chatDeletedBatch = ref<ChatDeletedEvent[]>([])
export function applyChatDeleted(notifications: ReadonlyArray<{ message?: { type?: string; payload?: Record<string, unknown> } }>): void {
  const deleted: ChatDeletedEvent[] = []
  for (const { message } of notifications) {
    const payload = message?.payload
    if (message?.type === 'liwan/chat' && payload?.event === 'message_deleted'
      && typeof payload.id === 'number' && typeof payload.message_id === 'number') {
      deleted.push({ conversationId: payload.id, messageId: payload.message_id })
    }
  }
  if (deleted.length) chatDeletedBatch.value = deleted
}
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>()
const typingKey = (event: Pick<ChatTypingEvent, 'conversationId' | 'userId'>) => `${event.conversationId}:${event.userId}`

function stopTyping(event: Pick<ChatTypingEvent, 'conversationId' | 'userId'>): void {
  const key = typingKey(event)
  const timer = typingTimers.get(key)
  if (timer) clearTimeout(timer)
  typingTimers.delete(key)
  chatTypists.value = chatTypists.value.filter(entry => typingKey(entry) !== key)
}

export function applyChatTyping(event: ChatTypingEvent): void {
  stopTyping(event)
  if (!event.isTyping) return
  chatTypists.value = [...chatTypists.value, event]
  typingTimers.set(typingKey(event), setTimeout(() => stopTyping(event), CHAT_TYPING_MS))
}

function clearChatPresence(): void {
  typingTimers.forEach(timer => clearTimeout(timer))
  typingTimers.clear()
  chatTypists.value = []
  chatDeletedBatch.value = []
}

// Called once, client-only, from bus.client.ts's plugin setup() (that file's
// .client.ts suffix guarantees it never runs during SSR). Captures the query
// client for use by the WebSocket callbacks below.
export function setBusQueryClient(client: ReturnType<typeof useQueryClient>): void {
  if (import.meta.server) {
    throw new Error('setBusQueryClient must only be called on the client (see plugins/bus.client.ts)')
  }
  queryClient = client
}

// addons/bus/websocket.py `WebsocketConnectionHandler._VERSION`: the server
// force-closes the connection with "OUTDATED_VERSION" unless the client's
// `?version=` query param matches this exactly (it only guards against
// stale cached JS across a deploy, not real compatibility - see
// `_serve_forever`). The real web client reads this from `session_info` via
// `/web/session/get_session_info`, which we do too (see
// resolveWorkerVersion) for any same-origin connection - i.e. production,
// and dev when NUXT_PUBLIC_WS_URL isn't set. This pinned value is only a
// fallback: for the dev cross-origin connection to :8069 (where that route
// can't be fetched - it isn't CORS-enabled) and as a last resort if the
// fetch fails for any other reason. If it ever goes stale in a fallback
// path, the server closes with "OUTDATED_VERSION" and the connect loop below
// gives up after 3 consecutive such closes rather than retrying forever.
const FALLBACK_WEBSOCKET_WORKER_VERSION = '19.0-2'

let cachedVersion: string | null = null
let warnedFallback = false

function warnFallbackOnce(reason: string) {
  if (warnedFallback) return
  warnedFallback = true
  console.warn(`[bus] using the pinned websocket worker version (${FALLBACK_WEBSOCKET_WORKER_VERSION}) - ${reason}`)
}

// Bounded so a hung request can't delay the socket open indefinitely - see
// resolveWorkerVersion. ofetch aborts the request itself once this elapses,
// which lands in the same catch block as any other fetch failure below.
const WORKER_VERSION_FETCH_TIMEOUT_MS = 3_000

// Resolves the websocket protocol version to send as `?version=`. Same-origin
// (production, and dev without NUXT_PUBLIC_WS_URL/wsUrl set): fetches the
// live value from /web/session/get_session_info and caches it for the tab.
// Cross-origin dev, that fetch failing, or it not completing within
// WORKER_VERSION_FETCH_TIMEOUT_MS: falls back to the pinned constant above
// and warns once.
async function resolveWorkerVersion(crossOrigin: boolean): Promise<string> {
  if (cachedVersion) return cachedVersion
  if (!crossOrigin) {
    try {
      const response = await $fetch<{ result?: { websocket_worker_version?: string } }>('/web/session/get_session_info', {
        method: 'POST',
        body: { jsonrpc: '2.0', method: 'call', params: {} },
        timeout: WORKER_VERSION_FETCH_TIMEOUT_MS,
      })
      const version = response?.result?.websocket_worker_version
      if (typeof version === 'string' && version) {
        cachedVersion = version
        return cachedVersion
      }
    } catch {
      // fall through to the pinned fallback below - covers both a request
      // error and the timeout above aborting the request
    }
    warnFallbackOnce('failed to fetch /web/session/get_session_info')
  } else {
    warnFallbackOnce('cross-origin dev connection cannot fetch /web/session/get_session_info (no CORS)')
  }
  return FALLBACK_WEBSOCKET_WORKER_VERSION
}

function invalidateTaskIds(client: ReturnType<typeof useQueryClient>, ids: number[], associationUnknown: boolean) {
  for (const id of ids) {
    client.invalidateQueries({ queryKey: taskKeys.detail(id) })
  }
  client.invalidateQueries({ queryKey: ['tasks', 'list'] })
  client.invalidateQueries({ queryKey: ['tasks', 'summary'] })
  client.invalidateQueries({ queryKey: ['tasks', 'attention'] })
  const projectIds = new Set<number>()
  let unknownProject = associationUnknown
  for (const id of ids) {
    const task = client.getQueryData<Task>(taskKeys.detail(id))
      ?? client.getQueriesData<{ pages: { items: Task[] }[] }>({ queryKey: ['tasks', 'list'] }).flatMap(([, data]) => data?.pages.flatMap(p => p.items) ?? []).find(t => t.id === id)
    if (!task) unknownProject = true
    else if (task.project) projectIds.add(task.project.id)
  }
  // A task event cannot change followers, project settings, or project updates.
  // Unknown/new tasks still refresh all aggregates so counts remain accurate.
  client.invalidateQueries({ queryKey: ['projects'], predicate: q => isTaskDependentProjectKey(q.queryKey, unknownProject ? undefined : projectIds) })
}

async function invalidateTaskEvents(client: ReturnType<typeof useQueryClient>, notifications: BusNotification[], ownGeneration: number) {
  const taskEvents = notifications.filter(n => n.message?.type === 'liwan/task' && typeof n.message.payload?.id === 'number')
  if (!taskEvents.length) return
  for (const id of collectTaskIds(taskEvents)) void client.invalidateQueries({ queryKey: taskKeys.timeline(id) })
  // Duplicate identical notifications in one frame consume a local acknowledgement once.
  const unique = [...new Map(taskEvents.map(n => [JSON.stringify(n.message.payload), n])).values()]
  // An operator can move tasks or their parent between projects. Mixed/unknown
  // origins lose that metadata, so a cached old project cannot safely scope them.
  const unknownAssociations = new Set(taskEvents.filter(({ message: { payload } }) => payload.source !== 'write'
    || !Array.isArray(payload.changed_fields) || !payload.changed_fields.length
    || payload.changed_fields.some((field: unknown) => typeof field !== 'string' || field === 'project_id' || field === 'parent_id'))
    .map(notification => notification.message.payload.id))
  const readyIds = new Set<number>()
  let queued = false
  const refresh = (id: number) => {
    readyIds.add(id)
    if (queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      const ids = [...readyIds]
      readyIds.clear()
      if (ownGeneration === generation && client === queryClient) invalidateTaskIds(client, ids, ids.some(id => unknownAssociations.has(id)))
    })
  }
  // A waiting local operation must not delay unrelated task events from the same frame.
  await Promise.all(unique.map(async notification => {
    if (!await reconcileTaskWriteEvent(client, notification.message.payload)) refresh(notification.message.payload.id)
  }))
}

function invalidateForFrame(notifications: BusNotification[]) {
  if (!queryClient) return
  void invalidateTaskEvents(queryClient, notifications, generation)
  const durableChat = notifications.filter(n => n.message?.type === 'liwan/chat' && n.message.payload?.event !== 'typing')
  const chatIds = new Set(collectChatIds(durableChat))
  const inboxEvents = notifications.filter(n => n.message?.type === 'liwan/inbox')
  const inboxIds = new Set(collectInboxIds(inboxEvents.filter(n => n.message.payload?.event !== 'template')))
  const templateIds = new Set(collectInboxIds(inboxEvents.filter(n => n.message.payload?.event === 'template')))
  if (!chatIds.size && !inboxIds.size && !templateIds.size) return
  const messageIds = new Set(collectChatIds(durableChat.filter(n => !['read_updated', 'conversation_updated'].includes(n.message.payload?.event))))
  const memberIds = new Set(collectChatIds(durableChat.filter(n => ['members_updated', 'conversation_left'].includes(n.message.payload?.event))))
  const client = queryClient
  const ownGeneration = generation
  const filters = {
    predicate: ({ queryKey: key, state }: { queryKey: readonly unknown[]; state: { data: unknown } }) => {
      if (key[0] === 'chat' && chatIds.size) {
        if (key[2] === 'list') return true
        if (!chatIds.has(key[3] as number)) return false
        if (key[2] === 'detail') return true
        if (key[2] === 'members') return memberIds.has(key[3] as number)
        return ['messages', 'attachments'].includes(key[2] as string) && messageIds.has(key[3] as number)
      }
      return inboxEventAffectsQuery(key, state.data, inboxIds, templateIds)
    },
    // Hidden tabs retain staleness and reconcile on return without doing background reads.
    refetchType: typeof document !== 'undefined' && document.visibilityState === 'hidden' ? 'none' as const : 'active' as const,
  }
  // An event can land after an ongoing read took its snapshot. Share that read,
  // then reconcile once instead of cancelling/restarting it for every frame.
  // A hidden invalidation resolves immediately; wait for the snapshot itself so
  // its success cannot clear the staleness needed when the tab becomes visible.
  const inFlight = client.getQueryCache().findAll(filters).filter(q => q.state.fetchStatus === 'fetching' && !trailingReconciliations.has(q.queryHash))
  const pendingReads = inFlight.map(query => query.promise)
  inFlight.forEach(q => trailingReconciliations.add(q.queryHash))
  void Promise.allSettled([client.invalidateQueries(filters, { cancelRefetch: false }), ...pendingReads]).then(() => {
    for (const query of inFlight) {
      trailingReconciliations.delete(query.queryHash)
      if (ownGeneration !== generation || client !== queryClient) continue
      void client.invalidateQueries({ queryKey: query.queryKey, exact: true, refetchType: typeof document !== 'undefined' && document.visibilityState === 'hidden' ? 'none' : 'active' }, { cancelRefetch: false })
    }
  })
}

const trailingReconciliations = new Set<string>()
let pendingNotifications: BusNotification[] = []
let invalidationQueued = false
function enqueueInvalidation(notifications: BusNotification[]) {
  pendingNotifications.push(...notifications)
  if (invalidationQueued) return
  invalidationQueued = true
  const ownGeneration = generation
  queueMicrotask(() => {
    if (ownGeneration !== generation) return
    invalidationQueued = false
    const pending = pendingNotifications
    pendingNotifications = []
    if (ownGeneration === generation) invalidateForFrame(pending)
  })
}

function reconcileVisibleQueries() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  void queryClient?.refetchQueries({ stale: true, type: 'active', predicate: q => q.queryKey[0] === 'chat' || q.queryKey[0] === 'inbox' }, { cancelRefetch: false })
}

function handleMessage(event: MessageEvent) {
  if (typeof event.data !== 'string') return
  const { notifications, lastId: newLast } = parseBusFrame(event.data)
  if (newLast !== undefined) lastId = newLast
  applyChatDeleted(notifications)
  for (const notification of notifications) {
    const payload = notification.message?.payload
    if (notification.message?.type !== 'liwan/chat' || payload?.event !== 'typing') continue
    if (typeof payload.id !== 'number' || typeof payload.user_id !== 'number') continue
    applyChatTyping({
      conversationId: payload.id,
      userId: payload.user_id,
      userName: typeof payload.user_name === 'string' ? payload.user_name : '',
      isTyping: Boolean(payload.is_typing),
    })
  }
  enqueueInvalidation(notifications)
}

function subscribe() {
  socket?.send(JSON.stringify({ event_name: 'subscribe', data: { channels: [], last: lastId } }))
}

function clearReconnectTimer() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

function scheduleReconnect() {
  clearReconnectTimer()
  const delay = nextBackoffDelay(attempt++)
  reconnectTimer = setTimeout(connect, delay)
}

// Consecutive closes carrying the server's "outdated worker version" reason.
// A stale pinned fallback (see FALLBACK_WEBSOCKET_WORKER_VERSION) would
// otherwise retry forever via backoff, hammering the server for no reason:
// the version mismatch never resolves itself without a client redeploy.
let versionCloseStreak = 0
let stopped = false

async function connect() {
  clearReconnectTimer()
  if (stopped) return
  manuallyClosed = false
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', reconcileVisibleQueries)
  const myGeneration = ++generation
  const config = useRuntimeConfig()
  const configuredUrl = config.public.wsUrl as string
  const version = await resolveWorkerVersion(!!configuredUrl)
  // A disconnect()/reconnect() may have happened while awaiting the version
  // fetch; if so this attempt is stale and the newer one owns the socket.
  if (myGeneration !== generation) return
  const base = configuredUrl || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/websocket`
  const ws = new WebSocket(`${base}?version=${encodeURIComponent(version)}`)
  socket = ws
  ws.onopen = () => {
    if (myGeneration !== generation) return
    connected.value = true
    attempt = 0
    versionCloseStreak = 0
    subscribe()
    reconcileVisibleQueries()
  }
  ws.onmessage = (event) => {
    if (myGeneration !== generation) return
    handleMessage(event)
  }
  ws.onclose = (event) => {
    if (myGeneration !== generation) return
    connected.value = false
    const versionRelated = event.code === 1000 && event.reason === 'OUTDATED_VERSION'
    if (versionRelated) {
      // The cached value (fetched or fallback) turned out to be wrong -
      // drop it so the next attempt, if any, re-resolves from scratch.
      cachedVersion = null
      versionCloseStreak++
      if (versionCloseStreak >= 3) {
        stopped = true
        return
      }
    } else {
      versionCloseStreak = 0
    }
    if (!manuallyClosed) scheduleReconnect()
  }
  ws.onerror = () => {
    // onclose always follows onerror for a WebSocket, which schedules the
    // reconnect - nothing to do here beyond letting that happen.
  }
}

function disconnect() {
  manuallyClosed = true
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', reconcileVisibleQueries)
  pendingNotifications = []
  invalidationQueued = false
  clearChatPresence()
  trailingReconciliations.clear()
  if (queryClient) clearTaskWriteAcknowledgements(queryClient)
  generation++
  clearReconnectTimer()
  attempt = 0
  lastId = 0
  stopped = false
  versionCloseStreak = 0
  const s = socket
  socket = null
  connected.value = false
  s?.close()
}

/** The fallback poll period of a bus-driven query while the socket is down. */
export const BUS_FALLBACK_POLL_MS = 5_000

/** A `refetchInterval` that polls while the bus is not connected and stays off while it is, so no request goes out while pushes arrive. It is reactive: a reconnect stops the polling and a drop starts it again. */
export function busFallbackInterval(pollMs: number = BUS_FALLBACK_POLL_MS): ComputedRef<number | false> {
  return computed(() => connected.value ? false : pollMs)
}

export function useBus(): { connected: Ref<boolean>; connect: () => void; disconnect: () => void } {
  return { connected, connect, disconnect }
}
