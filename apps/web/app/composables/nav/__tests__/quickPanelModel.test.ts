import { describe, expect, it } from 'vitest'
import type { AppQuickPanel } from '../../../modules/types'
import { orderQuickPanels, toolBadge } from '../quickPanelModel'

const panel = (id: string): AppQuickPanel => ({ id, labelKey: `nav.${id}`, icon: 'i-lucide-box', capability: 'x.y.read', to: `/${id}`, queryKey: [id], count: async () => 0, load: async () => ({ default: {} }) })

describe('quick panel order', () => {
  it('shows conversations, tasks and meetings in that order whatever the manifest order', () => {
    expect(orderQuickPanels([panel('meetings'), panel('tasks'), panel('chat')]).map(item => item.id)).toEqual(['chat', 'tasks', 'meetings'])
  })

  it('keeps a newer application tool after them, in manifest order', () => {
    expect(orderQuickPanels([panel('sales'), panel('chat'), panel('audit')]).map(item => item.id)).toEqual(['chat', 'sales', 'audit'])
  })
})

describe('tool badge', () => {
  it('is empty until the count is known and for zero', () => {
    expect(toolBadge(null)).toBeNull()
    expect(toolBadge(0)).toBeNull()
    expect(toolBadge(7)).toBe(7)
  })
})
