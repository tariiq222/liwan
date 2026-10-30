import { test, expect } from '@playwright/test'

test.skip(process.env.E2E_MODULE_UI !== '1', 'Requires isolated synthetic module preview')
test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('button', {name:'دخول', exact:true})).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', {exact:true}).fill('admin')
  await page.getByRole('button', {name:'دخول', exact:true}).click()
  await expect(page).not.toHaveURL(/\/login/)
})

test('direct sheet loads its real background and restores it after closing', async ({page}) => {
  const hydrationErrors: string[] = []
  page.on('console', message => {
    if (/hydration.*mismatch/i.test(message.text())) hydrationErrors.push(message.text())
  })
  await page.goto('/hr/employees/new?returnTo=%2Fhr%3Fdepartment_id%3D1')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('[data-project-background] h1')).toHaveText('الموظفون')
  await expect(page.locator('[data-project-background]')).not.toContainText('[object Promise]')
  await page.getByTestId('project-overlay-close').click()
  await expect(page).toHaveURL(/\/hr\?department_id=1$/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('main h1')).toBeVisible()
  expect(hydrationErrors).toEqual([])
})

const roots = ['/tasks', '/tasks?scope=archived', '/meetings', '/meetings/calendar', '/meetings/series', '/hr', '/hr/departments', '/documents', '/settings/team/users', '/settings/team/roles', '/settings/team/access-log', '/settings/company', '/account', '/notifications', '/search']
for (const width of [1440, 1024, 390]) {
  test('section anatomy at ' + width, async ({page}, info) => {
    test.setTimeout(120_000)
    await page.setViewportSize({width, height:1000})
    for (const path of roots) {
      await page.goto(path)
      await expect(page.getByTestId('notification-bell')).toBeEnabled()
      await expect(page.locator('main h1'), path).toHaveCount(1)
      await expect(page.locator('main h1')).toBeVisible()
      await expect(page.locator('html')).not.toHaveAttribute('data-workspace-theme')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      expect(await page.locator('main h1').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)), path).toBeCloseTo(20,1)
      expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth), path).toBe(true)
      await expect(page.locator('main [role="alert"]'), path).toHaveCount(0)
    }
    await page.goto('/hr')
    await page.screenshot({path:info.outputPath('hr-'+width+'.png'),fullPage:true})
  })
}

const workflows = ['/tasks/new', '/tasks/101', '/meetings/new', '/meetings/1', '/meetings/1/edit', '/meetings/1/minutes', '/meetings/1/resolutions/new', '/meetings/1/resolutions/1/edit', '/meetings/series/new', '/meetings/series/1', '/meetings/series/1/edit', '/hr/employees/new', '/hr/employees/1', '/hr/employees/1/edit', '/hr/departments/new', '/hr/departments/1', '/hr/departments/1/edit', '/documents/new', '/documents/new?context_kind=hr.department&context_id=1', '/documents/1', '/documents/1/edit', '/settings/team/users/new', '/settings/team/users/1', '/settings/team/users/1/access', '/settings/team/users/1/security', '/settings/team/roles/new', '/settings/team/roles/1', '/settings/team/roles/1/edit', '/settings/team/access-log/1', '/notification-digests/1']
for (const width of [1440, 390]) {
  test('all record and form sheets at '+width, async ({page},info)=>{
    test.setTimeout(180_000)
    await page.setViewportSize({width,height:1000})
    await page.emulateMedia({reducedMotion:'reduce'})
    for (const path of workflows) {
      await page.goto(path)
      await expect(page.getByTestId('notification-bell')).toBeEnabled()
      const sheet = page.getByTestId('project-route-overlay')
      await expect(sheet).toBeVisible()
      await expect(sheet.locator('h1'),path).toHaveCount(1)
      await expect(sheet.locator('h1'),path).toBeVisible()
      const alerts = await sheet.locator('[role="alert"]').allTextContents()
      expect(alerts.filter(text => text.trim() && !/مطلوب|required/i.test(text)), path).toEqual([])
      await expect(page.locator('[data-project-background]')).not.toContainText('[object Promise]')
      const backdrop = page.getByTestId('project-sheet-backdrop')
      await expect(backdrop).toBeVisible()
      expect(await backdrop.evaluate(e=>getComputedStyle(e).backdropFilter)).toBe('blur(2px)')
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),path).toBe(true)
      const bounds=await page.getByRole('dialog').boundingBox()
      expect(bounds!.x,path).toBeGreaterThanOrEqual(-1)
      expect(bounds!.x+bounds!.width,path).toBeLessThanOrEqual(width+1)
    }
    await page.goto('/meetings/new')
    await page.screenshot({path:info.outputPath('meeting-sheet-'+width+'.png'),fullPage:true})
  })
}

