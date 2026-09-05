import { test, expect, type Browser } from '@playwright/test'

async function login(page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
}

async function createTask(page, name: string) {
  const projects = await (await page.request.get('/api/v1/projects?minimal=1')).json()
  const res = await page.request.post('/api/v1/tasks', { data: { name, project_id: projects[0].id } })
  return (await res.json()).id as number
}

// Two independent browser contexts, both authenticated as admin: A watches the
// UI, B mutates data via the API only (no UI interaction on B's side),
// simulating a second user's change arriving over the bus while A's page
// sits idle.
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
  await expect(pageA.getByRole('status', { name: 'متصل' })).toBeVisible()
  // Keep the fixture visible even when the database has multiple result pages.
  await pageA.getByPlaceholder('بحث في العناوين…').fill(name)
  const row = pageA.getByRole('row', { name: new RegExp(name) })
  await expect(row).toBeVisible()

  // B renames the task purely over the API - no UI interaction on B's side.
  const renamed1 = `${name}-renamed-1`
  const firstRename = await pageB.request.patch(`/api/v1/tasks/${id}`, { data: { name: renamed1 } })
  expect(firstRename.status()).toBe(200)
  await firstRename.body()

  // A must show the new name within 5s, with no reload triggered from the test.
  await expect(pageA.getByRole('row', { name: new RegExp(renamed1) })).toBeVisible({ timeout: 5000 })

  // Now A opens the task detail (SSR-independent client route) so the open
  // detail query (taskKeys.detail) is live-mounted, and B renames again.
  await pageA.goto(`/tasks/${id}`)
  const dialog = pageA.getByTestId('task-detail-page')
  await expect(dialog).toBeVisible()
  const titleInput = dialog.getByRole('textbox', { name: 'عنوان المهمة' })
  await expect(titleInput).toHaveValue(renamed1)
  // page.goto creates a new document and therefore a new bus socket. Wait for
  // its subscription before the second context emits the change under test.
  await expect(pageA.getByRole('status', { name: 'متصل' })).toBeVisible()

  const renamed2 = `${name}-renamed-2`
  const secondRename = await pageB.request.patch(`/api/v1/tasks/${id}`, { data: { name: renamed2 } })
  expect(secondRename.status()).toBe(200)
  await secondRename.body()

  await expect(titleInput).toHaveValue(renamed2, { timeout: 5000 })

  await contextA.close()
  await contextB.close()
})

// A has the task's activity column open (drawer/detail already mounted, so
// taskKeys.timeline(id) is a live query); B posts a comment purely over the
// API. project_task.py's _message_post_after_hook makes message_post() emit
// the same nasq/task bus notification write()/create() do, so A's
// useBus()-driven invalidation picks it up without any reload.
test('a comment posted from another session arrives in the activity column, live', async ({ browser }: { browser: Browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()

  await login(pageA)
  await login(pageB)

  const name = `E2E realtime comment ${Date.now()}`
  const id = await createTask(pageA, name)

  await pageA.goto(`/tasks/${id}`)
  await expect(pageA.getByTestId('task-detail-page')).toBeVisible()

  const commentBody = `hello from B ${Date.now()}`
  const res = await pageB.request.post(`/api/v1/tasks/${id}/comments`, { data: { body: commentBody } })
  expect(res.ok()).toBe(true)

  await expect(pageA.getByText(commentBody)).toBeVisible({ timeout: 10_000 })

  await contextA.close()
  await contextB.close()
})
