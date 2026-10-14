import { test, expect, type Page } from '@playwright/test'
import { login, open, DESKTOP, rows } from './support/tasmim6'

// Listen before direct navigation: SSR mismatches can precede data-ready assertions.
function hydrationMessages(page: Page) {
  const messages: string[] = []
  page.on('console', message => {
    if (/hydration.*(?:mismatch|error)/i.test(message.text())) messages.push(message.text())
  })
  return messages
}

test.describe('Plan 7: PMO direct SSR hydration', () => {
  test.use({ viewport: DESKTOP })
  test.beforeEach(async ({ page }) => { await login(page) })

  test('the finance ledger hydrates without mismatches and keeps its row actions', async ({ page }) => {
    const messages = hydrationMessages(page)
    await open(page, '/projects/2/finance')
    await expect(rows(page)).toHaveCount(4)
    await expect(rows(page).filter({ hasText: 'تجهيز بيئة العمل' }).getByRole('link', { name: 'تعديل', exact: true })).toBeVisible()
    expect(messages).toEqual([])
    await expect(page.getByRole('columnheader', { name: 'الإجراءات', exact: true })).toHaveCount(1)
    await expect(page.getByRole('columnheader', { name: 'الإجراءات', exact: true }).locator('span.sr-only')).toHaveText('الإجراءات')
  })

  test('the template list hydrates without mismatches and keeps its availability controls', async ({ page }) => {
    const messages = hydrationMessages(page)
    await open(page, '/project-templates')
    await expect(rows(page)).toHaveCount(3)
    await expect(rows(page).first().getByRole('link', { name: 'إطلاق خدمة' })).toBeVisible()
    await expect(rows(page).first()).toContainText('متاح للاستخدام')
    await expect(page.locator('[data-shortcut-create]')).toContainText('قالب جديد')
    expect(messages).toEqual([])
    await expect(page.getByRole('columnheader', { name: 'متاح للاستخدام', exact: true }).locator('span.sr-only')).toHaveText('متاح للاستخدام')
  })

  test('the finance record hydrates without warnings and its amount section labels its visible heading', async ({ page }) => {
    const messages = hydrationMessages(page)
    await open(page, '/projects/2/finance/53')
    await expect(page.getByRole('heading', { level: 2, name: 'تجهيز بيئة العمل' })).toBeVisible()
    const section = page.locator('[data-slot="record-section"]')
    await expect(section).toContainText('400')
    const heading = section.getByRole('heading', { level: 2 })
    await expect(heading).toBeVisible()
    const headingId = await heading.getAttribute('id')
    expect(headingId).toBeTruthy()
    await expect(section).toHaveAttribute('aria-labelledby', headingId!)
    expect(messages).toEqual([])
  })
})
