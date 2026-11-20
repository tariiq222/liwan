import { http, HttpResponse } from 'msw'
import { availableNumbers, archivedSenders, messages, providers, senders, settings, stateOf, twilio } from './integrationFixtures'

type Sender = (typeof senders)['items'][number]
type Message = (typeof messages)['items'][number]

export interface CommunicationScenario {
  /** The connections the company holds; the default is one connected Twilio account. */
  connections?: unknown[]
  /** Every sender of the company, active and archived: the handler filters by `channel`, `connection_id` and `active`. */
  senders?: Sender[]
  /** Status and body of the senders list when it must fail. */
  sendersFailure?: { status: number, body: unknown }
  available?: { status: number, body: unknown }
  settings?: { status: number, body: unknown }
  settingsPatch?: { status: number, body: unknown }
  senderPost?: { status: number, body: unknown }
  messages?: Message[]
  messagesFailure?: { status: number, body: unknown }
  testPost?: { status: number, body: unknown }
  testGet?: { status: number, body: unknown }
}

const answer = (reply: { status: number, body: unknown }) => HttpResponse.json(reply.body as Record<string, unknown>, { status: reply.status })
const list = <T>(items: T[]) => ({ items, total: items.length })

/** The MSW handlers of the communications page's endpoints, one scenario per story. Nothing here is runtime code. */
export function communicationHandlers(scenario: CommunicationScenario = {}) {
  const accounts = scenario.connections ?? [twilio]
  const everySender = scenario.senders ?? [...senders.items, ...archivedSenders.items]
  return {
    msw: { handlers: { integrations: [
      http.get('/api/v1/integrations/connections', () => HttpResponse.json(list(accounts))),
      http.get('/api/v1/integrations/providers', () => HttpResponse.json(providers)),
      http.get('/api/v1/integrations/senders/available', () => answer(scenario.available ?? { status: 200, body: availableNumbers })),
      http.get('/api/v1/integrations/senders', ({ request }) => {
        if (scenario.sendersFailure) return answer(scenario.sendersFailure)
        const params = new URL(request.url).searchParams
        const wantActive = params.get('active') !== 'false'
        const channel = params.get('channel')
        return HttpResponse.json(list(everySender.filter(sender => sender.active === wantActive && (!channel || sender.channel === channel))))
      }),
      http.post('/api/v1/integrations/senders', () => answer(scenario.senderPost ?? { status: 201, body: senders.items[0] })),
      http.patch('/api/v1/integrations/senders/:id', () => HttpResponse.json(senders.items[0])),
      http.delete('/api/v1/integrations/senders/:id', () => new HttpResponse(null, { status: 204 })),
      http.get('/api/v1/integrations/communication-settings', () => answer(scenario.settings ?? { status: 200, body: settings })),
      http.patch('/api/v1/integrations/communication-settings', () => answer(scenario.settingsPatch ?? { status: 200, body: { daily_message_limit: 2000 } })),
      http.post('/api/v1/integrations/messaging/test', () => answer(scenario.testPost ?? { status: 201, body: stateOf(messages.items[7]!) })),
      http.get('/api/v1/integrations/messaging/test/:id', () => answer(scenario.testGet ?? { status: 200, body: stateOf(messages.items[7]!) })),
      http.get('/api/v1/integrations/messaging/messages', () => (scenario.messagesFailure ? answer(scenario.messagesFailure) : HttpResponse.json(list(scenario.messages ?? messages.items)))),
      http.post('/api/v1/integrations/messaging/messages/:id/retry', () => HttpResponse.json(stateOf(messages.items[7]!), { status: 201 })),
    ] } },
  }
}
