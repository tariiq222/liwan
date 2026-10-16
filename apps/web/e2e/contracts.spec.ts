import { test, expect } from '@playwright/test'
import {
  BrandingSchema, MeSchema, TaskListSchema, TaskDetailSchema, TimelineEntrySchema,
  PersonalStageSchema, ProjectRefSchema, PersonRefSchema, ApiErrorSchema,
  ProjectDetailSchema, ProjectListSchema, ProjectStageSchema, UserRefSchema,
  MilestoneSchema, ProjectUpdateSchema, ProjectSettingsSchema, TagSchema,
  ProjectCharterDefaultsSchema, ProjectCharterReferenceListSchema, ProjectCharterSchema,
  ChatConversationListSchema, ChatConversationSchema, ChatMessageListSchema,
  ChatRecipientListSchema,
} from '@webvue/contracts'
import { z } from 'zod'

const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const FIXTURE_PASSWORD = 'WebVueContract-Initial-123!'

async function createPasswordFixture(request, suffix: string) {
  const meRes = await request.get('/api/v1/me')
  expect(meRes.status()).toBe(200)
  const me = MeSchema.parse(await meRes.json())
  const rolesRes = await request.get('/api/v1/admin/roles')
  expect(rolesRes.status()).toBe(200)
  const roles = await rolesRes.json()
  const employeeRole = roles.items.find((role: { key: string }) => role.key === 'employee')
  expect(employeeRole).toBeTruthy()
  const login = `contract-password-${suffix}@example.test`
  const employeeRes = await request.post('/api/v1/hr/employees', {
    data: { name: `Contract password ${suffix}`, work_email: login },
  })
  expect(employeeRes.status()).toBe(201)
  const employee = await employeeRes.json()
  const userRes = await request.post('/api/v1/admin/users', {
    data: {
      employee_id: employee.id,
      password: FIXTURE_PASSWORD,
      assignments: [{ role_id: employeeRole.id, scope: { kind: 'company', id: me.company.id } }],
    },
  })
  expect(userRes.status()).toBe(201)
  return login
}

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

test('admin branding and employee self password mutation responses match their schemas', async ({ page, browser }) => {
  const login = await page.request.post('/api/auth/login', {
    data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD },
  })
  expect(login.status()).toBe(200)

  const brandingGetRes = await page.request.get('/api/v1/admin/branding')
  expect(brandingGetRes.status()).toBe(200)
  const originalBranding = BrandingSchema.parse(await brandingGetRes.json())
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const employeeLogin = await createPasswordFixture(page.request, suffix)
  const updatedName = `E2E contract branding ${suffix}`
  const updatedColor = '#123456'
  let brandingChanged = false

  try {
    const brandingPatchRes = await page.request.patch('/api/v1/admin/branding', {
      data: { primary_color: updatedColor },
    })
    if (brandingPatchRes.status() === 200) brandingChanged = true
    expect(brandingPatchRes.status()).toBe(200)
    const patchedBranding = BrandingSchema.parse(await brandingPatchRes.json())
    expect(patchedBranding.name).toBe(originalBranding.name)
    expect(patchedBranding.primary_color).toBe(updatedColor)

    const forbidden = await page.request.patch('/api/v1/admin/branding', { data: { name: updatedName, primary_color: '#654321' } })
    expect(forbidden.status()).toBe(403)
    expect(BrandingSchema.parse(await (await page.request.get('/api/v1/admin/branding')).json())).toEqual(patchedBranding)

    const employeeContext = await browser.newContext({ baseURL: BASE_URL, locale: 'ar-SA' })
    const temporaryPassword = `E2E-contract-password-${suffix}`
    let passwordChanged = false
    try {
      const employeeLoginRes = await employeeContext.request.post('/api/auth/login', {
        data: { login: employeeLogin, password: FIXTURE_PASSWORD },
      })
      expect(employeeLoginRes.status()).toBe(200)
      const passwordRes = await employeeContext.request.post('/api/v1/me/password', {
        data: { current: FIXTURE_PASSWORD, new: temporaryPassword },
      })
      if (passwordRes.status() === 200) passwordChanged = true
      expect(passwordRes.status()).toBe(200)
      MeSchema.parse(await passwordRes.json())
    } finally {
      try {
        if (passwordChanged) {
          const restorePasswordRes = await employeeContext.request.post('/api/v1/me/password', {
            data: { current: temporaryPassword, new: FIXTURE_PASSWORD },
          })
          expect(restorePasswordRes.status()).toBe(200)
          MeSchema.parse(await restorePasswordRes.json())
        }
      } finally {
        await employeeContext.close()
      }
    }
  } finally {
    if (brandingChanged) {
      const restoreBrandingRes = await page.request.patch('/api/v1/admin/branding', {
        data: { primary_color: originalBranding.primary_color },
      })
      expect(restoreBrandingRes.status()).toBe(200)
      BrandingSchema.parse(await restoreBrandingRes.json())
    }
  }
})

