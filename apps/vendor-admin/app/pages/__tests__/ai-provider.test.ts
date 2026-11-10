import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(resolve(import.meta.dirname, '../ai-provider.vue'), 'utf8')

describe('AI provider page', () => {
  it('presents the models as the shared data table', () => {
    expect(page).toContain('<SharedDataTable v-if="draft.models.length"')
  })

  it('is gated on the AI capability and protects unsaved changes', () => {
    expect(page).toContain("capability: 'vendor.ai.manage'")
    expect(page).toContain('<SharedUnsavedChanges :dirty="dirty" />')
  })

  it('lists and tests only models of a saved provider and a saved model, and says why when it cannot', () => {
    expect(page).toContain(':disabled="disabled || !modelSaved(setting, model) || !providerReady(model.provider)"')
    expect(page).toContain('data-testid="ai-provider-save-first"')
    expect(page).toContain('data-testid="ai-model-save-first"')
  })

  it('marks a model that cannot serve charged runs and warns when quick is unmapped', () => {
    expect(page).toContain('data-testid="ai-model-unusable"')
    expect(page).toContain('v-if="quickUnmapped(draft.routes)"')
  })

  it('offers only usable models to a route and shows the effective model of an inheriting cell', () => {
    expect(page).toContain('const usableIds = computed(() => draft.models.filter(m => modelUsable(setting.value, m)).map(m => m.id))')
    expect(page).toContain("t('aiProvider.routes.inheritsFrom', { model: inheritedName(quality, capability) })")
  })

  it('cannot remove a provider a model uses, and never keeps a key after a save', () => {
    expect(page).toContain('modelsOfProvider(draft, provider.id).length > 0')
    expect(page).toMatch(/data\.value = \{ presets: presets\.value, setting: saved\.setting \}\s+restore\(\)/)
  })

  it('shows each server validation error next to its section and saves through one confirmed PATCH', () => {
    for (const section of ['providers', 'models', 'routes']) expect(page).toContain(`failure('${section}')`)
    expect(page).toContain('api.save(savePayload(draft, presets.value, reason.value))')
    expect(page).toContain('<SharedInlineConfirm')
  })
})
