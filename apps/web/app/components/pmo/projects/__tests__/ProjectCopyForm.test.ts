import { localIsoDay } from '@webvue/ui/app/utils/formatDate'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { ProjectCopyInputSchema } from '@webvue/contracts'

const filename = resolve(import.meta.dirname, '../ProjectCopyForm.vue')
const arMessages = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../../i18n/locales/ar/projects.json'), 'utf8'))
const enMessages = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../../i18n/locales/en/projects.json'), 'utf8'))

class ApiError extends Error {
  constructor(public status: number, public code = 'http_error', message = `HTTP ${status}`) { super(message) }
}

const messages: Record<string, any> = { ar: arMessages, en: enMessages }
function translator(locale: string) {
  return (key: string, params: Record<string, string> = {}) => {
    const value = key.split('.').reduce((node: any, part) => node?.[part], messages[locale])
    if (typeof value !== 'string') return key
    return value.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? '')
  }
}

function load({ locale = 'ar', source = { id: 12, name: 'Alpha' } as { id: number; name: string } | undefined, hydrated = true } = {}) {
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = compileScript(descriptor, { id: 'project-copy-form' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace('export default', 'return')
  const code = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  const mutate = vi.fn(async (_input: any) => ({ id: 31 }))
  const mutationError = Vue.ref<unknown>(null)
  const pending = Vue.ref(false)
  const sourceRef = Vue.ref(source)
  const bindings = {
    _defineComponent: Vue.defineComponent, computed: Vue.computed, ref: Vue.ref, watch: Vue.watch, nextTick: Vue.nextTick,
    useI18n: () => ({ t: translator(locale) }), useHydrated: () => Vue.ref(hydrated), localIsoDay,
    useProject: () => ({ data: sourceRef, isLoading: Vue.ref(false), error: Vue.ref(null), refetch: vi.fn() }),
    useCopyProject: () => ({ mutateAsync: mutate, isPending: pending, error: mutationError }),
    ProjectCopyInputSchema, ApiError,
  }
  const component = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  const emit = vi.fn()
  const scope = Vue.effectScope()
  const state = scope.run(() => component.setup({ sourceId: 12 }, { emit, expose: () => {} }))
  return { state, mutate, mutationError, emit, sourceRef, stop: () => scope.stop() }
}

describe('ProjectCopyForm', () => {
  it.each(['ar', 'en'])('prefills "name (copy)" and today as the start date (%s)', (locale) => {
    const view = load({ locale })
    expect(view.state.name.value).toBe(locale === 'ar' ? 'Alpha (نسخة)' : 'Alpha (copy)')
    expect(view.state.startDate.value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(view.state.dirty.value).toBe(false)
    view.stop()
  })

  it('waits for hydration before seeding so server markup never depends on the local date', () => {
    const view = load({ hydrated: false })
    expect(view.state.startDate.value).toBeNull()
    expect(view.state.name.value).toBe('')
    view.stop()
  })

  it('does not submit an empty name or an invalid date and shows field errors', async () => {
    const view = load()
    view.state.name.value = '   '
    view.state.startDate.value = null
    await view.state.submit()
    expect(view.mutate).not.toHaveBeenCalled()
    expect(view.state.fieldErrors.value.name).toBe(arMessages.projects.copy.validation.name)
    expect(view.state.fieldErrors.value.start_date).toBe(arMessages.projects.copy.validation.startDate)
    view.state.name.value = 'x'.repeat(256)
    view.state.startDate.value = '2030-02-31'
    await view.state.submit()
    expect(view.mutate).not.toHaveBeenCalled()
    view.stop()
  })

  it('copies with the trimmed name and chosen date, then emits the new project id', async () => {
    const view = load()
    view.state.name.value = '  Beta  '
    view.state.startDate.value = '2030-05-01'
    expect(view.state.dirty.value).toBe(true)
    await view.state.submit()
    expect(view.mutate).toHaveBeenCalledWith({ id: 12, body: { name: 'Beta', start_date: '2030-05-01' } })
    expect(view.emit).toHaveBeenCalledWith('created', 31)
    expect(view.state.dirty.value).toBe(false)
    view.stop()
  })

  it('keeps the inputs and the draft guard when the copy fails', async () => {
    const view = load()
    view.state.name.value = 'Beta'
    view.mutate.mockRejectedValueOnce(new ApiError(500))
    await view.state.submit()
    expect(view.emit).not.toHaveBeenCalled()
    expect(view.state.dirty.value).toBe(true)
    expect(view.state.name.value).toBe('Beta')
    view.stop()
  })

  it('maps API failures to specific inline messages', () => {
    const view = load()
    view.mutationError.value = new ApiError(403)
    expect(view.state.submitError.value).toBe(arMessages.projects.copy.forbidden)
    view.mutationError.value = new ApiError(403, 'feature_not_included', 'Plan limit reached')
    expect(view.state.submitError.value).toBe('Plan limit reached')
    view.mutationError.value = new ApiError(403, 'forbidden', 'No access')
    expect(view.state.submitError.value).toBe(arMessages.projects.copy.forbidden)
    view.mutationError.value = new ApiError(422, 'invalid', 'Too many tasks to copy')
    expect(view.state.submitError.value).toBe('Too many tasks to copy')
    view.mutationError.value = new ApiError(422, 'invalid', '')
    expect(view.state.submitError.value).toBe(arMessages.projects.copy.invalid)
    view.mutationError.value = new Error('offline')
    expect(view.state.submitError.value).toBe(arMessages.projects.copy.error)
    view.mutationError.value = null
    expect(view.state.submitError.value).toBeNull()
    view.stop()
  })

  it('ships Arabic and English copy strings for every key the form uses', () => {
    for (const copy of [arMessages.projects.copy, enMessages.projects.copy]) {
      for (const key of ['action', 'title', 'description', 'hint', 'source', 'name', 'startDate', 'submit', 'defaultName', 'forbidden', 'invalid', 'error', 'sourceUnavailable', 'loadError']) {
        expect(typeof copy[key], key).toBe('string')
      }
      expect(copy.validation.name).toBeTruthy()
      expect(copy.validation.startDate).toBeTruthy()
    }
    expect(arMessages.projects.copy.defaultName).toContain('{name}')
  })
})