test('task lifecycle: create, read, patch, comment, timeline, transition, and reference lists all match their schemas', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })
  expect(login.status()).toBe(200)

  const listRes = await page.request.get('/api/v1/tasks?filter=mine')
  expect(listRes.status()).toBe(200)
  TaskListSchema.parse(await listRes.json())

  const projectsRes = await page.request.get('/api/v1/projects?minimal=1')
  expect(projectsRes.status()).toBe(200)
  let projects = ProjectRefSchema.array().parse(await projectsRes.json())
  if (projects.length === 0) {
    const projectRes = await page.request.post('/api/v1/projects', {
      data: { name: `E2E contract task project ${Date.now()}`, date_end: '2035-12-31' },
    })
    expect(projectRes.status()).toBe(201)
    ProjectDetailSchema.parse(await projectRes.json())
    const refreshedProjectsRes = await page.request.get('/api/v1/projects?minimal=1')
    expect(refreshedProjectsRes.status()).toBe(200)
    projects = ProjectRefSchema.array().parse(await refreshedProjectsRes.json())
  }
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
  const comment = TimelineEntrySchema.parse(await commentRes.json())
  expect(comment.kind).toBe('comment')

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

  const bad = await page.request.post('/api/v1/tasks', { data: { name: '   ', project_id: projects[0]!.id } })
  expect(bad.status()).toBe(422)
  const err = ApiErrorSchema.parse(await bad.json())
  expect(err.field).toBe('name')
})

test('projects: list, detail, status and the project-scoped task list match their schemas', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })
  expect(login.status()).toBe(200)

  const listRes = await page.request.get('/api/v1/projects')
  expect(listRes.status()).toBe(200)
  let list = ProjectListSchema.parse(await listRes.json())
  if (list.items.length === 0) {
    const createRes = await page.request.post('/api/v1/projects', {
      data: { name: `E2E contract list project ${Date.now()}`, date_end: '2035-12-31' },
    })
    expect(createRes.status()).toBe(201)
    ProjectDetailSchema.parse(await createRes.json())
    const refreshedListRes = await page.request.get('/api/v1/projects')
    expect(refreshedListRes.status()).toBe(200)
    list = ProjectListSchema.parse(await refreshedListRes.json())
  }
  expect(list.items.length).toBeGreaterThan(0)
  const projects = list.items

  const detailRes = await page.request.get(`/api/v1/projects/${projects[0]!.id}`)
  expect(detailRes.status()).toBe(200)
  const detail = ProjectDetailSchema.parse(await detailRes.json())
  expect(detail.can_manage).toBe(true)

  const statusRes = await page.request.post(`/api/v1/projects/${detail.id}/status`, { data: { status: 'on_track' } })
  expect(statusRes.status()).toBe(200)
  expect(ProjectDetailSchema.parse(await statusRes.json()).status).toBe('on_track')

  const tasksRes = await page.request.get(`/api/v1/tasks?project_id=${detail.id}`)
  expect(tasksRes.status()).toBe(200)
  TaskListSchema.parse(await tasksRes.json())
})

