import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { appManifests } from '../manifests'
import type { AppSearchApi } from '../types'

// What the manifests declare for the home cards: every application has a card, the figures are at most two, speak
// through real locale keys, and read the endpoints the applications' own pages already use.
const locale = (name: 'ar' | 'en') => JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../i18n/locales/${name}/common.json`), 'utf8')) as Record<string, unknown>
const lookup = (tree: Record<string, unknown>, key: string) => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], tree)
const withRail = appManifests.filter(manifest => manifest.rail.length > 0)
const figures = withRail.flatMap(manifest => manifest.appCard?.figures ?? [])

describe('manifest app cards', () => {
  it('gives every application with a rail entry a card with a category and a plan', () => {
    for (const manifest of withRail) {
      expect(manifest.appCard, manifest.id).toBeDefined()
      expect(['sales', 'team']).toContain(manifest.appCard!.category)
      expect(['included', 'addon']).toContain(manifest.appCard!.plan)
    }
  })

  it('keeps the free applications under «الأساسية» and the paid ones under «الإضافية»', () => {
    const planOf = (id: string) => appManifests.find(manifest => manifest.id === id)?.appCard?.plan
    for (const id of ['tasks', 'meetings', 'chat', 'operations', 'documents', 'ai']) expect(planOf(id), id).toBe('included')
    for (const id of ['crm', 'inbox', 'pmo', 'hr', 'finance', 'appointments']) expect(planOf(id), id).toBe('addon')
  })

  it('declares at most two figures per card, with unique query keys and captions in both locales', () => {
    for (const manifest of withRail) expect(manifest.appCard!.figures?.length ?? 0, manifest.id).toBeLessThanOrEqual(2)
    expect(new Set(figures.map(item => JSON.stringify(item.queryKey))).size).toBe(figures.length)
    for (const item of figures) {
      expect(lookup(locale('ar'), item.labelKey), item.labelKey).toEqual(expect.any(String))
      expect(lookup(locale('en'), item.labelKey), item.labelKey).toEqual(expect.any(String))
    }
  })

  it('has figures for tasks, crm, inbox, chat, meetings and projects', () => {
    const withFigures = withRail.filter(manifest => manifest.appCard?.figures?.length).map(manifest => manifest.id).sort()
    expect(withFigures).toEqual(['chat', 'crm', 'inbox', 'meetings', 'pmo', 'tasks'])
  })

  it('reads each figure from its endpoint through the response schema', async () => {
    const responses: Record<string, unknown> = {
      '/api/v1/my-tasks/summary': { total: 9, open: 5, overdue: 2, done: 4 },
      '/api/v1/crm/dashboard': { agent: { due_now: 6, new_today: 3, won_this_month: { count: 1, value: 10 } }, manager: null },
      '/api/v1/inbox/conversations': { items: [], total: 12 },
      '/api/v1/chat/conversations': { items: [], total: 4 },
      '/api/v1/meetings': { items: [], total: 7 },
      '/api/v1/meetings/resolutions': { items: [], total: 8 },
      '/api/v1/reports/projects/summary': { project_count: 6, attention_project_count: 1, overdue_task_count: null, status_counts: [], totals: [], attention: [] },
    }
    const asked: Array<{ url: string; query?: Record<string, unknown> }> = []
    const api = vi.fn(async (url: string, options: { query?: Record<string, unknown>; schema: { parse: (value: unknown) => unknown } }) => {
      asked.push({ url, query: options.query })
      return options.schema.parse(responses[url])
    }) as unknown as AppSearchApi
    const values = await Promise.all(figures.map(async item => [item.labelKey, await item.load(api)] as const))
    expect(Object.fromEntries(values)).toEqual({
      'launcher.figures.tasks.open': 5, 'launcher.figures.tasks.overdue': 2,
      'launcher.figures.crm.due': 6, 'launcher.figures.crm.today': 3,
      'launcher.figures.inbox.open': 12, 'launcher.figures.inbox.unassigned': 12,
      'launcher.figures.chat.unread': 4, 'launcher.figures.chat.channels': 4,
      'launcher.figures.meetings.upcoming': 7, 'launcher.figures.meetings.followup': 8,
      'launcher.figures.projects.count': 6, 'launcher.figures.projects.attention': 1,
    })
    expect(asked.find(call => call.url === '/api/v1/inbox/conversations' && call.query?.assignee === 'unassigned')?.query).toEqual({ state: 'open', assignee: 'unassigned', limit: 1 })
    expect(asked.find(call => call.url === '/api/v1/chat/conversations' && call.query?.filter === 'unread')?.query).toEqual({ filter: 'unread', limit: 1 })
  })
})
