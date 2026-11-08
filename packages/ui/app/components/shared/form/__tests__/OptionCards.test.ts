import { describe, expect, it } from 'vitest'
import { renderShared } from '../../../../../test/helpers/renderShared'

const options = [
  { value: 'none', label: 'بلا اعتماد', description: 'تُغلق المشاريع مباشرة.' },
  { value: 'project_manager', label: 'اعتماد مدير المشروع', description: 'يعتمد المدير قبل الإغلاق.' },
  { value: 'board', label: 'اعتماد اللجنة', description: 'غير متاح.', disabled: true, disabledReason: 'يتطلب تفعيل الحوكمة أولًا.' },
]

describe('SharedOptionCards', () => {
  it('is a native radio group named by its label, one card per option with its title and description', async () => {
    const html = await renderShared('OptionCards', { modelValue: 'none', options, label: 'اعتماد الإغلاق' }, {}, { hydrated: true })
    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('aria-label="اعتماد الإغلاق"')
    expect(html.match(/type="radio"/g)).toHaveLength(3)
    for (const option of options) expect(html).toContain(option.label)
    expect(html).toContain('تُغلق المشاريع مباشرة.')
  })

  it('marks only the chosen card selected and checks only its radio', async () => {
    const html = await renderShared('OptionCards', { modelValue: 'project_manager', options, label: 'x' }, {}, { hydrated: true })
    expect(html.match(/data-selected="true"/g)).toHaveLength(1)
    expect(html.match(/checked/g)).toHaveLength(1)
  })

  it('disables a card with its own reason, and every card before hydration', async () => {
    const html = await renderShared('OptionCards', { modelValue: 'none', options, label: 'x' }, {}, { hydrated: true })
    expect(html).toContain('يتطلب تفعيل الحوكمة أولًا.')
    expect(html.match(/disabled/g)?.length).toBeGreaterThanOrEqual(1)
    const before = await renderShared('OptionCards', { modelValue: 'none', options, label: 'x' }, {}, { hydrated: false })
    expect(before.match(/data-disabled="true"/g)).toHaveLength(3)
  })
})
