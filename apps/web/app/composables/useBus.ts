import { ref, type Ref } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { taskKeys } from './useTasks'

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
  const notifications = JSON.parse(raw) as BusNotification[]
  const last = notifications.at(-1)
  return { notifications, lastId: last?.id }
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
// components call useBus(). The query client is captured once, the first
// time useBus() runs inside a Vue/Nuxt context (the bus.client.ts plugin),
// and reused from the async WebSocket callbacks afterwards, since those
// callbacks run outside any component's setup and can't call useQueryClient()
// themselves.
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

// addons/bus/websocket.py `WebsocketConnectionHandler._VERSION`: the server
// force-closes the connection with "OUTDATED_VERSION" unless the client's
// `?version=` query param matches this exactly (it only guards against
// stale cached JS across a deploy, not real compatibility - see
// `_serve_forever`). The web client normally reads this from `session_info`
// via `/web/session/get_session_info`, but that route isn't CORS-enabled,
// so it can't be fetched cross-origin from the dev-mode direct connection to
// :8069 (see the dev-vs-prod URL note on wsUrl below). Pinned here instead,
// same as any other client pinning to a fixed backend protocol version -
// bump it if `addons/bus/websocket.py` `_VERSION` ever changes on this
// stable branch.
const ODOO_WEBSOCKET_WORKER_VERSION = '19.0-2'

function wsUrl(): string {
  const config = useRuntimeConfig()
  const base = (config.public.wsUrl as string) || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/websocket`
  return `${base}?version=${encodeURIComponent(ODOO_WEBSOCKET_WORKER_VERSION)}`
}

function invalidateForNotification(notification: BusNotification) {
  if (!queryClient) return
  if (notification.message?.type !== 'nasq/task') return
  const id = notification.message.payload?.id
  if (typeof id !== 'number') return
  queryClient.invalidateQueries({ queryKey: taskKeys.detail(id) })
  queryClient.invalidateQueries({ queryKey: taskKeys.timeline(id) })
  queryClient.invalidateQueries({ queryKey: ['tasks', 'list'] })
}

function handleMessage(event: MessageEvent) {
  if (typeof event.data !== 'string') return
  const { notifications, lastId: newLast } = parseBusFrame(event.data)
  if (newLast !== undefined) lastId = newLast
  for (const notification of notifications) invalidateForNotification(notification)
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

function connect() {
  clearReconnectTimer()
  manuallyClosed = false
  const myGeneration = ++generation
  const ws = new WebSocket(wsUrl())
  socket = ws
  ws.onopen = () => {
    if (myGeneration !== generation) return
    connected.value = true
    attempt = 0
    subscribe()
  }
  ws.onmessage = (event) => {
    if (myGeneration !== generation) return
    handleMessage(event)
  }
  ws.onclose = () => {
    if (myGeneration !== generation) return
    connected.value = false
    if (!manuallyClosed) scheduleReconnect()
  }
  ws.onerror = () => {
    // onclose always follows onerror for a WebSocket, which schedules the
    // reconnect - nothing to do here beyond letting that happen.
  }
}

function disconnect() {
  manuallyClosed = true
  generation++
  clearReconnectTimer()
  attempt = 0
  lastId = 0
  const s = socket
  socket = null
  connected.value = false
  s?.close()
}

export function useBus(): { connected: Ref<boolean>; connect: () => void; disconnect: () => void } {
  if (!queryClient) queryClient = useQueryClient()
  return { connected, connect, disconnect }
}
