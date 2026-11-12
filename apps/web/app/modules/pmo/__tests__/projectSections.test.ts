import { describe, it, expect } from 'vitest'
import { PROJECT_SECTION_IDS, planningSections, projectSections } from '../projectSections'

const reader = { role: 'employee', capabilities: ['pmo.projects.read', 'pmo.tasks.read', 'meetings.read'] }
const projectOnly = { role: 'employee', capabilities: ['pmo.projects.read'] }
const enabled = { policy: 'enabled', enabled: true, can_toggle: false } as const
const opts = { active: true, tools: { planning: enabled, governance: enabled, finance: enabled } }
const ids = (...args: Parameters<typeof projectSections>) => projectSections(...args).map(s => s.id)
describe('projectSections', () => {
  it('has five tabs: summary, tasks, meetings, finance, governance', () => {
    expect(PROJECT_SECTION_IDS).toEqual(['summary', 'tasks', 'meetings', 'finance', 'governance'])
    expect(ids(7, reader, opts)).toEqual(['summary', 'tasks', 'meetings', 'finance', 'governance'])
  })
  it('has no updates and no planning tab: they are the summary and a view of the tasks', () => expect(ids(7, reader, opts)).not.toContain('updates' as never))
  it('shows only the basics when all tools are disabled', () => expect(ids(7, reader, { active: true, tools: { planning: { ...enabled, enabled: false }, governance: { ...enabled, enabled: false }, finance: { ...enabled, enabled: false } } })).toEqual(['summary', 'tasks', 'meetings']))
  it('does not infer a grant from a company policy', () => expect(ids(7, projectOnly, opts)).toEqual(['summary', 'finance', 'governance']))
  it('shows meetings only with meetings.read', () => expect(ids(7, { role: 'employee', capabilities: ['pmo.projects.read', 'pmo.tasks.read'] }, opts)).not.toContain('meetings'))
  it('hides the tasks and governance tabs of an archived project', () => expect(ids(7, reader, { ...opts, active: false })).toEqual(['summary', 'meetings', 'finance']))
  it('hides the finance tab only when the project says the caller cannot read finance', () => {
    expect(ids(7, reader, { ...opts, canReadFinance: false })).toEqual(['summary', 'tasks', 'meetings', 'governance'])
    expect(ids(7, reader, { ...opts, canReadFinance: true })).toContain('finance')
    expect(ids(7, reader, opts)).toContain('finance')
  })
  it('returns nothing before capabilities arrive', () => expect(projectSections(7, undefined, opts)).toEqual([]))
})

describe('planningSections', () => {
  it('links back to the task timeline view, then the baselines and the milestones', () => {
    const sections = planningSections(7, { active: true, baselines: true })
    expect(sections.map(s => s.id)).toEqual(['timeline', 'baselines', 'milestones'])
    expect(sections[0]).toMatchObject({ to: '/projects/7/tasks', query: { view: 'timeline' } })
  })
})
