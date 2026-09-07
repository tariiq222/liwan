import { test, expect, type APIResponse } from '@playwright/test'
import { FinanceEntrySchema, ProjectReportListSchema } from '@nasq/contracts'

test.skip(process.env.E2E_PHASES_ISOLATED !== '1', 'Requires an explicitly isolated integration runtime')

async function body(response: APIResponse, status = 200) {
  expect(response.status(), await response.text()).toBe(status)
  return response.json()
}

test('template schedule, governance, finance and report remain consistent in one project', async ({ page }) => {
  await body(await page.request.post('/api/auth/login', { data: { login: 'phase2_manager', password: 'phase2_test_only_2026' } }))
  const name = `Combined phases ${Date.now()}`
  const template = await body(await page.request.post('/api/v1/project-templates', { data: {
    name, definition: {
      stages: [{ key: 'work', name: 'التنفيذ', fold: false }], milestones: [],
      tasks: [
        { key: 'first', name: 'التحضير', stage_key: 'work', start_offset: 0, duration_days: 1, milestone_key: null, dependency_keys: [] },
        { key: 'second', name: 'التسليم', stage_key: 'work', start_offset: 1, duration_days: 2, milestone_key: null, dependency_keys: ['first'] },
      ],
    },
  } }), 201)
  const project = await body(await page.request.post(`/api/v1/project-templates/${template.id}/apply`, { data: { name, start_date: '2030-05-01' } }), 201)
  const path = `/api/v1/projects/${project.id}`
  const schedule = await body(await page.request.get(`${path}/schedule`))
  expect(schedule.tasks).toHaveLength(2)
  const first = schedule.tasks.find((task: { name: string }) => task.name === 'التحضير')
  const second = schedule.tasks.find((task: { name: string }) => task.name === 'التسليم')
  expect(first).toMatchObject({ start: '2030-05-01', end: '2030-05-01' })
  expect(second).toMatchObject({ dependency_ids: [first.id], end: '2030-05-03' })
  const stakeholder = await body(await page.request.post(`${path}/stakeholders`, { data: { name: 'مالك المشروع' } }), 201)
  await body(await page.request.post(`${path}/raci`, { data: { task_id: first.id, stakeholder_id: stakeholder.id, role: 'A' } }), 201)
  const risk = await body(await page.request.post(`${path}/register`, { data: { title: 'تأخر التوريد', kind: 'risk', task_id: second.id, probability: 3, impact: 4 } }), 201)
  expect(risk.score).toBe(12)
  const budget = FinanceEntrySchema.parse(await body(await page.request.post(`${path}/finance`, { data: { kind: 'budget', title: 'ميزانية التنفيذ', amount: 1000 } }), 201))
  await body(await page.request.post(`${path}/finance`, { data: { kind: 'expense', title: 'التكلفة الأولى', amount: 250, expense_date: '2030-05-01', budget_entry_id: budget.id } }), 201)
  await body(await page.request.post(`/api/v1/tasks/${first.id}/transition`, { data: { state: 'done' } }))
  const report = ProjectReportListSchema.parse(await body(await page.request.get(`/api/v1/reports/projects?q=${encodeURIComponent(name)}`)))
  expect(report.total).toBe(1)
  expect(report.items[0]).toMatchObject({ task_count: 2, closed_task_count: 1, progress: 50, finance: { planned: 1000, actual: 250, remaining: 750 } })
  expect((await body(await page.request.get(`${path}/raci`))).items).toContainEqual(expect.objectContaining({ task: expect.objectContaining({ id: first.id }), role: 'A' }))
  await page.goto(`/projects/${project.id}`)
  for (const section of ['schedule', 'stakeholders', 'raci', 'register', 'finance']) {
    await expect(page.getByTestId(`project-${section}-link`)).toBeVisible()
  }
  await page.getByTestId('project-finance-link').click()
  await expect(page.getByTestId('project-finance-summary')).toContainText('750.00')
  await page.goto(`/reports?q=${encodeURIComponent(name)}`)
  await expect(page.getByTestId('reports-row')).toHaveCount(1)
  await expect(page.getByTestId('reports-row')).toContainText('50%')
})
