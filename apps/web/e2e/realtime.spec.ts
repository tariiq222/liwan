import { test, expect, type Browser, type Page } from '@playwright/test'
import { ACCEPTANCE_ORIGIN, signIn } from './support/realOdooSession'

// Runs only on the isolated real-Odoo stack (deploy/ci/e2e-odoo.sh).
test.skip(process.env.E2E_REAL_ODOO !== '1', 'Explicit isolated real Odoo acceptance only')
test.beforeEach(async ({}, info) => { expect(new URL(String(info.project.use.baseURL)).origin).toBe(ACCEPTANCE_ORIGIN) })

async function createTask(page, name: string) {
  const projects = await (await page.request.get('/api/v1/projects?minimal=1')).json()
  const res = await page.request.post('/api/v1/tasks', { data: { name, project_id: projects[0].id } })
  return (await res.json()).id as number
}

type TaskBusNotification = {
  message: { type: string; payload?: { id: number; updated_at?: string; changed_fields?: string[] } }
}

function observeTaskRenames(page: Page) {
  const revisions = new Set<string>()
  page.on('websocket', socket => {
    if (new URL(socket.url()).pathname !== '/websocket') return
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string' || !payload.startsWith('[')) return
      for (const { message } of JSON.parse(payload) as TaskBusNotification[]) {
        const event = message.payload
        if (message.type === 'liwan/task' && event?.updated_at && event.changed_fields?.includes('name')) {
          revisions.add(`${event.id}:${event.updated_at}`)
        }
      }
    })
  })
  return (id: number, revision: string) => expect.poll(() => revisions.has(`${id}:${revision}`), {
    message: `WebSocket delivered task ${id} revision ${revision}`,
    timeout: 10_000,
  }).toBe(true)
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

  await signIn(pageA)
  await signIn(pageB)

  const name = `E2E realtime ${Date.now()}`
  const id = await createTask(pageA, name)

  const waitForRename = observeTaskRenames(pageA)
  // Open the final list query directly so the write cannot race the toolbar's debounced query change.
  await pageA.goto(`/tasks?${new URLSearchParams({ q: name })}`)
  await expect(pageA.getByTestId('account-menu').getByRole('status', { name: 'متصل', exact: true })).toBeVisible()
  const row = pageA.getByRole('row', { name: new RegExp(name) })
  await expect(row).toBeVisible()

  // B renames the task purely over the API - no UI interaction on B's side.
  const renamed1 = `${name}-renamed-1`
  const firstRename = await pageB.request.patch(`/api/v1/tasks/${id}`, { data: { name: renamed1 } })
  expect(firstRename.status()).toBe(200)
  const firstTask = await firstRename.json()
  expect(firstTask.name).toBe(renamed1)
  await waitForRename(id, firstTask.updated_at)

  // The real bus frame must update the already-mounted list without a reload.
  await expect(pageA.getByRole('row', { name: new RegExp(renamed1) })).toBeVisible({ timeout: 5000 })

  // Now A opens the task detail (SSR-independent client route) so the open
  // detail query (taskKeys.detail) is live-mounted, and B renames again.
  await pageA.goto(`/tasks/${id}`)
  const dialog = pageA.getByTestId('task-detail-page')
  await expect(dialog).toBeVisible()
  const title = pageA.locator('h1')
  await expect(title).toHaveText(renamed1)
  // page.goto creates a new document and therefore a new bus socket. Wait for
  // its subscription before the second context emits the change under test.
  await expect(pageA.getByTestId('account-menu').getByRole('status', { name: 'متصل', exact: true })).toBeVisible()

  const renamed2 = `${name}-renamed-2`
  const secondRename = await pageB.request.patch(`/api/v1/tasks/${id}`, { data: { name: renamed2 } })
  expect(secondRename.status()).toBe(200)
  const secondTask = await secondRename.json()
  expect(secondTask.name).toBe(renamed2)
  await waitForRename(id, secondTask.updated_at)

  await expect(title).toHaveText(renamed2, { timeout: 5000 })

  await contextA.close()
  await contextB.close()
})

// A has the task's activity column open (drawer/detail already mounted, so
// taskKeys.timeline(id) is a live query); B posts a comment purely over the
// API. project_task.py's _message_post_after_hook makes message_post() emit
// the same liwan/task bus notification write()/create() do, so A's
// useBus()-driven invalidation picks it up without any reload.
test('a comment posted from another session arrives in the activity column, live', async ({ browser }: { browser: Browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()

  await signIn(pageA)
  await signIn(pageB)

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
