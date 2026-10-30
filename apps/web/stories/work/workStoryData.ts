import { MeSchema } from '@liwan/contracts'
import { http, HttpResponse } from 'msw'
import { shellHandlers } from '../handlers/shell'
import { shellMe } from '../fixtures/shell'

// A user who may read personal tasks only, so the real «tasks-due» provider is the one source of rows and the stories run on the
// application's own manifest instead of a stand-in. Deadlines are relative to now: one overdue, two due today.
const platform = shellMe.platform!
const taskMe = MeSchema.parse({
  ...shellMe,
  capabilities: ['tasks.tasks.read', 'tasks.tasks.create'],
  platform: { ...platform, readable_features: ['tasks.enabled'], writable_features: ['tasks.enabled'] },
})
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()
const task = (id: number, name: string, date_deadline: string) =>
  ({ id, name, state: 'open', priority: 'normal', date_deadline, assignees: [], source: 'personal', project: null, href: `/my-tasks/${id}` })

const items = [task(1, 'تقرير الربع الثالث', daysAgo(3)), task(2, 'مراجعة العقد', new Date().toISOString()), task(3, 'ترتيب الملفات', new Date().toISOString())]

/** The shell's requests with a tasks-only identity and three attention-worthy personal tasks. First match wins. */
export const workHandlers = [
  http.get('/api/v1/me', () => HttpResponse.json(taskMe)),
  http.get('/api/v1/my-tasks', () => HttpResponse.json({ items, total: items.length })),
  ...shellHandlers,
]

/** The same identity with no task due, so the work surfaces show their empty states. */
export const quietWorkHandlers = [
  http.get('/api/v1/me', () => HttpResponse.json(taskMe)),
  http.get('/api/v1/my-tasks', () => HttpResponse.json({ items: [], total: 0 })),
  ...shellHandlers,
]
