import { describe, expect, it } from 'vitest'
import type { AppCommand } from '../../../modules/types'
import { HOME_QUICK_LIMIT, homeQuickActions } from '../homeQuickActions'

const command = (id: string): AppCommand => ({ id, labelKey: id, icon: 'i-lucide-plus', to: `/${id}/new`, capability: `${id}.x` })
const ids = (commands: AppCommand[]) => commands.map(item => item.id)

describe('homeQuickActions', () => {
  it('keeps every command when there are few', () => {
    expect(ids(homeQuickActions([command('pmo.a'), command('hr.b')]))).toEqual(['pmo.a', 'hr.b'])
  })

  it('gives each application its first command before any gets a second', () => {
    const all = ['pmo.a', 'pmo.b', 'hr.a', 'hr.b', 'finance.a', 'crm.a', 'chat.a'].map(command)
    expect(ids(homeQuickActions(all))).toEqual(['pmo.a', 'hr.a', 'finance.a', 'crm.a', 'chat.a'])
  })

  it('fills the remaining places with second commands in rail order', () => {
    const all = ['pmo.a', 'pmo.b', 'hr.a', 'hr.b', 'hr.c'].map(command)
    expect(ids(homeQuickActions(all, 4))).toEqual(['pmo.a', 'hr.a', 'pmo.b', 'hr.b'])
  })

  it('never exceeds the limit and is empty at zero', () => {
    const all = Array.from({ length: 30 }, (_, index) => command(`app${index}.x`))
    expect(homeQuickActions(all)).toHaveLength(HOME_QUICK_LIMIT)
    expect(homeQuickActions(all, 0)).toEqual([])
  })
})
