import { test, expect } from '@playwright/test'

async function login(page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
}

async function createTask(page, name: string) {
  const projectsRes = await page.request.get('/api/v1/projects?minimal=1')
  expect(projectsRes.ok()).toBe(true)
  const projects = await projectsRes.json()
  let projectId = projects[0]?.id as number | undefined
  if (!projectId) {
    const projectRes = await page.request.post('/api/v1/projects', { data: { name: `E2E board project ${Date.now()}` } })
    expect(projectRes.status()).toBe(201)
    projectId = (await projectRes.json()).id as number
  }
  const res = await page.request.post('/api/v1/tasks', { data: { name, project_id: projectId } })
  expect(res.status()).toBe(201)
  return (await res.json()).id as number
}

// Drags the card at `fromLocator` into `toLocator`'s column body with real
// pointer events (page.mouse), since vue-draggable-plus (SortableJS) reacts
// to pointer events, not the HTML5 drag protocol Playwright's dragTo emits.
async function dragCard(page, fromLocator, toLocator) {
  // Columns scroll internally (fixed board height), so the card may start
  // outside the viewport; bring it into view before reading its box.
  await fromLocator.scrollIntoViewIfNeeded()
  const from = await fromLocator.boundingBox()
  const to = await toLocator.boundingBox()
  if (!from || !to) throw new Error('missing bounding box for drag')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  const steps = 10
  const targetX = to.x + to.width / 2
  const targetY = to.y + Math.min(40, to.height / 2)
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      from.x + from.width / 2 + ((targetX - (from.x + from.width / 2)) * i) / steps,
      from.y + from.height / 2 + ((targetY - (from.y + from.height / 2)) * i) / steps,
    )
    await page.waitForTimeout(20)
  }
  await page.mouse.up()
}

test('board tab: drag between stages persists, and the keyboard menu moves a card too', async ({ page }) => {
  await login(page)
  const name = `E2E board ${Date.now()}`
  const id = await createTask(page, name)

  await page.goto('/tasks?tab=board')
  await expect(page.getByRole('heading', { name: 'مهامي' })).toBeVisible()

  // The leading "بلا مرحلة" column always renders (Odoo assigns every new
  // task a default personal stage on create, so this doesn't hold the new
  // task itself, but the column must still exist as a drop target).
  const unstagedColumn = page.getByTestId('board-column').filter({ hasText: 'بلا مرحلة' })
  await expect(unstagedColumn).toBeVisible()

  // The new task starts in the current user's first personal stage (Odoo's
  // own default-assignment behaviour on task create).
  const stageColumns = page.getByTestId('board-column').filter({ hasNotText: 'بلا مرحلة' })
  const firstColumn = stageColumns.nth(0)
  let card = page.getByTestId(`board-card-${id}`)
  await expect(card).toBeVisible()
  await expect(firstColumn.getByTestId(`board-card-${id}`)).toBeVisible()

  // Drag it into the second real stage column.
  const targetColumn = stageColumns.nth(1)
  const targetStageName = await targetColumn.getByTestId('board-column-title').innerText()
  const dragged = page.waitForResponse((r) => r.url().includes(`/api/v1/tasks/${id}`) && r.request().method() === 'PATCH')
  await dragCard(page, card, targetColumn)
  const dragResponse = await dragged
  expect(dragResponse.status()).toBe(200)
  await dragResponse.finished()
  await expect(targetColumn.getByTestId(`board-card-${id}`)).toBeVisible({ timeout: 10_000 })

  // Persists after reload.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'مهامي' })).toBeVisible()
  const reloadedTargetColumn = page.getByTestId('board-column').filter({ hasText: targetStageName })
  await expect(reloadedTargetColumn.getByTestId(`board-card-${id}`)).toBeVisible({ timeout: 10_000 })

  // Keyboard fallback: the "..." menu's "نقل إلى..." lists every stage;
  // picking a third stage moves the card there too.
  card = page.getByTestId(`board-card-${id}`)
  await card.getByRole('button', { name: '⋯' }).click()
  await expect(page.getByText('نقل إلى…')).toBeVisible()
  const thirdStageColumn = stageColumns.nth(2)
  const thirdStageName = await thirdStageColumn.getByTestId('board-column-title').innerText()
  const patched = page.waitForResponse((r) => r.url().includes(`/api/v1/tasks/${id}`) && r.request().method() === 'PATCH')
  await page.getByRole('menuitem', { name: thirdStageName, exact: true }).click()
  const patchResponse = await patched
  expect(patchResponse.status()).toBe(200)
  await patchResponse.finished()

  await page.reload()
  const reloadedThirdColumn = page.getByTestId('board-column').filter({ hasText: thirdStageName })
  await expect(reloadedThirdColumn.getByTestId(`board-card-${id}`)).toBeVisible({ timeout: 10_000 })
})

test('board tab: a folded stage renders collapsed with a count and expands on click', async ({ page }) => {
  await login(page)
  await page.goto('/tasks?tab=board')
  await expect(page.getByRole('heading', { name: 'مهامي' })).toBeVisible()

  // The default personal stages seed "Done"/"Cancelled" (translated) as
  // folded; assert at least one column renders collapsed, with a visible
  // count, and that clicking it swaps in the full column.
  const foldedColumn = page.getByTestId('board-column-folded').first()
  await expect(foldedColumn).toBeVisible()
  const stageId = await foldedColumn.getAttribute('data-stage-id')
  await expect(foldedColumn.getByTestId('board-column-count')).toBeVisible()
  await foldedColumn.click()
  await expect(page.locator(`[data-testid="board-column-folded"][data-stage-id="${stageId}"]`)).toHaveCount(0)
  await expect(page.locator(`[data-testid="board-column"][data-stage-id="${stageId}"]`)).toBeVisible()
})
