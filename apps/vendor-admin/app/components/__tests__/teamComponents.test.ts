import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import * as contracts from '@liwan/commercial-contracts'
import { renderSfc } from '../../../test/helpers/renderSfc'
import * as team from '../../utils/team'

type Tree = { [key: string]: string | Tree }
const flatten = (tree: Tree, prefix = ''): Record<string, string> => Object.fromEntries(Object.entries(tree).flatMap(([key, value]) =>
  typeof value === 'string' ? [[`${prefix}${key}`, value]] : Object.entries(flatten(value, `${prefix}${key}.`))))
const messages = flatten(JSON.parse(readFileSync(join(fileURLToPath(new URL('../../../i18n/locales/ar', import.meta.url)), 'team.json'), 'utf8')) as Tree)

const options = {
  messages,
  modules: {
    '../../utils/team': team,
    '@liwan/commercial-contracts': contracts,
    '@/composables/useCopyLink': { useCopyLink: () => ({ copy: () => undefined, outcomeFor: () => null }) },
    '@liwan/ui/app/utils/formatDate': { formatDateTime: (value: string) => `at ${value}` },
  },
  components: {
    TeamRolePicker: 'components/team/RolePicker.vue',
    SharedInlineConfirm: '../../../packages/ui/app/components/shared/form/InlineConfirm.vue',
  },
  stubs: {
    SharedUnsavedChanges: defineComponent({ props: { dirty: Boolean }, setup: () => () => null }),
    UAlert: defineComponent({
      inheritAttrs: false,
      props: { title: String, description: String },
      setup(props, { attrs, slots }) {
        return () => h('div', attrs, [h('p', props.title), slots.description?.(), slots.actions?.()])
      },
    }),
  },
}

const account = { id: 7, email: 'w@x.test', display_name: 'وفاء', status: 'active', roles: ['support'], passkeys: 1, last_seen_at: null }

describe('RolePicker', () => {
  it('offers exactly the six roles by their Arabic names and checks the chosen ones', async () => {
    const html = await renderSfc('components/team/RolePicker.vue', { modelValue: ['owner'] }, {}, options)
    expect(html).toContain('<fieldset')
    expect(html.match(/<input[^>]*type="checkbox"/g)).toHaveLength(6)
    for (const name of ['المالك', 'نجاح العملاء', 'المالية', 'المنتج', 'العمليات', 'الدعم']) expect(html).toContain(name)
    expect(html.match(/checked/g)).toHaveLength(1)
  })

  it('shows its error in place of the hint, announced as an alert', async () => {
    const html = await renderSfc('components/team/RolePicker.vue', { modelValue: [], error: 'اختر دورًا' }, {}, options)
    expect(html).toContain('role="alert"')
    expect(html).toContain('اختر دورًا')
  })
})

describe('InvitationLink', () => {
  it('shows the link as left-to-right text with its expiry, a copy button and a dismiss button', async () => {
    const html = await renderSfc('components/team/InvitationLink.vue', { name: 'وفاء', link: 'https://admin.example.test/enroll#tok', expiresAt: '2026-10-17T00:00:00Z' }, {}, options)
    expect(html).toContain('رابط الدعوة لـ وفاء')
    expect(html).toContain('يظهر هذا الرابط مرة واحدة')
    expect(html).toContain('value="https://admin.example.test/enroll#tok"')
    expect(html).toContain('dir="ltr"')
    expect(html).toContain('نسخ الرابط')
    expect(html).toContain('تم، أخفِ الرابط')
    expect(html).toContain('at 2026-10-17T00:00:00Z')
  })
})

describe('AccountAction', () => {
  it('asks to disable inline, with a reason field, and no dialog', async () => {
    const html = await renderSfc('components/team/AccountAction.vue', { kind: 'disable', account }, {}, options)
    expect(html).toContain('data-testid="inline-confirm"')
    expect(html).toContain('تعطيل حساب وفاء؟')
    expect(html).toContain('تعطيل الحساب')
    expect(html).toContain('data-testid="action-reason"')
    expect(html).not.toContain('role="dialog"')
  })

  it('edits roles with the current roles checked and the six choices', async () => {
    const html = await renderSfc('components/team/AccountAction.vue', { kind: 'roles', account }, {}, options)
    expect(html).toContain('أدوار وفاء')
    expect(html.match(/<input[^>]*type="checkbox"/g)).toHaveLength(6)
    expect(html).toContain('حفظ الأدوار')
  })

  it('shows the last-owner refusal in words', async () => {
    const html = await renderSfc('components/team/AccountAction.vue', { kind: 'disable', account, errorKey: 'team.errors.lastOwner' }, {}, options)
    expect(html).toContain('يلزم مالك نشط واحد على الأقل')
    expect(html).toContain('role="alert"')
  })
})

describe('AccountForm', () => {
  it('has email, name, roles and reason fields and no error until an attempt', async () => {
    const html = await renderSfc('components/team/AccountForm.vue', {}, {}, options)
    for (const id of ['invite-email', 'invite-name', 'invite-reason', 'invite-submit']) expect(html).toContain(`data-testid="${id}"`)
    expect(html.match(/<input[^>]*type="checkbox"/g)).toHaveLength(6)
    expect(html).not.toContain('data-testid="team-error"')
  })

  it('shows the duplicate-email refusal', async () => {
    const html = await renderSfc('components/team/AccountForm.vue', { errorKey: 'team.errors.conflict' }, {}, options)
    expect(html).toContain('يوجد حساب بهذا البريد الإلكتروني')
  })
})