test('draft survives closing attempt and full-page presentation preserves URL',async({page})=>{
  await page.goto('/hr/employees/new?returnTo=%2Fhr%3Fdepartment_id%3D1')
  await page.locator('#hr-employee-name').fill('مسودة اختبار')
  await page.getByTestId('project-overlay-close').click()
  await expect(page.getByTestId('unsaved-changes-dialog')).toBeVisible()
  await page.getByRole('button',{name:'البقاء في الصفحة',exact:true}).click()
  await expect(page.locator('#hr-employee-name')).toHaveValue('مسودة اختبار')
  await page.locator('#hr-employee-name').fill('')
  await page.getByTestId('project-overlay-full-page').click()
  await expect(page).toHaveURL(/fullPage=1/)
  await expect(page.getByTestId('project-route-overlay')).toHaveCount(0)
  await expect(page.locator('main h1')).toHaveText('موظف جديد')
})

test('nested edit refresh retains list filters',async({page})=>{
  await page.goto('/hr/employees/1/edit?returnTo='+encodeURIComponent('/hr/employees/1?returnTo='+encodeURIComponent('/hr?department_id=1')))
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.reload()
  await page.getByTestId('project-overlay-close').click()
  await expect(page).toHaveURL(/\/hr\?department_id=1$/)
})

for(const [mode,fontSize,root] of [['light','small',14],['light','medium',16],['dark','large',18]] as const){
  test('shared appearance '+mode+'/'+fontSize,async({page})=>{
    await page.context().addCookies([{name:'liwan-appearance',value:encodeURIComponent(JSON.stringify({mode,fontSize})),url:page.url()}])
    for(const path of ['/hr','/meetings','/settings/team/users','/notifications']){
      await page.goto(path)
      await expect(page.locator('main h1')).toBeVisible()
      expect(await page.locator('main h1').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeCloseTo(root*20/14,1)
      expect(await page.locator('html').getAttribute('data-font-size')).toBe(fontSize)
    }
    await page.goto('/chat')
    await expect(page.locator('html')).not.toHaveAttribute('data-workspace-theme')
    await expect(page.getByTestId('project-route-overlay')).toHaveCount(0)
    expect(await page.locator('html').evaluate(e=>getComputedStyle(e).getPropertyValue('--project-type-body').trim())).toBe('')
    await page.goto('/meetings/1/print')
    await expect(page.locator('html')).not.toHaveAttribute('data-workspace-theme')
    await expect(page.getByTestId('project-route-overlay')).toHaveCount(0)
  })
}

test('HR draft remains mounted when background dependency refresh fails',async({page})=>{
  await page.goto('/hr/employees/new')
  await page.locator('#hr-employee-name').fill('مسودة باقية')
  let failures=0
  await page.route('**/api/v1/hr/departments*', route=>{ failures++; return route.fulfill({status:500,contentType:'application/json',body:'{"code":"server_error","message":"Synthetic refresh failure"}'}) })
  // Query staleTime is 5s. A real visibility/focus cycle then refetches it.
  await page.waitForTimeout(5100)
  await page.evaluate(()=>{
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'})
    window.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'})
    window.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(()=>failures).toBeGreaterThan(0)
  await expect(page.getByRole('dialog').locator('[role="alert"]')).toBeVisible()
  await expect(page.locator('#hr-employee-name')).toHaveValue('مسودة باقية')
  await page.getByTestId('project-overlay-close').click()
  await expect(page.getByTestId('unsaved-changes-dialog')).toBeVisible()
})
