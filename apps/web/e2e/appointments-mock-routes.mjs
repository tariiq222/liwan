// Part of the isolated UI mock stack: the invited requester's public routes of webvue_appointments (no session). They serve a
// fixed set of bookings whose access token is `tok-<id>`: 1 pending (no time yet), 2 scheduled and awaiting the requester's
// confirmation (the company asks for it), 3 confirmed, 4 confirmed but past its change deadline (not modifiable), 5 answers 429 (the service is busy),
// 6 pending, its slot on day 2 at 07:30Z is taken the moment it is chosen (409), 7 pending with no free slot in the first
// week, 8 pending, the company asks the requester to confirm (scheduling leaves it `scheduled`). Any other id or a wrong
// token answers 404 `not_found`, like any invalid link; so does a canceled booking, whose token is gone. Free slots are on every
// day from tomorrow to `last_bookable_date` (30 days) at 07:00Z, 07:30Z and 09:00Z.
// POST /api/v1/public/appointments/__mock/reset restores the seed so a spec starts from known bookings.
const BOOKING_PATH = /^\/api\/v1\/public\/appointments\/bookings\/(\d+)(?:\/(slots|schedule|confirm|cancel))?$/
// Inside the public namespace on purpose: the edge refuses any other API path without a session, and these specs have none.
const RESET_PATH = '/api/v1/public/appointments/__mock/reset'
const BUSY_BOOKING = 5
const HORIZON_DAYS = 30
const SLOT_TIMES = ['07:00:00Z', '07:30:00Z', '09:00:00Z']
const SLOT_MINUTES = 30
const TAKEN_SLOT = { booking: 6, day: 2, time: '07:30:00Z' }
const FIRST_SLOT_DAY = { default: 1, 7: 8 }

const accessToken = id => `tok-${id}`
const dayString = offset => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
const stamp = (day, time) => `${day}T${time}`
const addMinutes = (value, minutes) => new Date(new Date(value).getTime() + minutes * 60_000).toISOString().replace('.000Z', 'Z')

const booking = (id, extra = {}) => ({
  id,
  state: 'pending',
  type_name: 'استشارة',
  duration_minutes: SLOT_MINUTES,
  location: null,
  start: null,
  stop: null,
  is_modifiable: true,
  company_name: 'ويب فيو',
  requester: { name: 'سارة العتيبي', phone: '+966500000009', email: 'sara@example.com' },
  ...extra,
})
const scheduled = (state, extra = {}) => {
  const start = stamp(dayString(3), '07:00:00Z')
  return { state, start, stop: addMinutes(start, SLOT_MINUTES), ...extra }
}
const freshBookings = () => new Map([
  [1, booking(1)],
  [2, booking(2, scheduled('scheduled'))],
  [3, booking(3, scheduled('confirmed'))],
  [4, booking(4, scheduled('confirmed', { is_modifiable: false }))],
  [6, booking(6)],
  [7, booking(7)],
  [8, booking(8)],
])
// The bookings of the company that asks the requester to confirm.
const ASKS_TO_CONFIRM = new Set([2, 8])
let bookings = freshBookings()
let takenSlots = new Set()
let canceled = new Set()

const refusal = (status, code, message, field) => ({ status, body: { code, message, ...(field ? { field } : {}) } })
const notFound = () => refusal(404, 'not_found', 'not found')

/** The wire shape: `last_bookable_date` is the horizon from today; `awaits_confirmation` follows the booking's state. */
function dump(found) {
  return { ...found, last_bookable_date: dayString(HORIZON_DAYS), awaits_confirmation: found.state === 'scheduled' && ASKS_TO_CONFIRM.has(found.id) }
}

/** The booking the token opens, or a failure: 429 for the busy one, 404 for a wrong id or token or a canceled booking. */
function bookingFor(id, token) {
  if (id === BUSY_BOOKING) return { failure: refusal(429, 'rate_limited', 'too many requests') }
  const found = bookings.get(id)
  return found && token === accessToken(id) && !canceled.has(id) ? { found } : { failure: notFound() }
}

