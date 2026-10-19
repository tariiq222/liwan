import { test, expect, type APIResponse } from '@playwright/test'
import { FinanceEntrySchema, ProjectDashboardAnalyticsSchema } from '@webvue/contracts'

test.skip(process.env.E2E_PHASES_ISOLATED !== '1', 'Requires an explicitly isolated integration runtime')

async function body(response: APIResponse, status = 200) {
  expect(response.status(), await response.text()).toBe(status)
  return response.json()
}

test('schedule, governance, finance and report remain consistent in one project', async ({ page }) => {
  await body(await page.request.post('/api/auth/login', { data: { login: 'phase2_manager', password: 'phase2_test_only_2026' } }))
  const name = `Combined phases ${Date.now()}`
  const project = await body(await page.request.post('/api/v1/projects', { data: { name, date_end: '2035-12-31' } }), 201)
  await body(await page.request.post('/api/v1/tasks', { data: { name: 'التحضير', project_id: project.id, planned_start: '2030-05-01', date_deadline: '2030-05-01T00:00:00Z' } }), 201)
  await body(await page.request.post('/api/v1/tasks', { data: { name: 'التسليم', project_id: project.id, planned_start: '2030-05-02', date_deadline: '2030-05-03T00:00:00Z' } }), 201)
  const path = `/api/v1/projects/${project.id}`
  const schedule = await body(await page.request.get(`${path}/schedule`))
  expect(schedule.tasks).toHaveLength(2)
  const first = schedule.tasks.find((task: { name: string }) => task.name === 'التحضير')
  const second = schedule.tasks.find((task: { name: string }) => task.name === 'التسليم')
  expect(first).toMatchObject({ start: '2030-05-01', end: '2030-05-01' })
  expect(second).toMatchObject({ start: '2030-05-02', end: '2030-05-03' })
  const stakeholder = await body(await page.request.post(`${path}/stakeholders`, { data: { name: 'مالك المشروع' } }), 201)
  await body(await page.request.post(`${path}/raci`, { data: { task_id: first.id, stakeholder_id: stakeholder.id, role: 'A' } }), 201)
  const risk = await body(await page.request.post(`${path}/register`, { data: { title: 'تأخر التوريد', kind: 'risk', task_id: second.id, probability: 3, impact: 4 } }), 201)
  expect(risk.score).toBe(12)
  const budget = FinanceEntrySchema.parse(await body(await page.request.post(`${path}/finance`, { data: { kind: 'budget', title: 'ميزانية التنفيذ', amount: 1000 } }), 201))
  await body(await page.request.post(`${path}/finance`, { data: { kind: 'expense', title: 'التكلفة الأولى', amount: 250, expense_date: '2030-05-01', budget_entry_id: budget.id } }), 201)
  await body(await page.request.post(`/api/v1/tasks/${first.id}/transition`, { data: { state: 'done' } }))
  const report = ProjectDashboardAnalyticsSchema.parse(await body(await page.request.get(`/api/v1/reports/projects/analytics?q=${encodeURIComponent(name)}`)))
  expect(report.project_count).toBe(1)
  expect(report.projects[0]).toMatchObject({ task_count: 2, closed_task_count: 1, progress: 50, finance: { planned: 1000, actual: 250, remaining: 750 } })
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
