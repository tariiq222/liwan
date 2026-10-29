import { expect, test, type Page } from '@playwright/test'
import { AppointmentPublicBookingSchema, AppointmentSlotListSchema } from '@webvue/contracts'
import { collectBrowserErrors, heading, MOCK_STACK_ONLY, trackRefusedRequests } from './support/mock-pages'

test.skip(process.env.E2E_PROJECT_POPUPS !== '1', MOCK_STACK_ONLY)

// The invited requester's booking page against appointments-mock-routes.mjs. The page is public: these tests never sign in.
// The mock serves bookings 1 (pending), 2 (scheduled, the company asks the requester to confirm), 3 (confirmed), 4 (confirmed
// and past its change deadline), 6 (pending, one slot is taken when chosen), 7 (no free slot in the first week) and
// 8 (pending, the company asks the requester to confirm), all with the access token `tok-<id>`; booking 5 answers 429.
// Slots are 07:00Z, 07:30Z and 09:00Z on every day from tomorrow, which read 10:00, 10:30 and 12:00 in Riyadh.
test.use({ timezoneId: 'Asia/Riyadh' })

const BOOK = (id: number, token = `tok-${id}`) => `/book/${id}?access_token=${token}`
const PUBLIC = '/api/v1/public/appointments'

let errors: string[]

test.beforeEach(async ({ page }) => {
  errors = collectBrowserErrors(page)
  expect((await page.request.post(`${PUBLIC}/__mock/reset`, { data: {} })).status()).toBe(200)
})

test.afterEach(() => {
  expect(errors, 'no page error and no console error').toEqual([])
})

const submit = (page: Page) => page.getByTestId('book-submit')
const slot = (page: Page, name: string | RegExp) => page.getByRole('radio', { name })
// The days that have free times; the days before the first free one (today) are listed but cannot be chosen.
const freeDays = (page: Page) => page.locator('[data-testid="book-day"]:not([disabled])')

/** Opens a booking page and waits until its picker can be used (the page has hydrated and the slots are in). */
async function openBooking(page: Page, id: number) {
  await page.goto(BOOK(id))
  await expect(freeDays(page).first()).toBeVisible()
}

