import { describe, it, expect } from 'vitest'
import { PROJECT_SECTION_IDS, projectSections } from '../projectSections'

const reader = { role: 'employee', capabilities: ['pmo.projects.read', 'pmo.tasks.read', 'meetings.read'] }
const projectOnly = { role: 'employee', capabilities: ['pmo.projects.read'] }
const enabled = {policy:'enabled',enabled:true,can_toggle:false} as const
const opts = {active:true,tools:{planning:enabled,governance:enabled,finance:enabled}}
describe('projectSections', () => {
 it('starts with summary tasks and updates, then active tools', () => expect(projectSections(7,reader,opts).map(s=>s.id)).toEqual(['summary','tasks','updates','planning','governance','finance']))
 it('shows only basics when all tools are disabled', () => expect(projectSections(7,reader,{active:true,tools:{planning:{...enabled,enabled:false},governance:{...enabled,enabled:false},finance:{...enabled,enabled:false}}}).map(s=>s.id)).toEqual(['summary','tasks','updates']))
 it('does not infer a grant from a company policy', () => expect(projectSections(7,projectOnly,opts).map(s=>s.id)).not.toContain('tasks'))
 it('keeps meetings out of primary navigation', () => expect(PROJECT_SECTION_IDS).not.toContain('meetings'))
 it('returns nothing before capabilities arrive',()=>expect(projectSections(7,undefined,opts)).toEqual([]))
})
