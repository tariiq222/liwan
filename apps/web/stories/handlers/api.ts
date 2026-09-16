import { http, HttpResponse } from 'msw'
import { TagSchema } from '@nasq/contracts'
import { boardStages, charterDefaults, charterOwningUnits, charterTypes, me, people, projectCreateDefaults, projectRefs, tags, taskDetail } from '../fixtures/pmo'

const contains = (value: string, request: Request) => value.includes(new URL(request.url).searchParams.get('q') ?? '')

export const apiHandlers = [
  http.get('/api/v1/me', () => HttpResponse.json(me)),
  http.get('/api/v1/people', ({ request }) => HttpResponse.json(people.filter(person => contains(person.name, request)))),
  http.get('/api/v1/projects', () => HttpResponse.json(projectRefs)),
  http.get('/api/v1/me/personal-stages', () => HttpResponse.json(boardStages)),
  http.get('/api/v1/tags', ({ request }) => HttpResponse.json(tags.filter(tag => contains(tag.name, request)))),
  http.post('/api/v1/tags', async ({ request }) => {
    const body = await request.json() as { name: string }
    return HttpResponse.json(TagSchema.parse({ id: 900, name: body.name, color: 0 }))
  }),
  http.patch('/api/v1/tasks/:id', async ({ request }) => HttpResponse.json(taskDetail(await request.json() as Record<string, unknown>))),
  http.post('/api/v1/tasks/:id/transition', async ({ request }) => HttpResponse.json(taskDetail(await request.json() as Record<string, unknown>))),
  http.post('/api/v1/projects/:id/:action', () => HttpResponse.json({ code: 'invalid', message: 'Storybook لا يحاكي أرشفة المشروع.' }, { status: 422 })),
  http.get('/api/v1/project-charter/defaults', () => HttpResponse.json(charterDefaults)),
  http.get('/api/v1/project-charter/catalogs/types', ({ request }) => {
    const items = charterTypes.filter(item => contains(item.name, request))
    return HttpResponse.json({ items, total: items.length })
  }),
  http.get('/api/v1/project-charter/catalogs/owning-units', ({ request }) => {
    const items = charterOwningUnits.filter(item => contains(item.name, request))
    return HttpResponse.json({ items, total: items.length })
  }),
  http.get('/api/v1/settings/projects/create-defaults', () => HttpResponse.json(projectCreateDefaults)),
  http.post('/api/v1/projects', () => HttpResponse.json({ code: 'invalid', message: 'Storybook لا يحاكي إنشاء المشروع.' }, { status: 422 })),
]

export const transitionForbidden = [
  http.post('/api/v1/tasks/:id/transition', () => HttpResponse.json({ code: 'transition_forbidden', message: 'forbidden' }, { status: 403 })),
  ...apiHandlers,
]