test('project admin round trip: create, patch, stages, followers, milestones, updates, tags, and settings all match their schemas', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })
  expect(login.status()).toBe(200)

  // settings: GET/PATCH as admin
  const settingsGetRes = await page.request.get('/api/v1/settings/projects')
  expect(settingsGetRes.status()).toBe(200)
  const settings = ProjectSettingsSchema.parse(await settingsGetRes.json())

  const settingsPatchRes = await page.request.patch('/api/v1/settings/projects', {
    data: { project_creators: settings.project_creators, default_stages: settings.default_stages },
  })
  expect(settingsPatchRes.status()).toBe(200)
  ProjectSettingsSchema.parse(await settingsPatchRes.json())

  // create
  const createRes = await page.request.post('/api/v1/projects', { data: { name: `E2E contract project ${Date.now()}`, date_end: '2035-12-31' } })
  expect(createRes.status()).toBe(201)
  const project = ProjectDetailSchema.parse(await createRes.json())
  expect(project.can_manage).toBe(true)

  // patch
  const patchRes = await page.request.patch(`/api/v1/projects/${project.id}`, {
    data: { description: 'contract e2e', privacy_visibility: 'followers' },
  })
  expect(patchRes.status()).toBe(200)
  const patched = ProjectDetailSchema.parse(await patchRes.json())
  expect(patched.privacy_visibility).toBe('followers')

  // stages: add, order, delete
  const addStageRes = await page.request.post(`/api/v1/projects/${project.id}/stages`, { data: { name: 'Contract Stage' } })
  expect(addStageRes.status()).toBe(201)
  const stage = ProjectStageSchema.parse(await addStageRes.json())

  const orderRes = await page.request.put(`/api/v1/projects/${project.id}/stages/order`, {
    data: { ids: [stage.id, ...patched.stages.map((s) => s.id)] },
  })
  expect(orderRes.status()).toBe(200)
  z.array(ProjectStageSchema).parse(await orderRes.json())

  const deleteStageRes = await page.request.delete(`/api/v1/projects/${project.id}/stages/${stage.id}`)
  expect(deleteStageRes.status()).toBe(204)

  // followers
  const meRes = await page.request.get('/api/v1/me')
  const me = MeSchema.parse(await meRes.json())

  const followersRes = await page.request.get(`/api/v1/projects/${project.id}/followers`)
  expect(followersRes.status()).toBe(200)
  z.array(UserRefSchema).parse(await followersRes.json())

  const addFollowerRes = await page.request.post(`/api/v1/projects/${project.id}/followers`, { data: { user_id: me.id } })
  expect(addFollowerRes.status()).toBe(200)
  const followers = z.array(UserRefSchema).parse(await addFollowerRes.json())
  expect(followers.some((f) => f.id === me.id)).toBe(true)

  const removeFollowerRes = await page.request.delete(`/api/v1/projects/${project.id}/followers/${me.id}`)
  expect(removeFollowerRes.status()).toBe(200)
  z.array(UserRefSchema).parse(await removeFollowerRes.json())

  // milestones
  const createMilestoneRes = await page.request.post(`/api/v1/projects/${project.id}/milestones`, { data: { name: 'Contract Milestone' } })
  expect(createMilestoneRes.status()).toBe(201)
  const milestone = MilestoneSchema.parse(await createMilestoneRes.json())

  const patchMilestoneRes = await page.request.patch(`/api/v1/projects/${project.id}/milestones/${milestone.id}`, { data: { is_reached: true } })
  expect(patchMilestoneRes.status()).toBe(200)
  expect(MilestoneSchema.parse(await patchMilestoneRes.json()).is_reached).toBe(true)

  const deleteMilestoneRes = await page.request.delete(`/api/v1/projects/${project.id}/milestones/${milestone.id}`)
  expect(deleteMilestoneRes.status()).toBe(204)

  // updates
  const createUpdateRes = await page.request.post(`/api/v1/projects/${project.id}/updates`, {
    data: { status: 'on_track', name: 'Contract update' },
  })
  expect(createUpdateRes.status()).toBe(201)
  ProjectUpdateSchema.parse(await createUpdateRes.json())

  const updatesListRes = await page.request.get(`/api/v1/projects/${project.id}/updates`)
  expect(updatesListRes.status()).toBe(200)
  z.array(ProjectUpdateSchema).parse(await updatesListRes.json())

  // tags
  const createTagRes = await page.request.post('/api/v1/tags', { data: { name: `contract-tag-${Date.now()}` } })
  expect(createTagRes.status()).toBe(201)
  TagSchema.parse(await createTagRes.json())

  const tagsListRes = await page.request.get('/api/v1/tags')
  expect(tagsListRes.status()).toBe(200)
  z.array(TagSchema).parse(await tagsListRes.json())
})

