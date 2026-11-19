import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'

const component = resolve(__dirname, '../IntegrationMetaGuide.vue')
const root = resolve(__dirname, '../../../..')
const strings = JSON.parse(readFileSync(resolve(root, 'i18n/locales/en/integrations.json'), 'utf8')).integrations.guide as Record<string, unknown>
const flatten = (value: Record<string, unknown>, prefix: string): Record<string, string> => Object.fromEntries(Object.entries(value).flatMap(([key, item]) =>
  typeof item === 'object' ? Object.entries(flatten(item as Record<string, unknown>, `${prefix}${key}.`)) : [[`${prefix}${key}`, String(item)]]))
const messages = flatten(strings, 'integrations.guide.')
const box = Vue.defineComponent({ inheritAttrs: false, props: ['title'], setup: (_, { attrs, slots }) => () => Vue.h('section', attrs, slots.default?.()) })
const Badge = Vue.defineComponent({ props: ['label'], setup: p => () => Vue.h('b', p.label) })
const secrets = (names: string[]) => ['access_token', 'app_secret', 'verify_token'].map(name => ({ name, present: names.includes(name) }))
const connection = (state: string, present: string[]) => ({ state, secrets: secrets(present) })
const render = (props: Record<string, unknown> = {}) => renderShared(component, props, {}, {
  hydrated: true, messages, stubs: { SharedRecordSection: box, SharedStatusBadge: Badge }, globals: { computed: Vue.computed },
})

describe('IntegrationMetaGuide', () => {
  it('teaches the five steps without states before the account is saved', async () => {
    const html = await render()
    for (const key of ['app', 'token', 'values', 'webhook', 'fields']) expect(html).toContain(`integration-guide-step-${key}`)
    expect(html).not.toContain('integration-guide-state-')
    expect(html).toContain('whatsapp_business_messaging')
    expect(html).toContain('whatsapp_business_management')
    expect(html).toContain('message_template_status_update')
    expect(html).toContain(messages['integrations.guide.steps.webhook.before']!)
  })

  it('maps a connected account to done and leaves the Meta-side steps unchecked', async () => {
    const html = await render({ connection: connection('connected', ['access_token', 'app_secret', 'verify_token']) })
    expect(html).toContain(messages['integrations.guide.result.tokenDone']!)
    expect(html).toContain(messages['integrations.guide.result.valuesDone']!)
    expect(html).toContain(messages['integrations.guide.result.webhookDone']!)
    expect(html.match(new RegExp(messages['integrations.guide.state.unchecked']!, 'g'))).toHaveLength(2)
  })

  it('shows a problem when the provider refused and a to-do for missing keys', async () => {
    expect(await render({ connection: connection('error', ['access_token', 'app_secret']) })).toContain(messages['integrations.guide.result.tokenProblem']!)
    const html = await render({ connection: connection('pending', ['access_token']) })
    expect(html).toContain(messages['integrations.guide.result.valuesTodo']!)
    expect(html).toContain(messages['integrations.guide.result.webhookTodo']!)
  })
})
