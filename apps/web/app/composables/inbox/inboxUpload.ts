import { InboxAttachmentSchema, type InboxAttachment } from '@webvue/contracts'
import { ApiError } from '@/composables/useApi'

/**
 * Uploads one file to a conversation (multipart field `file`) and reports its progress. fetch has no upload progress,
 * so this is the one XMLHttpRequest of the inbox. The browser sends the session cookie; a refusal is an ApiError.
 */
export function uploadInboxFile(conversationId: number, file: File, onProgress: (fraction: number) => void): Promise<InboxAttachment> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', `/api/v1/inbox/conversations/${conversationId}/uploads`)
    request.responseType = 'json'
    request.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total) }
    request.onerror = () => reject(new ApiError(0, 'http_error', 'network'))
    request.onload = () => {
      const body = request.response as { code?: string; message?: string } | null
      if (request.status >= 200 && request.status < 300) {
        const parsed = InboxAttachmentSchema.safeParse(body)
        if (parsed.success) resolve(parsed.data)
        else reject(new ApiError(request.status, 'invalid_response', 'unexpected upload answer'))
      } else reject(new ApiError(request.status, body?.code ?? 'http_error', body?.message ?? ''))
    }
    const form = new FormData()
    form.append('file', file)
    request.send(form)
  })
}
