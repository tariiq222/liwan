// What a record attachment upload accepts and how the browser reads it. Shared by every app that
// attaches files; the server stays the authority for the type and size rules.

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const ATTACHMENT_ACCEPT = '.txt,.pdf,.png,.jpg,.jpeg,.docx,.xlsx,text/plain,application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

const ALLOWED_TYPES: Record<string, readonly string[]> = {
  pdf: ['application/pdf'],
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  txt: ['text/plain'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
}

export type AttachmentProblem = 'empty' | 'tooLarge' | 'type'

export function attachmentProblem(file: { name: string; size: number; type: string }): AttachmentProblem | null {
  const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase() : ''
  const allowed = ALLOWED_TYPES[extension]
  if (!allowed) return 'type'
  // A browser may report no type at all; a reported type must still match the extension.
  if (file.type && !allowed.includes(file.type.toLowerCase())) return 'type'
  if (file.size <= 0) return 'empty'
  if (file.size > MAX_ATTACHMENT_BYTES) return 'tooLarge'
  return null
}
