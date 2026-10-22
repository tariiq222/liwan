import { appManifests } from '../../app/modules/manifests'
import type { AppAttentionProvider, AppManifest } from '../../app/modules/types'

// What an application tells the assistant surfaces, as fixed rows, so the surfaces can be seen without the applications' endpoints.
const provider: AppAttentionProvider = {
  id: 'story-attention',
  module: 'tasks',
  capability: 'ai.use',
  queryKey: ['attention', 'story'],
  load: async () => [
    { id: 't1', label: 'تقرير الربع الثالث', to: '/tasks/1', caption: 'متأخرة يومين', tone: 'urgent', suggestion: 'ابدأ بالمهمة المتأخرة قبل غيرها.' },
    { id: 't2', label: 'مراجعة العقد', to: '/tasks/2', caption: 'تستحق اليوم', tone: 'normal' },
  ],
}

const manifest: AppManifest = { id: 'story-attention', feature: 'ai.enabled', routePrefixes: [], rail: [], nav: [], attention: [provider] }

// The discovered manifests are a plain array at runtime; a story adds this one for its own lifetime and gets the cleanup back.
const declared = appManifests as AppManifest[]

/** A story `beforeEach`: declares the fixed attention rows and returns the cleanup. */
export function declareStoryAttention() {
  declared.push(manifest)
  return () => { declared.splice(declared.indexOf(manifest), 1) }
}
