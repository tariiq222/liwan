import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'
import { guideSteps } from '../../../utils/integrationGuide'

const component = resolve(__dirname, '../IntegrationProviderGuide.vue')
const root = resolve(__dirname, '../../../..')
const strings = JSON.parse(readFileSync(resolve(root, 'i18n/locales/en/integrations.json'), 'utf8')).integrations.guide as Record<string, unknown>
const flatten = (value: Record<string, unknown>, prefix: string): Record<string, string> => Object.fromEntries(Object.entries(value).flatMap(([key, item]) =>
  typeof item === 'object' ? Object.entries(flatten(item as Record<string, unknown>, `${prefix}${key}.`)) : [[`${prefix}${key}`, String(item)]]))
const messages = flatten(strings, 'integrations.guide.')
const box = Vue.defineComponent({ inheritAttrs: false, props: ['title'], setup: (_, { attrs, slots }) => () => Vue.h('section', attrs, slots.default?.()) })
const Badge = Vue.defineComponent({ props: ['label'], setup: p => () => Vue.h('b', p.label) })
const secrets = (all: string[], names: string[]) => all.map(name => ({ name, present: names.includes(name) }))
const meta = (state: string, present: string[]) => ({ state, secrets: secrets(['access_token', 'app_secret', 'verify_token'], present) })
const twilio = (state: string, present: string[]) => ({ state, secrets: secrets(['auth_token'], present) })
const render = (props: Record<string, unknown>) => renderShared(component, props, {}, {
  hydrated: true, messages, stubs: { SharedRecordSection: box, SharedStatusBadge: Badge }, globals: { computed: Vue.computed }, modules: { '@/utils/integrationGuide': { guideSteps } },
})

describe('IntegrationProviderGuide for Meta', () => {
  it('teaches the five steps without states before the account is saved', async () => {
    const html = await render({ code: 'meta' })
    for (const key of ['app', 'token', 'values', 'webhook', 'fields']) expect(html).toContain(`integration-guide-step-${key}`)
    expect(html).not.toContain('integration-guide-state-')
    expect(html).toContain('whatsapp_business_messaging')
    expect(html).toContain('whatsapp_business_management')
    expect(html).toContain('message_template_status_update')
    expect(html).toContain(messages['integrations.guide.meta.steps.webhook.before']!)
  })

  it('maps a connected account to done and leaves the Meta-side steps unchecked', async () => {
    const html = await render({ code: 'meta', connection: meta('connected', ['access_token', 'app_secret', 'verify_token']) })
    expect(html).toContain(messages['integrations.guide.meta.result.tokenDone']!)
    expect(html).toContain(messages['integrations.guide.meta.result.valuesDone']!)
    expect(html).toContain(messages['integrations.guide.meta.result.webhookDone']!)
    expect(html.match(new RegExp(messages['integrations.guide.state.unchecked']!, 'g'))).toHaveLength(2)
  })

  it('shows a problem when the provider refused and a to-do for missing keys', async () => {
    expect(await render({ code: 'meta', connection: meta('error', ['access_token', 'app_secret']) })).toContain(messages['integrations.guide.meta.result.tokenProblem']!)
    const html = await render({ code: 'meta', connection: meta('pending', ['access_token']) })
    expect(html).toContain(messages['integrations.guide.meta.result.valuesTodo']!)
    expect(html).toContain(messages['integrations.guide.meta.result.webhookTodo']!)
  })
})

describe('IntegrationProviderGuide for Twilio', () => {
  it('teaches the six facts without states before the account is saved', async () => {
    const html = await render({ code: 'twilio' })
    for (const key of ['credentials', 'apiKeys', 'trial', 'region', 'saudiSender', 'charges']) {
      expect(html).toContain(`integration-guide-step-${key}`)
      expect(html).toContain(messages[`integrations.guide.twilio.steps.${key}.title`]!)
    }
    expect(html).not.toContain('integration-guide-state-')
  })

  it('maps the stored connection to the credentials step only', async () => {
    const done = await render({ code: 'twilio', connection: twilio('connected', ['auth_token']) })
    expect(done).toContain(messages['integrations.guide.twilio.result.credentialsDone']!)
    expect(done.match(/integration-guide-state-/g)).toHaveLength(1)
    expect(await render({ code: 'twilio', connection: twilio('error', ['auth_token']) })).toContain(messages['integrations.guide.twilio.result.credentialsProblem']!)
    expect(await render({ code: 'twilio', connection: twilio('pending', []) })).toContain(messages['integrations.guide.twilio.result.credentialsTodo']!)
  })
})
