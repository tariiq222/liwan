import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const tasks = resolve(import.meta.dirname, '..')
const read = (file: string) => readFileSync(resolve(tasks, file), 'utf8')
const locale = (lang: string, file: string, path: string) => path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../../../i18n/locales/${lang}/${file}.json`), 'utf8')))

describe('the task record answers every change', () => {
  it('draws the header deadline as the lists do (DESIGN.md tones, no tag without a deadline)', () => {
    const panel = read('TaskDetailPanel.vue')
    expect(panel).toContain('deadlineTagView(current, t)')
    expect(panel).not.toContain('deadlineTone')
  })

  it('toasts each completion step, each attachment change and the description save', () => {
    const completion = read('TaskCompletionApproval.vue')
    for (const step of ['requested', 'accepted', 'returned', 'withdrawn']) expect(completion).toContain(`tasks.completion.done.${step}`)
    const attachments = read('TaskAttachments.vue')
    for (const key of ['attachments.uploaded', 'attachments.deleted']) expect(attachments).toContain(key)
    expect(read('TaskDescription.vue')).toContain('tasks.descriptionField.saved')
  })

  it.each(['ar', 'en'])('has the %s strings for those toasts', (lang) => {
    for (const [file, path] of [['tasks', 'tasks.completion.done.requested'], ['tasks', 'tasks.completion.done.accepted'], ['tasks', 'tasks.completion.done.returned'], ['tasks', 'tasks.completion.done.withdrawn'], ['tasks', 'tasks.descriptionField.saved'], ['attachments', 'attachments.uploaded'], ['attachments', 'attachments.deleted']] as const) {
      expect(typeof locale(lang, file, path), `${lang} ${path}`).toBe('string')
    }
  })
})
