import { describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import BranchRoleAssignments from '../BranchRoleAssignments.vue'

const locale = ref('ar')
vi.stubGlobal('useI18n', () => ({ locale, t: (key: string) => key }))
const branches = [{ id: 2, name: 'الرياض', inherit: false, role_ids: [7] }]
const roles = [{ id: 7, key: 'finance_reader', name: { ar: 'قارئ المالية', en: 'Finance reader' } }]
async function render(inherited: boolean, disabled = false, roleOptions: Array<{ id: number; key: string; name: { ar: string; en: string | null }; company_id?: number | null }> = roles) {
  const app = createSSRApp({ render: () => h(BranchRoleAssignments, { modelValue: branches, roles: roleOptions, inherited, disabled }) })
  app.component('SharedFormSection', defineComponent({ setup: (_, { slots }) => () => h('section', slots.default?.()) }))
  app.component('SharedEmptyState', defineComponent({ setup: () => () => h('p') }))
  app.component('UCheckbox', defineComponent({ props: ['modelValue', 'label', 'disabled'], setup: props => () => h('input', { type: 'checkbox', 'aria-label': props.label, checked: props.modelValue, disabled: props.disabled }) }))
  return renderToString(app)
}

describe('branch role assignments', () => {
  it('shows global and own-branch roles without exposing another branch role', async () => {
    const html = await render(false, false, [...roles,
      { id: 8, key: 'other_branch', name: { ar: 'Other branch role', en: 'Other branch role' }, company_id: 3 },
      { id: 9, key: 'own_branch', name: { ar: 'Own branch role', en: 'Own branch role' }, company_id: 2 },
    ])
    expect(html).toContain('Own branch role')
    expect(html).not.toContain('Other branch role')
  })
  it('disables inherited role editing on a branch that opted out while retaining its saved configuration', async () => {
    const html = await render(true)
    expect(html).toContain('<fieldset disabled')
    expect(html).toContain('aria-label="قارئ المالية" checked')
    expect(html).toContain('access.branches.inherit')
    expect(branches[0]?.role_ids).toEqual([7])
  })
  it('allows explicit delegation independently of the inheritance switch', async () => {
    const html = await render(false)
    expect(html).not.toContain('<fieldset disabled')
    expect(html).not.toContain('access.branches.inherit')
  })
  it('disables every control while the caller is loading and respects English labels', async () => {
    locale.value = 'en'
    const html = await render(true, true)
    expect(html).toContain('aria-label="Finance reader" checked disabled')
    expect(html).toContain('<fieldset disabled')
    locale.value = 'ar'
  })
})
