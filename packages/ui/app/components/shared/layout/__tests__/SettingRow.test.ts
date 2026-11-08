import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { renderShared } from '../../../../../test/helpers/renderShared'

describe('SharedSettingRow', () => {
  it('puts the name and description on the start side and the control on the end side', async () => {
    const html = await renderShared('SettingRow', { label: 'يحتاج إكمال المهام اعتماد المدير', description: 'لا تُغلق المهمة قبل اعتماده.' }, { default: () => h('button', { 'data-test': 'control' }, 'on') })
    expect(html).toContain('data-slot="setting-row"')
    expect(html).toContain('يحتاج إكمال المهام اعتماد المدير')
    expect(html).toContain('لا تُغلق المهمة قبل اعتماده.')
    expect(html.indexOf('liwan-setting-row-text')).toBeLessThan(html.indexOf('liwan-setting-row-control'))
    expect(html).toContain('data-test="control"')
    expect(html).not.toContain('data-stacked')
  })

  it('names the group by its label', async () => {
    const html = await renderShared('SettingRow', { label: 'التغيير' }, {})
    expect(html).toMatch(/role="group" aria-labelledby="([^"]+)-label"/)
  })

  it('says why a setting is disabled, with a link to the dependency', async () => {
    const html = await renderShared('SettingRow', { label: 'خط الأساس', disabledReason: 'يتطلب تفعيل أداة التخطيط أولًا.', disabledLink: { to: '#tools', label: 'أداة التخطيط' } }, {})
    expect(html).toContain('data-slot="setting-row-reason"')
    expect(html).toContain('يتطلب تفعيل أداة التخطيط أولًا.')
    expect(html).toContain('أداة التخطيط')
  })

  it('stacks full-width options under the text', async () => {
    const html = await renderShared('SettingRow', { label: 'من يعتمد؟', stacked: true }, {})
    expect(html).toContain('data-stacked="true"')
  })
})
