import { OperationPurposeSchema, OperationStateSchema } from '@webvue/contracts'
import { ref } from 'vue'

export function operationListLocation(path: string, query: Record<string, unknown>, hash = '') {
  const search = new URLSearchParams()
  for (const key of ['q', 'state', 'purpose', 'page']) {
    const value = query[key]
    if (typeof value === 'string' && value) search.set(key, value)
  }
  return `${path}${search.size ? `?${search}` : ''}${hash}`
}
export function safeOperationReturnTo(value: unknown, fallback: string) {
  return typeof value === 'string' && /^\/(?:operations(?:\/(?:pending|monitoring|processes))?|account\/requests)(?:[?#]|$)/.test(value) ? value : fallback
}
export function requestFormErrors(form: { name: string; process_id: number | null }, edit: boolean) {
  const errors: Record<string, string> = {}
  if (!form.name.trim()) errors.name = 'required'
  if (!edit && (!Number.isInteger(form.process_id) || Number(form.process_id) < 1)) errors.process_id = 'required'
  return errors
}
export function processFormErrors(form: { name: string; steps: { name: string; reviewer_ids: number[] }[] }) {
  const errors: Record<string, string> = {}
  if (!form.name.trim()) errors.name = 'required'
  if (!form.steps.length) errors.steps = 'stepsRequired'
  form.steps.forEach((step, index) => {
    if (!step.name.trim()) errors[`steps.${index}.name`] = 'required'
    if (!step.reviewer_ids.length || step.reviewer_ids.some(id => !Number.isInteger(id) || id < 1)) errors[`steps.${index}.reviewer_ids`] = 'reviewersRequired'
  })
  return errors
}
export function createOperationSubmitGuard() {
  const pending = ref(false)
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    if (pending.value) return undefined
    pending.value = true
    try { return await fn() } finally { pending.value = false }
  }
  return { pending, run }
}
export function operationErrorKey(error: unknown) {
  const e = error as { status?: number; code?: string } | null
  return e?.status === 409 ? 'conflict' : e?.code === 'execution_failed' ? 'executionFailed' : e?.code === 'reviewer_not_eligible' ? 'reviewerNotEligible' : e?.status === 403 ? 'forbidden' : 'save'
}
export function operationId(value: unknown) {
  const id = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export async function operationAttachmentBody(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const chunks: string[] = []
  for (let index = 0; index < bytes.length; index += 8192) chunks.push(String.fromCharCode(...bytes.subarray(index, index + 8192)))
  return { name: file.name, mimetype: file.type || 'application/octet-stream', data: btoa(chunks.join('')) }
}

export function operationStateChoices(t: (key: string) => string) { return [{ label: t('operations.allStates'), value: 'all' }, ...OperationStateSchema.options.map(value => ({ label: t(`operations.states.${value}`), value }))] }
export function operationStateFromSelection(value: unknown) { const parsed = OperationStateSchema.safeParse(value); return parsed.success ? parsed.data : undefined }
export function operationPurposeChoices(t: (key: string) => string) { return [{ label: t('operations.allPurposes'), value: 'all' }, ...OperationPurposeSchema.options.map(value => ({ label: t(`operations.purposes.${value}`), value }))] }
export function operationPurposeFromSelection(value: unknown) { const parsed = OperationPurposeSchema.safeParse(value); return parsed.success ? parsed.data : undefined }
