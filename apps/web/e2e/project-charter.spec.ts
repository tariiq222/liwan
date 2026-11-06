import { expect, test, type Page } from '@playwright/test'

const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'

async function login(page: Page) {
  await page.goto('/login')
  const submit = page.getByRole('button', { name: 'دخول' })
  await expect(submit).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill(ADMIN_LOGIN)
  await page.getByLabel('كلمة المرور').fill(ADMIN_PASSWORD)
  await submit.click()
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
}

async function openCharter(page: Page) {
  await page.goto('/projects/1/charter?edit=1')
  await expect(page.getByTestId('project-charter-wizard')).toBeVisible()
  await expect(page.getByTestId('project-create-name')).toHaveValue('مشروع ألفا')
  await expect(page.getByTestId('project-create-name')).toBeEnabled()
  const help = page.getByTestId('field-help').first()
  await expect(help).toBeEnabled()
  return help
}

test('simple creation preserves core objectives and uses one POST without charter submission', async ({ page }) => {
  await login(page)
  const posts:string[]=[]
  page.on('request',request=>{if(request.method()==='POST' && /\/api\/v1\/projects(?:$|\/\d+\/charter\/)/.test(new URL(request.url()).pathname))posts.push(new URL(request.url()).pathname)})
  await page.goto('/projects/new')
  await expect(page.getByTestId('charter-stepper')).toHaveCount(0)
  const name=`E2E basic ${Date.now()}`
  await page.getByTestId('project-create-name').fill(name)
  await page.getByTestId('project-objective-0').fill('First goal')
  await page.getByTestId('project-add-objective').click()
  await page.getByTestId('project-objective-1').fill('Second goal')
  await page.getByTestId('project-success-criteria').fill('20 requests in one month')
  await page.getByTestId('project-create-submit').click()
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible()
  expect(posts).toEqual(['/api/v1/projects'])
  const id=Number(new URL(page.url()).pathname.split('/')[2])
  expect(new URL(page.url()).pathname).toBe(`/projects/${id}`)
  const detail=await(await page.request.get(`/api/v1/projects/${id}`)).json()
  expect(detail.objectives.map((row:{goal:string})=>row.goal)).toEqual(['First goal','Second goal'])
  expect(detail.success_criteria).toBe('20 requests in one month')
  expect(detail.charter).toBeNull()
})

test('charter help opens on hover and closes when the pointer leaves', async ({ page }) => {
  await login(page)
  const help = await openCharter(page)
  await help.hover()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.getByTestId('project-workspace-name').hover()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
})

test('charter help opens after offscreen keyboard focus, toggles with Enter, and closes with Escape', async ({ page }) => {
  await page.setViewportSize({width:1280,height:400})
  await login(page)
  const help = await openCharter(page)
  await page.mouse.move(0, 0)
  await page.getByTestId('project-create-name').focus()
  await page.evaluate(()=>window.scrollTo(0,0))
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0)
  expect((await help.boundingBox())!.y).toBeGreaterThanOrEqual(400)
  await page.keyboard.press('Shift+Tab')
  await expect(help).toBeFocused()
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(0)
  // Settle the browser's focus-induced scroll notifications, without a timed sleep.
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))
  await expect(help).toHaveAttribute('aria-expanded','true')
  await expect(page.getByRole('tooltip')).toBeVisible()
  await help.press('Enter')
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await help.press('Enter')
  await expect(page.getByRole('tooltip')).toBeVisible()
  await help.press('Escape')
  await expect(page.getByRole('tooltip')).toHaveCount(0)
})

test('charter help stays open after a touch tap until outside or Escape', async ({ page }) => {
  await login(page)
  const help = await openCharter(page)
  await help.evaluate((el) => {
    el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, cancelable: true }))
  })
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.getByTestId('project-workspace-name').click()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await help.evaluate((el) => {
    el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, cancelable: true }))
  })
  await expect(page.getByRole('tooltip')).toBeVisible()
  await help.press('Escape')
  await expect(page.getByRole('tooltip')).toHaveCount(0)
})

test('charter tab is readonly until header edit or edit=1', async ({ page }) => {
  await login(page)
  const name = `E2E charter view ${Date.now()}`
  const created = await page.request.post('/api/v1/projects', { data: { name, date_end: '2035-12-31' } })
  expect(created.status()).toBe(201)
  const project = await created.json()
  expect((await page.request.patch(`/api/v1/projects/${project.id}`,{data:{tool_preferences:{governance:true},expected_updated_at:project.updated_at}})).status()).toBe(200)
  await page.goto(`/projects/${project.id}/charter`)
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/charter$`))
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await expect(page.getByTestId('project-charter-form')).toBeVisible()
  await expect(page.getByTestId('charter-draft-banner')).toBeVisible()
  await expect(page.getByRole('button', { name: 'حفظ' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'العودة إلى المشروع' })).toHaveCount(0)
  await page.getByTestId('project-charter-edit').click()
  await expect(page).toHaveURL(/edit=1/)
  await expect(page.getByTestId('charter-stepper')).toBeVisible()
  await expect(page.getByTestId('charter-save-draft')).toBeVisible()
})

