import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'
import * as integrationVoice from '../../../utils/integrationVoice'

const component = resolve(__dirname, '../CommunicationCallStatus.vue')
const root = resolve(__dirname, '../../../..')
const strings = JSON.parse(readFileSync(resolve(root, 'i18n/locales/en/integrations.json'), 'utf8')).integrations.communications as Record<string, unknown>
const flatten = (value: Record<string, unknown>, prefix: string): Record<string, string> => Object.fromEntries(Object.entries(value).flatMap(([key, item]) =>
  typeof item === 'object' ? Object.entries(flatten(item as Record<string, unknown>, `${prefix}${key}.`)) : [[`${prefix}${key}`, String(item)]]))
const messages = flatten(strings, 'integrations.communications.')
const Badge = Vue.defineComponent({ props: ['label'], setup: p => () => Vue.h('b', { 'data-testid': 'communication-call-badge' }, p.label) })
const box = Vue.defineComponent({ inheritAttrs: false, props: ['title'], setup: (p, { attrs }) => () => Vue.h('section', attrs, p.title) })
const render = (props: Record<string, unknown>) => renderShared(component, props, {}, { hydrated: true, messages, stubs: { SharedStatusBadge: Badge, UAlert: box }, modules: { '@/utils/integrationVoice': integrationVoice } })

describe('CommunicationCallStatus', () => {
  it('names the state and says what it means', async () => {
    const html = await render({ call: { state: 'completed', error_code: null, error_message: null } })
    expect(html).toContain(messages['integrations.communications.call.stage.completed']!)
    expect(html).toContain(messages['integrations.communications.call.hint.completed']!)
    expect(html).not.toContain('unconfirmedWarning')
  })

  it('warns on an unconfirmed call not to place it again and to check Twilio first', async () => {
    const html = await render({ call: { state: 'unconfirmed', error_code: null, error_message: null } })
    expect(html).toContain(messages['integrations.communications.call.stage.unconfirmed']!)
    expect(html).toContain(messages['integrations.communications.call.unconfirmedWarning']!.replace("'", '&#39;'))
    expect(html).toContain('communication-call-unconfirmed-warning')
  })

  it('shows the provider error code and message when there is one', async () => {
    const html = await render({ call: { state: 'failed', error_code: '21215', error_message: 'The number cannot take calls.' } })
    expect(html).toContain('21215')
    expect(html).toContain('The number cannot take calls.')
  })
})
