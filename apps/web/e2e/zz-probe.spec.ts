import { test, type Page } from '@playwright/test'
async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول' }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
}
test('probe dialog', async ({ page }) => {
  test.setTimeout(120_000)
  await login(page)
  await page.goto('/meetings/1/edit')
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => new Promise(f => requestAnimationFrame(() => f(null))))
  await page.locator('#edit-name').fill('مسودة لم تُحفظ')
  await page.locator('h1').first().click()
  await page.keyboard.press('Escape')
  for (let i = 0; i < 14; i++) {
    const s = await page.evaluate(() => ({
      url: location.pathname,
      dialog: !!document.querySelector('[data-testid=unsaved-changes-dialog]'),
      name: (document.querySelector('#edit-name') as HTMLInputElement | null)?.value,
      buttons: [...document.querySelectorAll('[data-testid=unsaved-changes-dialog] button')].map(b => (b.textContent||'').trim()),
    }))
    console.log('T' + (i * 150) + ' ' + JSON.stringify(s))
    await page.waitForTimeout(150)
  }
  // asyncData shape
  console.log('ASYNC ' + JSON.stringify(await page.evaluate(() => {
    const app = (window as any).useNuxtApp?.()
    const me = app?._asyncData?.me
    return me ? Object.keys(me) : 'none'
  })))
})