/** The free slots of the booking from `from` to `to` inclusive. */
function freeSlots(id, from, to) {
  const items = []
  for (let offset = FIRST_SLOT_DAY[id] ?? FIRST_SLOT_DAY.default; offset <= HORIZON_DAYS; offset += 1) {
    const day = dayString(offset)
    if (day < from || day > to) continue
    for (const time of SLOT_TIMES) {
      const start = stamp(day, time)
      if (!takenSlots.has(`${id}:${start}`)) items.push({ start, stop: addMinutes(start, SLOT_MINUTES) })
    }
  }
  return items
}

function listSlots(id, query) {
  const isDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '')
  if (!isDay(query.get('from'))) return refusal(422, 'invalid', 'must be a date as YYYY-MM-DD', 'from')
  if (!isDay(query.get('to'))) return refusal(422, 'invalid', 'must be a date as YYYY-MM-DD', 'to')
  if (query.get('to') > dayString(HORIZON_DAYS)) return refusal(422, 'invalid', 'to is beyond the booking horizon', 'to')
  const items = freeSlots(id, query.get('from'), query.get('to'))
  return { status: 200, body: { items, total: items.length } }
}

function schedule(found, body) {
  if (!found.is_modifiable) return refusal(422, 'invalid', 'the change deadline has passed', 'start')
  const slot = freeSlots(found.id, '0000-01-01', '9999-12-31').find(candidate => candidate.start === body.start)
  if (!slot) return refusal(422, 'invalid', 'this time is not offered', 'start')
  if (found.id === TAKEN_SLOT.booking && body.start === stamp(dayString(TAKEN_SLOT.day), TAKEN_SLOT.time)) {
    takenSlots.add(`${found.id}:${body.start}`)
    return refusal(409, 'conflict', 'this time was just taken')
  }
  const state = ASKS_TO_CONFIRM.has(found.id) ? 'scheduled' : 'confirmed'
  const next = { ...found, state, start: slot.start, stop: slot.stop }
  bookings.set(found.id, next)
  return { status: 200, body: dump(next) }
}

function confirm(found) {
  if (!found.is_modifiable || !dump(found).awaits_confirmation) return refusal(422, 'invalid', 'this booking does not wait for your confirmation')
  const next = { ...found, state: 'confirmed' }
  bookings.set(found.id, next)
  return { status: 200, body: dump(next) }
}

function cancel(found) {
  if (!found.is_modifiable) return refusal(422, 'invalid', 'the change deadline has passed')
  canceled.add(found.id)
  return { status: 200, body: dump({ ...found, state: 'canceled' }) }
}

/** Answers the invited requester's routes (no session) and returns true; any other path returns false. */
export async function handlePublicAppointments(req, res, path, url, { json, readBody }) {
  if (path === RESET_PATH && req.method === 'POST') {
    bookings = freshBookings()
    takenSlots = new Set()
    canceled = new Set()
    json(res, 200, {})
    return true
  }
  const route = BOOKING_PATH.exec(path)
  if (!route) return false
  const id = Number(route[1])
  const action = route[2]
  const reading = req.method === 'GET' && (!action || action === 'slots')
  const writing = req.method === 'POST' && ['schedule', 'confirm', 'cancel'].includes(action)
  if (!reading && !writing) return false
  let body = {}
  if (writing) {
    try { body = JSON.parse(await readBody(req) || '{}') } catch { body = {} }
  }
  const found = bookingFor(id, reading ? url.searchParams.get('access_token') : body.access_token)
  const answer = found.failure
    ?? (!action ? { status: 200, body: dump(found.found) } : {
      slots: () => listSlots(id, url.searchParams),
      schedule: () => schedule(found.found, body),
      confirm: () => confirm(found.found),
      cancel: () => cancel(found.found),
    }[action]())
  json(res, answer.status, answer.body)
  return true
}
