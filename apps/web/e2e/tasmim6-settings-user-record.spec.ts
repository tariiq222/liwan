import { expect, test } from '@playwright/test'
import { fitsWidth, loginAdmin, mockAdminApi, openClientSide, openShell, USER_DETAIL } from './support/tasmim6d'

// Plan 6d: /settings/team/users/:id on SharedRecordPage with route tabs, a properties aside and record sections.
test.describe('Plan 6d: the user record', () => {
  test.beforeEach(async ({ page }) => { await loginAdmin(page); await mockAdminApi(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('is the record template: one h1, tabs, a properties aside and the account sections', async ({ page }) => {
      await openClientSide(page, '/settings/team/users/11?q=sara&status=active')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('سارة محمد')
      await expect(page.locator('[data-template="record"]')).toHaveCount(1)
      await expect(page.getByRole('navigation', { name: 'أقسام حساب المستخدم', exact: true })).toBeVisible()
      await expect(page.getByTestId('settings-layout')).toBeVisible()
      await expect(page.getByTestId('user-tab-account')).toHaveAttribute('aria-current', 'page')
      await expect(page.getByTestId('user-tab-access')).toHaveAttribute('href', /\/settings\/team\/users\/11\/access\?.*q=sara/)
      await expect(page.getByTestId('user-tab-security')).toBeVisible()
      const aside = page.locator('#account')
      await expect(aside).toContainText('sara')
      await expect(aside).toContainText('سارة محمد')
      await expect(page.locator('#roles')).toContainText('مدير المشاريع')
      await expect(page.locator('#capabilities')).toContainText('عرض المشاريع')
      await expect(page.locator('#seat')).toContainText('صلاحية كاملة')
      await expect(page.locator('main').getByRole('heading', { level: 2 })).toHaveCount(4)
    })

    test('saves a seat selection with the displayed account version', async ({ page }) => {
      let detail = { ...USER_DETAIL, allowed_actions: [...USER_DETAIL.allowed_actions, 'set_seat' as const] }
      let saves = 0
      await page.route('**/api/v1/admin/users/11', route => route.fulfill({ json: detail }))
      await page.route('**/api/v1/admin/users/11/seat', route => {
        expect(route.request().method()).toBe('PATCH')
        expect(route.request().postDataJSON()).toEqual({ expected_version: USER_DETAIL.version, read_only: true })
        saves += 1
        detail = { ...detail, read_only: true, seat_choice: 'customer', version: 'u11-next' }
        return route.fulfill({ json: detail })
      })
      await openClientSide(page, '/settings/team/users/11')
      const seat = page.locator('#seat')
      await seat.getByRole('button', { name: 'عدّل المقعد' }).click()
      await seat.getByRole('checkbox', { name: 'اجعله للقراءة فقط' }).check()
      await seat.getByRole('button', { name: 'احفظ تغييرات المقعد' }).click()
      await expect(seat).toContainText('للقراءة فقط')
      await expect(seat.getByRole('checkbox')).toHaveCount(0)
      expect(saves).toBe(1)
    })

    test('shows full branch capacity and applies an authorized seat selection', async ({ page }) => {
      let branch = { id: 7, name: 'فرع جدة', read_only: false, seat_choice: 'auto', restore_priority: 0 }
      let saves = 0
      await page.route('**/api/v1/admin/branches', route => route.fulfill({
        json: { items: [branch], total: 1, limit: 1, read_only: Number(branch.read_only) },
      }))
      await page.route('**/api/v1/admin/branches/7/seat', route => {
        expect(route.request().method()).toBe('PATCH')
        expect(route.request().postDataJSON()).toEqual({ read_only: true })
        saves += 1
        branch = { ...branch, read_only: true, seat_choice: 'customer' }
        return route.fulfill({ json: branch })
      })
      await openClientSide(page, '/settings/team/branches')
      const seats = page.locator('#branch-seats')
      await seats.getByRole('button', { name: 'عدّل المقعد' }).click()
      await seats.getByRole('checkbox', { name: 'اجعله للقراءة فقط' }).check()
      await seats.getByRole('button', { name: 'احفظ تغييرات المقعد' }).click()
      await expect(seats).toContainText('للقراءة فقط')
      await expect(seats.getByRole('checkbox')).toHaveCount(0)
      expect(saves).toBe(1)
    })

    test('storage metadata filters by blocked state and links only to registered owners', async ({ page }) => {
      const items = [
        { id: 1, name: 'ملف المشروع.pdf', size_bytes: 1048576, created_at: '2026-11-10T14:00:00Z', blocked: true, record: { kind: 'document', id: 91 } },
        { id: 2, name: 'مرفق متاح.pdf', size_bytes: 2048, created_at: null, blocked: false, record: { kind: 'unregistered-owner', id: 92 } },
      ]
      const received: Array<string | null> = []
      await page.route('**/api/v1/me', async route => {
        const response = await route.fetch()
        const me = await response.json()
        await route.fulfill({ json: {
          ...me, capabilities: [...new Set([...me.capabilities, 'documents.items.read', 'settings.company.manage', 'settings.branding.manage'])],
          commercial: { schema_version: 1, mode: 'saas', self_service_available: false },
        } })
      })
      await page.route(/\/api\/v1\/settings\/storage(?:\?|$)/, route => {
        expect(route.request().method()).toBe('GET')
        const query = new URL(route.request().url()).searchParams
        expect(query.get('limit')).toBe('25')
        const blocked = query.get('blocked')
        received.push(blocked)
        const list = blocked === 'true' ? items.filter(item => item.blocked) : items
        return route.fulfill({ json: { items: list, total: list.length, summary: { limit_mb: 4, used_bytes: 5242880, blocked_bytes: 1048576 } } })
      })
      await openClientSide(page, '/settings/system/storage')
      const inventory = page.getByTestId('storage-inventory')
      await expect(inventory.getByTestId('storage-summary')).toContainText('تشمل هذه الإجماليات المؤسسة كاملة.')
      await expect(inventory.getByRole('link', { name: 'افتح السجل المرتبط' })).toHaveAttribute('href', '/documents/91')
      await expect(inventory).toContainText('رابط السجل غير متاح')
      await expect(page.getByRole('link', { name: 'اشترِ مساحة تخزين' })).toHaveAttribute('href', '/subscription/change')
      await inventory.getByRole('button', { name: 'المحجوبة', exact: true }).click()
      await expect(page).toHaveURL(/blocked=true/)
      await expect(inventory).toContainText('ملف المشروع.pdf')
      await expect(inventory).not.toContainText('مرفق متاح.pdf')
      expect(received).toContain('true')
      for (const width of [768, 390]) {
        await page.setViewportSize({ width, height: 844 })
        await expect.poll(() => fitsWidth(page), { message: `storage layout at ${width}px` }).toBe(true)
      }
    })

    test('the back link returns to the list with its filters', async ({ page }) => {
      await openClientSide(page, '/settings/team/users/11?q=sara&offset=25')
      await page.getByRole('link', { name: 'رجوع' }).first().click()
      await expect(page).toHaveURL(/\/settings\/team\/users\?.*q=sara/)
      expect(new URL(page.url()).searchParams.get('offset')).toBe('25')
    })

    test('a missing user shows the not-found state under one heading and no tabs', async ({ page }) => {
      await openShell(page, '/projects')
      for (const id of ['999', '0', 'abc', '-1', '1.5', '9007199254740992']) {
        await page.evaluate(target => (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => Promise<unknown> } } }).useNuxtApp().$router.push(target), `/settings/team/users/${id}`)
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
        await expect(page.locator('[data-slot="not-found-state"]')).toBeVisible()
        await expect(page.locator('[data-slot="record-aside"]')).toHaveCount(0)
        await expect(page.getByTestId('user-tab-account')).toHaveCount(0)
      }
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })
    test('on a 390px phone the aside follows the main column and nothing overflows', async ({ page }) => {
      await openClientSide(page, '/settings/team/users/11')
      await expect(page.locator('#account')).toBeVisible()
      await expect(page.locator('#roles')).toBeVisible()
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
