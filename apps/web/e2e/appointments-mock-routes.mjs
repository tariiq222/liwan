// Part of the isolated UI mock stack: the invited requester's public routes of liwan_appointments (no session). They serve a
// fixed set of bookings whose access token is `tok-<id>`: 1 pending (no time yet), 2 scheduled and awaiting the requester's
// confirmation (the company asks for it), 3 confirmed, 4 confirmed but past its change deadline (not modifiable), 5 answers 429 (the service is busy),
// 6 pending, its slot on day 2 at 07:30Z is taken the moment it is chosen (409), 7 pending with no free slot in the first
// week, 8 pending, the company asks the requester to confirm (scheduling leaves it `scheduled`), 9 confirmed with a required
// cancel reason, 10 pending on a 5-minute grid around the clock (one answer cannot hold its whole week, so a client reads it
// in pages of whole days). Any other id or a wrong
// token answers 404 `not_found`, like any invalid link; so does a canceled booking, whose token is gone. Free slots are on every
// day from tomorrow to `last_bookable_date` (30 days) at 07:00Z, 07:30Z and 09:00Z.
// POST /api/v1/public/appointments/__mock/reset restores the seed so a spec starts from known bookings.
const BOOKING_PATH = /^\/api\/v1\/public\/appointments\/bookings\/(\d+)(?:\/(slots|schedule|confirm|cancel))?$/
// Inside the public namespace on purpose: the edge refuses any other API path without a session, and these specs have none.
const RESET_PATH = '/api/v1/public/appointments/__mock/reset'
const BUSY_BOOKING = 5
// A booking whose second slots page answers 429, so the picker shows the first page and offers to retry the rest.
const PARTIAL_BOOKING = 11
const HORIZON_DAYS = 30
const SLOT_TIMES = ['07:00:00Z', '07:30:00Z', '09:00:00Z']
const SLOT_MINUTES = 30
const TAKEN_SLOT = { booking: 6, day: 2, time: '07:30:00Z' }
const FIRST_SLOT_DAY = { default: 1, 7: 8 }
// The days one answer may list: booking 10 has a 5-minute grid, so its week needs several answers of whole days.
const MAX_ANSWER_ITEMS = 500

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
  company_name: 'ليوان',
  cancel_reason_required: false,
  cancel_reasons: [],
  requester: { name: 'سارة العتيبي', phone: '+966500000009', email: 'sara@example.com' },
  ...extra,
})
const scheduled = (state, extra = {}) => {
  const start = stamp(dayString(3), '07:00:00Z')
  return { state, start, stop: addMinutes(start, SLOT_MINUTES), ...extra }
}
// The reasons a company that requires one offers on its requester page.
const CANCEL_REASONS = [{ id: 41, name: 'لم أعد بحاجة للموعد' }, { id: 42, name: 'تغيّر ظرفي' }]
const freshBookings = () => new Map([
  [1, booking(1)],
  [2, booking(2, scheduled('scheduled'))],
  [3, booking(3, scheduled('confirmed'))],
  [4, booking(4, scheduled('confirmed', { is_modifiable: false }))],
  [6, booking(6)],
  [7, booking(7)],
  [8, booking(8)],
  [9, booking(9, { ...scheduled('confirmed'), cancel_reason_required: true, cancel_reasons: CANCEL_REASONS })],
  [10, booking(10, { duration_minutes: 5 })],
  [11, booking(11)],
])
// The bookings of the company that asks the requester to confirm.
const ASKS_TO_CONFIRM = new Set([2, 8])
let bookings = freshBookings()
let takenSlots = new Set()
let canceled = new Set()

const refusal = (status, code, message, field) => ({ status, body: { code, message, ...(field ? { field } : {}) } })
const notFound = () => refusal(404, 'not_found', 'not found')

