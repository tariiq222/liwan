import { test, expect } from '@playwright/test'
import {
  BrandingSchema, MeSchema, TaskListSchema, TaskDetailSchema, TimelineEntrySchema,
  PersonalStageSchema, ProjectRefSchema, PersonRefSchema,
} from '@nasq/contracts'
import { z } from 'zod'

// The zod schemas and the Odoo serializers are written independently; only a
// round trip against the live API proves they still describe the same payload.
test('GET /api/v1/branding matches BrandingSchema', async ({ page }) => {
  const res = await page.request.get('/api/v1/branding')
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(() => BrandingSchema.parse(body)).not.toThrow()
})

test('GET /api/v1/me matches MeSchema', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })
  expect(login.status()).toBe(200)

  // the request context keeps the session cookie the login handed back
  const res = await page.request.get('/api/v1/me')
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(() => MeSchema.parse(body)).not.toThrow()
})

test('task lifecycle: create, read, patch, comment, timeline, transition, and reference lists all match their schemas', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })
  expect(login.status()).toBe(200)

  const listRes = await page.request.get('/api/v1/tasks?filter=mine')
  expect(listRes.status()).toBe(200)
  TaskListSchema.parse(await listRes.json())

  const projectsRes = await page.request.get('/api/v1/projects?minimal=1')
  expect(projectsRes.status()).toBe(200)
  const projects = ProjectRefSchema.array().parse(await projectsRes.json())
  expect(projects.length).toBeGreaterThan(0)

  const createRes = await page.request.post('/api/v1/tasks', {
    data: { name: `E2E contract task ${Date.now()}`, project_id: projects[0]!.id },
  })
  expect(createRes.status()).toBe(201)
  const created = TaskDetailSchema.parse(await createRes.json())

  const getRes = await page.request.get(`/api/v1/tasks/${created.id}`)
  expect(getRes.status()).toBe(200)
  TaskDetailSchema.parse(await getRes.json())

  const patchRes = await page.request.patch(`/api/v1/tasks/${created.id}`, { data: { priority: '2' } })
  expect(patchRes.status()).toBe(200)
  const patched = TaskDetailSchema.parse(await patchRes.json())
  expect(patched.priority).toBe('2')

  const commentRes = await page.request.post(`/api/v1/tasks/${created.id}/comments`, { data: { body: 'contract e2e comment' } })
  expect(commentRes.status()).toBe(201)

  const timelineRes = await page.request.get(`/api/v1/tasks/${created.id}/timeline`)
  expect(timelineRes.status()).toBe(200)
  z.array(TimelineEntrySchema).parse(await timelineRes.json())

  const transitionRes = await page.request.post(`/api/v1/tasks/${created.id}/transition`, { data: { state: 'done' } })
  expect(transitionRes.status()).toBe(200)
  const transitioned = TaskDetailSchema.parse(await transitionRes.json())
  expect(transitioned.is_closed).toBe(true)

  const stagesRes = await page.request.get('/api/v1/me/personal-stages')
  expect(stagesRes.status()).toBe(200)
  z.array(PersonalStageSchema).parse(await stagesRes.json())

  const peopleRes = await page.request.get('/api/v1/people')
  expect(peopleRes.status()).toBe(200)
  z.array(PersonRefSchema).parse(await peopleRes.json())
})
