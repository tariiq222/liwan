import { MeSchema } from '@liwan/contracts'
import { http, HttpResponse } from 'msw'
import { defineComponent, h } from 'vue'
import { appManifests } from '../../app/modules/manifests'
import type { AppAssistantSurface, AppManifest } from '../../app/modules/types'
import { shellHandlers } from '../handlers/shell'
import { shellMe } from '../fixtures/shell'

// The shell hosts whatever the assistant application declares; these stories declare a stub body instead, so the
// frame (button, header row, close, full-page link, layout) can be seen without the assistant's own component.
const StubBody = defineComponent({
  render: () => h('p', { style: 'margin: 0; padding: 16px; color: var(--ui-text-muted); font-size: .875rem' }, 'محتوى المساعد يظهر هنا.'),
})

export const stubSurface: AppAssistantSurface = { capability: 'ai.use', labelKey: 'nav.rail.ai', to: '/ai', load: async () => ({ default: StubBody }) }

const stubManifest: AppManifest = { id: 'assistant-stub', feature: 'ai.enabled', routePrefixes: [], rail: [], nav: [], assistant: stubSurface }

// The discovered manifests are a plain array at runtime; the cast lets a story put the stub first for its own lifetime.
const declared = appManifests as AppManifest[]

/** A story `beforeEach`: declares the stub surface first in line for the story's lifetime and returns the cleanup. */
export function declareStubAssistant() {
  declared.unshift(stubManifest)
  return () => { declared.splice(declared.indexOf(stubManifest), 1) }
}

const platform = shellMe.platform!
const assistantMe = MeSchema.parse({
  ...shellMe,
  capabilities: [...shellMe.capabilities, 'ai.use'],
  platform: { ...platform, readable_features: [...platform.readable_features, 'ai.enabled'], writable_features: [...platform.writable_features, 'ai.enabled'] },
})

/** The shell's requests with an identity that may use the assistant. First match wins. */
export const assistantShellHandlers = [http.get('/api/v1/me', () => HttpResponse.json(assistantMe)), ...shellHandlers]