/** The wire shape: the bookable days run from today to the horizon; `awaits_confirmation` follows the booking's state. */
function dump(found) {
  return { ...found, first_bookable_date: dayString(0), last_bookable_date: dayString(HORIZON_DAYS), awaits_confirmation: found.state === 'scheduled' && ASKS_TO_CONFIRM.has(found.id) }
}

/** The booking the token opens, or a failure: 429 for the busy one, 404 for a wrong id or token or a canceled booking. */
function bookingFor(id, token) {
  if (id === BUSY_BOOKING) return { failure: refusal(429, 'rate_limited', 'too many requests') }
  const found = bookings.get(id)
  return found && token === accessToken(id) && !canceled.has(id) ? { found } : { failure: notFound() }
}

/** The bookings whose company offers a dense grid: booking 10 takes a start every 5 minutes, around the clock. */
const DENSE_GRID = { 10: 5 }

/** The free slots of one day, as the company offers them that day. */
function daySlots(id, day) {
  const step = DENSE_GRID[id]
  if (step) {
    return Array.from({ length: (24 * 60) / step }, (_, index) => {
      const minutes = index * step
      const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00Z`
      return { start: stamp(day, time), stop: addMinutes(stamp(day, time), step) }
    })
  }
  return SLOT_TIMES.map(time => ({ start: stamp(day, time), stop: addMinutes(stamp(day, time), SLOT_MINUTES) }))
}

/** The free slots of the booking from `from` to `to` inclusive, cut on a day boundary: `next_date` is the first whole day left out. */
function freeSlots(id, from, to) {
  const items = []
  let nextDate = null
  for (let offset = FIRST_SLOT_DAY[id] ?? FIRST_SLOT_DAY.default; offset <= HORIZON_DAYS; offset += 1) {
    const day = dayString(offset)
    if (day < from || day > to) continue
    const slots = daySlots(id, day).filter(slot => !takenSlots.has(`${id}:${slot.start}`))
    if (items.length && items.length + slots.length > MAX_ANSWER_ITEMS) {
      nextDate = day
      break
    }
    items.push(...slots)
  }
  return { items, nextDate }
}

/** Every free slot from `from` to `to`: the pages a client reads, one after the other, from the day each answer stopped at. */
function allSlots(id, from, to) {
  const items = []
  let day = from
  while (day) {
    const page = freeSlots(id, day, to)
    items.push(...page.items)
    day = page.nextDate
  }
  return items
}

function listSlots(id, query) {
  const isDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '')
  if (!isDay(query.get('from'))) return refusal(422, 'invalid', 'must be a date as YYYY-MM-DD', 'from')
  if (!isDay(query.get('to'))) return refusal(422, 'invalid', 'must be a date as YYYY-MM-DD', 'to')
  if (query.get('to') > dayString(HORIZON_DAYS)) return refusal(422, 'invalid', 'to is beyond the booking horizon', 'to')
  // One booking answers its second page as busy: a client keeps the first page and offers to retry the rest.
  if (id === PARTIAL_BOOKING && query.get('from') > dayString(FIRST_SLOT_DAY.default)) return refusal(429, 'rate_limited', 'too many requests')
  const { items, nextDate } = freeSlots(id, query.get('from'), query.get('to'))
  return { status: 200, body: { items, total: items.length, next_date: nextDate } }
}

function schedule(found, body) {
  if (!found.is_modifiable) return refusal(422, 'invalid', 'the change deadline has passed', 'start')
  const slot = allSlots(found.id, '0000-01-01', '9999-12-31').find(candidate => candidate.start === body.start)
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

function cancel(found, body) {
  if (!found.is_modifiable) return refusal(422, 'invalid', 'the change deadline has passed')
  if (found.cancel_reason_required && !CANCEL_REASONS.some(reason => reason.id === body.reason_id)) return refusal(422, 'invalid', 'field is required', 'reason_id')
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
      cancel: () => cancel(found.found, body),
    }[action]())
  json(res, answer.status, answer.body)
  return true
}