test.describe('the booking page', () => {
  test('opens with no session, in Arabic RTL, under the tenant\'s own name, and shows the booking', async ({ page }) => {
    const requests: string[] = []
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/v1/')) requests.push(new URL(request.url()).pathname) })
    await openBooking(page, 1)
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(heading(page, 'موعدك')).toBeVisible()
    await expect(page.getByTestId('book-brand')).toHaveText('ويب فيو')
    await expect(page.getByTestId('book-type')).toHaveText('استشارة')
    await expect(page.getByTestId('book-state')).toHaveText('بانتظار اختيار الوقت')
    await expect(page.getByTestId('book-requester')).toHaveText('سارة العتيبي')
    await expect(page.getByTestId('book-confirm')).toHaveCount(0)
    await expect(page).toHaveURL(/\/book\/1\?access_token=tok-1$/)
    // The page asks only the public namespace, never an authenticated route.
    expect(requests.filter(path => path.startsWith(`${PUBLIC}/`))).not.toEqual([])
    expect(requests.filter(path => !path.startsWith(`${PUBLIC}/`) && path !== '/api/v1/branding')).toEqual([])
    // The mock's answers are the contracts the page reads.
    const read = await page.request.get(`${PUBLIC}/bookings/1?access_token=tok-1`)
    expect(AppointmentPublicBookingSchema.parse(await read.json()).state).toBe('pending')
    const from = new Date().toISOString().slice(0, 10)
    const slots = await page.request.get(`${PUBLIC}/bookings/1/slots?access_token=tok-1&from=${from}&to=${from}`)
    expect(AppointmentSlotListSchema.parse(await slots.json()).total).toBe(0)
  })

  test('schedules a time: the days, then the times of the chosen day, then the booking is confirmed', async ({ page }) => {
    const bodies: unknown[] = []
    page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/schedule')) bodies.push(request.postDataJSON()) })
    await openBooking(page, 1)
    await expect(submit(page)).toBeDisabled()
    await expect(page.getByTestId('book-slots')).toBeVisible()
    await expect(slot(page, /^10:00/)).toBeVisible()
    await expect(slot(page, /^10:30/)).toBeVisible()
    await expect(slot(page, /^12:00/)).toBeVisible()
    await slot(page, /^10:30/).click()
    await expect(submit(page)).toBeEnabled()
    await submit(page).click()
    await expect(page.getByTestId('book-state')).toHaveText('مؤكد')
    await expect(page.getByTestId('book-when')).toContainText('10:30')
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ access_token: 'tok-1' })
    expect(Object.keys(bodies[0] as object).sort()).toEqual(['access_token', 'start'])
  })

  test('picks another day with its own times', async ({ page }) => {
    await openBooking(page, 1)
    const days = freeDays(page)
    await expect(days.first()).toHaveAttribute('aria-pressed', 'true')
    await days.nth(2).click()
    await expect(days.nth(2)).toHaveAttribute('aria-pressed', 'true')
    await expect(days.first()).toHaveAttribute('aria-pressed', 'false')
    await expect(slot(page, /^12:00/)).toBeVisible()
  })

  test('says so when the first week has no free time and moves on to the next week', async ({ page }) => {
    await page.goto(BOOK(7))
    await expect(page.getByTestId('book-slots-empty')).toContainText('لا توجد أوقات متاحة')
    await expect(page.getByTestId('book-window-previous')).toBeDisabled()
    await expect(page.getByTestId('book-window-next')).toBeEnabled()
    await page.getByTestId('book-window-next').click()
    await expect(page.getByTestId('book-slots')).toBeVisible()
    await expect(page.getByTestId('book-window-previous')).toBeEnabled()
    await expect(slot(page, /^10:00/)).toBeVisible()
  })

  test('never goes past the last day the company takes bookings', async ({ page }) => {
    const windows: string[] = []
    page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/slots')) windows.push(new URL(request.url()).searchParams.get('to')!) })
    await page.goto(BOOK(7))
    const next = page.getByTestId('book-window-next')
    await expect(next).toBeEnabled()
    for (let weeks = 0; weeks < 6 && await next.isEnabled(); weeks += 1) {
      await next.click()
      await expect.poll(() => windows.length).toBeGreaterThan(weeks + 1)
    }
    await expect(next).toBeDisabled()
    const booking = AppointmentPublicBookingSchema.parse(await (await page.request.get(`${PUBLIC}/bookings/7?access_token=tok-7`)).json())
    expect(windows.every(to => to <= booking.last_bookable_date)).toBe(true)
  })

  test('a time that was just taken says so, lists the slots again without it and keeps the page usable', async ({ page }) => {
    const withoutRefusals = trackRefusedRequests(page, `${PUBLIC}/bookings/6`)
    await openBooking(page, 6)
    await freeDays(page).nth(1).click()
    await slot(page, /^10:30/).click()
    await submit(page).click()
    await expect(page.getByTestId('book-action-error')).toContainText('حُجز هذا الوقت للتو')
    await expect(slot(page, /^10:30/)).toHaveCount(0)
    await expect(slot(page, /^10:00/)).toBeVisible()
    await expect(page.getByTestId('book-state')).toHaveText('بانتظار اختيار الوقت')
    await expect(submit(page)).toBeDisabled()
    errors = withoutRefusals(errors)
  })

  test('reschedules a confirmed booking to another time', async ({ page }) => {
    await openBooking(page, 3)
    await expect(page.getByTestId('book-state')).toHaveText('مؤكد')
    await expect(submit(page)).toContainText('نقل الموعد')
    await freeDays(page).nth(4).click()
    await slot(page, /^12:00/).click()
    await submit(page).click()
    await expect(page.getByTestId('book-when')).toContainText('12:00')
  })

  test('asks the requester to confirm a scheduled time, and confirming makes it confirmed', async ({ page }) => {
    await openBooking(page, 2)
    await expect(page.getByTestId('book-state')).toHaveText('محجوز')
    await expect(page.getByTestId('book-awaits')).toContainText('بانتظار تأكيدك')
    await page.getByTestId('book-confirm').click()
    await expect(page.getByTestId('book-state')).toHaveText('مؤكد')
    await expect(page.getByTestId('book-awaits')).toHaveCount(0)
    await expect(page.getByTestId('book-confirm')).toHaveCount(0)
  })

  test('scheduling where the company asks for confirmation leaves the confirm action to offer', async ({ page }) => {
    await openBooking(page, 8)
    await expect(page.getByTestId('book-confirm')).toHaveCount(0)
    await slot(page, /^10:00/).click()
    await submit(page).click()
    await expect(page.getByTestId('book-state')).toHaveText('محجوز')
    await expect(page.getByTestId('book-confirm')).toBeVisible()
  })

  test('cancels only after an inline confirmation, then shows the canceled state without reading the booking again', async ({ page }) => {
    await openBooking(page, 3)
    const reads: string[] = []
    page.on('request', request => { if (request.method() === 'GET' && /\/bookings\/3\?/.test(request.url())) reads.push(request.url()) })
    await page.getByTestId('book-cancel').click()
    await expect(page.getByTestId('inline-confirm')).toContainText('إلغاء هذا الموعد؟')
    await page.getByTestId('inline-confirm-cancel').click()
    await expect(page.getByTestId('inline-confirm')).toHaveCount(0)
    await expect(page.getByTestId('book-state')).toHaveText('مؤكد')
    await page.getByTestId('book-cancel').click()
    await page.getByTestId('inline-confirm-action').click()
    await expect(page.getByTestId('book-canceled')).toContainText('تم إلغاء الموعد')
    await expect(page.getByTestId('book-state')).toHaveText('ملغى')
    await expect(page.getByTestId('book-invalid')).toHaveCount(0)
    await expect(page.getByTestId('book-picker')).toHaveCount(0)
    await expect(page.getByTestId('book-cancel')).toHaveCount(0)
    // A return to the window does not read the booking again: its token is gone and the read would look like an invalid link.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await expect(page.getByTestId('book-canceled')).toBeVisible()
    expect(reads).toEqual([])
  })

  test('a booking past its change deadline says why and offers no action', async ({ page }) => {
    await page.goto(BOOK(4))
    await expect(page.getByTestId('book-locked')).toContainText('لا يمكن تعديل الموعد الآن')
    await expect(page.getByTestId('book-type')).toBeVisible()
    for (const id of ['book-picker', 'book-submit', 'book-confirm', 'book-cancel']) await expect(page.getByTestId(id)).toHaveCount(0)
  })

  for (const [name, path] of [
    ['a wrong token', BOOK(1, 'wrong')],
    ['an unknown booking', BOOK(99)],
    ['no token', '/book/1'],
    ['an id that is not a number', BOOK(1).replace('/1?', '/abc?')],
  ] as const) {
    test(`${name}: the link is invalid, never a sign-in page and never booking data`, async ({ page }) => {
      const withoutRefusals = trackRefusedRequests(page, PUBLIC)
      await page.goto(path)
      await expect(page.getByTestId('book-invalid')).toContainText('رابط الموعد غير صالح')
      await expect(page.getByTestId('book-invalid')).toContainText('اطلب رابطًا جديدًا')
      await expect(page).not.toHaveURL(/\/login/)
      await expect(page.getByTestId('book-type')).toHaveCount(0)
      await expect(submit(page)).toHaveCount(0)
      errors = withoutRefusals(errors)
    })
  }

  test('when the service is busy it says so and offers to try again', async ({ page }) => {
    const withoutRefusals = trackRefusedRequests(page, PUBLIC)
    await page.goto(BOOK(5))
    await expect(page.getByTestId('book-unavailable')).toContainText('الخدمة مشغولة حاليًا')
    await expect(page.getByTestId('book-invalid')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'إعادة المحاولة' })).toBeVisible()
    errors = withoutRefusals(errors)
  })

  test('fits a 375px phone with no horizontal scroll and a full-width button', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await openBooking(page, 1)
    await expect(page.getByTestId('book-slots')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const box = await submit(page).boundingBox()
    expect(box!.width).toBeGreaterThan(280)
  })
})
