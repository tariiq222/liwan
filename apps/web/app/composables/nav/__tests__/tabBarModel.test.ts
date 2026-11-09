import { describe, expect, it } from 'vitest'
import { tabBarItems } from '../tabBarModel'

const entry = (id: string, icon = 'i-lucide-box') => ({ id, labelKey: `nav.${id}`, icon, to: id === 'home' ? '/' : `/${id}` })
const rail = ['home', 'ai', 'meetings', 'tasks', 'chat', 'crm', 'settings'].map(id => entry(id))
const build = (activeModule: string | null, extra: Partial<Parameters<typeof tabBarItems>[0]> = {}) =>
  tabBarItems({ rail, activeModule, moreOpen: false, translate: key => key, moreLabel: 'more', ...extra })

describe('phone tab bar', () => {
  it('lists today, tasks, conversations, the assistant, then «المزيد»', () => {
    expect(build('home').map(item => item.id)).toEqual(['home', 'tasks', 'chat', 'ai', 'more'])
    expect(build('home').at(-1)).toMatchObject({ label: 'more', testId: 'mobile-navigation-trigger' })
    expect(build('home').at(-1)?.to).toBeUndefined()
  })

  it('shows a tab only when the user can reach its destination', () => {
    const without = rail.filter(item => item.id !== 'chat' && item.id !== 'ai')
    expect(build('home', { rail: without }).map(item => item.id)).toEqual(['home', 'tasks', 'more'])
    expect(build('home', { rail: [] }).map(item => item.id)).toEqual(['more'])
  })

  it('lights the tab of the open page', () => {
    expect(build('tasks').filter(item => item.active).map(item => item.id)).toEqual(['tasks'])
    expect(build('ai').filter(item => item.active).map(item => item.id)).toEqual(['ai'])
    expect(build('home').filter(item => item.active).map(item => item.id)).toEqual(['home'])
  })

  it('lights «المزيد» on another application or on settings, and while the drawer is open', () => {
    expect(build('crm').filter(item => item.active).map(item => item.id)).toEqual(['more'])
    expect(build('settings').filter(item => item.active).map(item => item.id)).toEqual(['more'])
    expect(build('tasks', { moreOpen: true }).filter(item => item.active).map(item => item.id)).toEqual(['more'])
  })

  it('lights nothing on a page no application owns', () => {
    expect(build(null).filter(item => item.active)).toEqual([])
  })
})
