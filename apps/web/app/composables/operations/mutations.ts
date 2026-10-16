import type { QueryClient } from '@tanstack/vue-query'
import type { ZodType } from 'zod'
import { OperationProcessSchema, OperationRequestSchema, type OperationAction, type OperationProcess, type OperationProcessBody, type OperationRequest } from '@webvue/contracts'

export type OperationApi = <T>(path: string, options: { method?: string; body?: unknown; query?: Record<string, unknown>; schema?: ZodType<T> }) => Promise<T>
export type RequestMutation =
  | { action: 'create'; body: { name: string; description: string; process_id: number; target_id?: number } }
  | { action: 'edit'; id: number; body: { name: string; description: string; revision: number } }
  | { action: OperationAction; id: number; body: { revision: number; comment?: string } }
  | { action: 'attach'; id: number; body: { name: string; mimetype: string; data: string } }
  | { action: 'removeAttachment'; id: number; attachmentId: number }
export type ProcessMutation =
  | { action: 'create'; body: OperationProcessBody }
  | { action: 'edit'; id: number; body: OperationProcessBody }
  | { action: 'publish' | 'archive'; id: number; body: { revision: number } }

export function operationRequestMutationOptions(api: OperationApi, client: QueryClient) {
  return {
    retry: false as const,
    mutationFn: (input: RequestMutation): Promise<OperationRequest> => {
      const root = '/api/v1/operations/requests'
      if (input.action === 'create') return api(root, { method: 'POST', body: input.body, schema: OperationRequestSchema })
      const path = `${root}/${input.id}`
      if (input.action === 'removeAttachment') return api(`${path}/attachments/${input.attachmentId}`, { method: 'DELETE', schema: OperationRequestSchema })
      return api(input.action === 'edit' ? path : `${path}/${input.action === 'attach' ? 'attachments' : input.action}`, {
        method: input.action === 'edit' ? 'PATCH' : 'POST', body: input.body, schema: OperationRequestSchema,
      })
    },
    onSuccess: async (record: OperationRequest) => {
      client.setQueryData(['operations', 'requests', 'detail', record.id], record)
      await client.invalidateQueries({ queryKey: ['operations', 'requests', 'list'] })
    },
  }
}
export function operationProcessMutationOptions(api: OperationApi, client: QueryClient) {
  return {
    retry: false as const,
    mutationFn: (input: ProcessMutation): Promise<OperationProcess> => {
      const root = '/api/v1/operations/processes'
      const path = input.action === 'create' ? root : `${root}/${input.id}`
      return api(input.action === 'publish' || input.action === 'archive' ? `${path}/${input.action}` : path, {
        method: input.action === 'edit' ? 'PATCH' : 'POST', body: input.body, schema: OperationProcessSchema,
      })
    },
    onSuccess: async (process: OperationProcess) => {
      client.setQueryData(['operations', 'processes', 'detail', process.id], process)
      await client.invalidateQueries({ queryKey: ['operations', 'processes', 'list'] })
    },
  }
}
