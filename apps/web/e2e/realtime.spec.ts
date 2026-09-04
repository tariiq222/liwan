import { test, expect, type Browser } from '@playwright/test'

async function login(page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page).toHaveURL('http://localhost:3000/')
}

async function createTask(page, name: string) {
  const projects = await (await page.request.get('/api/v1/projects?minimal=1')).json()
  const res = await page.request.post('/api/v1/tasks', { data: { name, project_id: projects[0].id } })
  return (await res.json()).id as number
}

// Two independent browser contexts, both authenticated as admin: A watches the
// UI, B mutates data via the API only (no UI interaction on B's side),
// simulating a second user's change arriving over the bus while A's page
// sits idle. Server side (nasq_api's project.task create/write override)
// only notifies on task field changes, not on comments (message_post isn't
// overridden) - so this only exercises the ['tasks','list'] and
// taskKeys.detail(id) invalidations useBus() actually triggers.
test('a task rename from another session arrives over the bus, live, without a reload', async ({ browser }: { browser: Browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()

  await login(pageA)
  await login(pageB)

  const name = `E2E realtime ${Date.now()}`
  const id = await createTask(pageA, name)

  await pageA.goto('/tasks')
  const row = pageA.getByRole('row', { name: new RegExp(name) })
  await expect(row).toBeVisible()

  // B renames the task purely over the API - no UI interaction on B's side.
  const renamed1 = `${name}-renamed-1`
  await pageB.request.patch(`/api/v1/tasks/${id}`, { data: { name: renamed1 } })

  // A must show the new name within 5s, with no reload triggered from the test.
  await expect(pageA.getByRole('row', { name: new RegExp(renamed1) })).toBeVisible({ timeout: 5000 })

  // Now A opens the task detail (SSR-independent client route) so the open
  // detail query (taskKeys.detail) is live-mounted, and B renames again.
  await pageA.goto(`/tasks/${id}`)
  const dialog = pageA.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const titleInput = dialog.getByRole('textbox', { name: 'عنوان المهمة' })
  await expect(titleInput).toHaveValue(renamed1)

  const renamed2 = `${name}-renamed-2`
  await pageB.request.patch(`/api/v1/tasks/${id}`, { data: { name: renamed2 } })

  await expect(titleInput).toHaveValue(renamed2, { timeout: 5000 })

  await contextA.close()
  await contextB.close()
})