test('project charter detail, defaults, and catalogs match their schemas', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })
  expect(login.status()).toBe(200)

  const defaultsRes = await page.request.get('/api/v1/project-charter/defaults')
  expect(defaultsRes.status()).toBe(200)
  ProjectCharterDefaultsSchema.parse(await defaultsRes.json())

  const typesRes = await page.request.get('/api/v1/project-charter/catalogs/types?active=1&limit=50&offset=0')
  expect(typesRes.status()).toBe(200)
  const types = ProjectCharterReferenceListSchema.parse(await typesRes.json())
  expect(types.total).toBeGreaterThanOrEqual(4)

  const unitsRes = await page.request.get('/api/v1/project-charter/catalogs/owning-units?active=1&limit=50&offset=0')
  expect(unitsRes.status()).toBe(200)
  ProjectCharterReferenceListSchema.parse(await unitsRes.json())

  const createRes = await page.request.post('/api/v1/projects', {
    data: { name: `E2E charter contract ${Date.now()}`, date_end: '2035-12-31' },
  })
  expect(createRes.status()).toBe(201)
  const created = ProjectDetailSchema.parse(await createRes.json())
  expect(created.updated_at).toMatch(/^v\d+$/)
  ProjectCharterSchema.parse(created.charter)
  expect(created.charter.budget_state).toBe('unknown')
  expect(created.charter.amount).toBeNull()

  const patchRes = await page.request.patch(`/api/v1/projects/${created.id}`, {
    data: {
      expected_updated_at: created.updated_at,
      charter: { budget_state: 'estimate', amount: 0, rationale: 'contract' },
    },
  })
  expect(patchRes.status()).toBe(200)
  const patched = ProjectDetailSchema.parse(await patchRes.json())
  expect(patched.charter.budget_state).toBe('estimate')
  expect(patched.charter.amount).toBe(0)
})

test('chat list and recipients match Chat schemas', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', {
    data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD },
  })
  expect(login.status()).toBe(200)
  const listRes = await page.request.get('/api/v1/chat/conversations?filter=all&limit=10&offset=0')
  expect(listRes.status()).toBe(200)
  ChatConversationListSchema.parse(await listRes.json())
  const recipientsRes = await page.request.get('/api/v1/chat/recipients?limit=10')
  expect(recipientsRes.status()).toBe(200)
  ChatRecipientListSchema.parse(await recipientsRes.json())
})

test('chat create send and messages match Chat schemas', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', {
    data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD },
  })
  expect(login.status()).toBe(200)
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const me = MeSchema.parse(await (await page.request.get('/api/v1/me')).json())
  const roles = await (await page.request.get('/api/v1/admin/roles')).json()
  const employeeRole = roles.items.find((role: { key: string }) => role.key === 'employee')
  expect(employeeRole).toBeTruthy()
  const employeeRes = await page.request.post('/api/v1/hr/employees', {
    data: { name: `Chat contract ${suffix}`, work_email: `chat-contract-${suffix}@example.test` },
  })
  expect(employeeRes.status()).toBe(201)
  const employee = await employeeRes.json()
  const userRes = await page.request.post('/api/v1/admin/users', {
    data: {
      employee_id: employee.id,
      password: FIXTURE_PASSWORD,
      assignments: [{ role_id: employeeRole.id, scope: { kind: 'company', id: me.company.id } }],
    },
  })
  expect(userRes.status()).toBe(201)
  const peer = await userRes.json()
  const createdRes = await page.request.post('/api/v1/chat/conversations', {
    data: { user_ids: [peer.id] },
  })
  expect(createdRes.status()).toBe(201)
  const conversation = ChatConversationSchema.parse(await createdRes.json())
  const sentRes = await page.request.post(`/api/v1/chat/conversations/${conversation.id}/messages`, {
    data: { body: 'contract chat' },
  })
  expect(sentRes.status()).toBe(201)
  const messagesRes = await page.request.get(`/api/v1/chat/conversations/${conversation.id}/messages`)
  expect(messagesRes.status()).toBe(200)
  ChatMessageListSchema.parse(await messagesRes.json())
})
