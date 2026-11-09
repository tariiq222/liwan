import { test, expect } from '@playwright/test'
import { ACCEPTANCE_ORIGIN, signIn } from './support/realOdooSession'

// Runs only on the isolated real-Odoo stack (deploy/ci/e2e-odoo.sh).
test.skip(process.env.E2E_REAL_ODOO !== '1', 'Explicit isolated real Odoo acceptance only')
test.beforeEach(async ({}, info) => { expect(new URL(String(info.project.use.baseURL)).origin).toBe(ACCEPTANCE_ORIGIN) })

async function createTask(page, name: string) {
  const projectsRes = await page.request.get('/api/v1/projects?minimal=1')
  expect(projectsRes.ok()).toBe(true)
  const projects = await projectsRes.json()
  let projectId = projects[0]?.id as number | undefined
  if (!projectId) {
    const projectRes = await page.request.post('/api/v1/projects', { data: { name: `E2E board project ${Date.now()}`, date_end: '2035-12-31' } })
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
  // The board scrolls horizontally and each column scrolls vertically, so both
  // ends are brought into view before their boxes are read.
  // The drop target is the column's own SortableJS list (its `liwan-thin-scroll`
  // child), not the column box: the sticky header and the "no tasks" line are
  // siblings of that list, so a release over them never lands on a list.
  const list = toLocator.locator('.liwan-thin-scroll')
  await toLocator.scrollIntoViewIfNeeded()
  await fromLocator.scrollIntoViewIfNeeded()
  const from = await fromLocator.boundingBox()
  const to = await list.boundingBox()
  if (!from || !to) throw new Error('missing bounding box for drag')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  const steps = 10
  const targetX = to.x + to.width / 2
  // Just inside the list's top edge: a drop zone at any card count, and above
  // the first card's content so the insertion point stays the list itself.
  const targetY = to.y + Math.min(24, to.height / 2)
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
  await signIn(page)
  const name = `E2E board ${Date.now()}`
  const id = await createTask(page, name)

  // `&group=stage` is required: TaskBoard groups by status unless
  // `route.query.group === 'stage'`, and only stage columns make a drag a
  // stage PATCH (`applyMove`); a status board POSTs a transition instead.
  await page.goto('/tasks?view=board&group=stage')
  await expect(page.getByRole('heading', { name: 'مهام المشاريع', exact: true })).toBeVisible()

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
  await expect(page.getByRole('heading', { name: 'مهام المشاريع', exact: true })).toBeVisible()
  const reloadedTargetColumn = page.getByTestId('board-column').filter({ hasText: targetStageName })
  await expect(reloadedTargetColumn.getByTestId(`board-card-${id}`)).toBeVisible({ timeout: 10_000 })

  // Keyboard fallback: the card menu (lucide trigger, aria-label) lists the
  // stage names themselves on a stage board (moveTargets = sortedStages); picking
  // a third stage moves the card through the same applyMove PATCH.
  card = page.getByTestId(`board-card-${id}`)
  await card.getByRole('button', { name: 'إجراءات المهمة', exact: true }).click()
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
  await signIn(page)
  // Stage grouping is required: the default status board has no folded columns at all.
  await page.goto('/tasks?view=board&group=stage')
  await expect(page.getByRole('heading', { name: 'مهام المشاريع', exact: true })).toBeVisible()

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
