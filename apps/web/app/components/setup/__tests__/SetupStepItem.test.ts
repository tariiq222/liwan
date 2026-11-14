import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { DEFAULT_STUBS, renderShared } from '@liwan/ui/test/helpers/renderShared'
import type { SetupTargetAccess } from '../../../composables/setup/setupSteps'

const file = resolve(import.meta.dirname, '../SetupStepItem.vue')
const UButton = Vue.defineComponent({ inheritAttrs: false, props: { to: { type: String, default: '' }, label: { type: String, default: '' } }, setup: (props, { attrs }) => () => Vue.h(props.to ? 'a' : 'button', { ...attrs, href: props.to || undefined }, props.label) })
const SharedStatusBadge = Vue.defineComponent({ props: { label: { type: String, default: '' } }, setup: props => () => Vue.h('b', props.label) })
const messages = {
  'setup.steps.team.title': 'الفريق', 'setup.steps.team.purpose': 'أضف زملاءك', 'setup.steps.team.action': 'افتح المستخدمين',
  'setup.state.todo': 'للإنجاز', 'setup.state.done': 'منجزة', 'setup.state.skipped': 'متخطّاة',
  'setup.actions.done': 'تمت', 'setup.actions.skip': 'تخطَّ', 'setup.actions.reopen': 'أعدها للإنجاز',
  'setup.notes.feature': 'غير مضمَّن في باقتك', 'setup.notes.none': 'لا توجد صفحة', 'setup.notes.permission': 'لا صلاحية', 'setup.notes.permissionHolder': 'يكملها {holder}', 'setup.steps.team.holder': 'مدير الفريق',
}

const render = (props: { outcome: 'done' | 'skipped' | null; access: SetupTargetAccess }) => renderShared(file, { stepKey: 'team', busy: false, ...props }, {}, {
  messages, stubs: { ...DEFAULT_STUBS, UButton, SharedStatusBadge },
  globals: { useHydrated: () => Vue.ref(true) },
})

describe('SetupStepItem', () => {
  it('shows the purpose, the state, the link to the owning page, and done and skip while open', async () => {
    const html = await render({ outcome: null, access: { kind: 'open', to: '/settings/team/users' } })
    expect(html).toContain('أضف زملاءك')
    expect(html).toContain('للإنجاز')
    expect(html).toMatch(/href="\/settings\/team\/users"/)
    for (const id of ['setup-step-done', 'setup-step-skip']) expect(html).toContain(id)
    expect(html).not.toContain('setup-step-reopen')
  })

  it('offers only a way back once the step has an outcome', async () => {
    const html = await render({ outcome: 'skipped', access: { kind: 'open', to: '/x' } })
    expect(html).toContain('متخطّاة')
    expect(html).toContain('setup-step-reopen')
    expect(html).not.toContain('setup-step-done')
  })

  it('says why there is no link instead of drawing a dead one', async () => {
    const feature = await render({ outcome: null, access: { kind: 'feature' } })
    expect(feature).toContain('غير مضمَّن في باقتك')
    expect(feature).not.toContain('setup-step-open')
    expect(feature).toContain('setup-step-skip')
    expect(await render({ outcome: null, access: { kind: 'none' } })).toContain('لا توجد صفحة')
  })

  it('names who can complete a step the viewer lacks the permission for, and keeps it skippable', async () => {
    const html = await render({ outcome: null, access: { kind: 'permission' } })
    expect(html).toContain('يكملها مدير الفريق')
    expect(html).not.toContain('setup-step-open')
    expect(html).toContain('setup-step-skip')
  })
})
