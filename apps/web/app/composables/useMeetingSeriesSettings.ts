import { useMutation, useQueryClient } from '@tanstack/vue-query'
import {
  MeetingSeriesDetailSchema,
  MeetingSeriesPatchSchema,
  type MeetingSeriesPatch,
} from '@nasq/contracts'
import { invalidateMeetingCaches } from './meetingKeys'

export function usePatchMeetingSeriesSettings() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: MeetingSeriesPatch }) => $api(`/api/v1/meeting-series/${id}`, {
      method: 'PATCH',
      body: MeetingSeriesPatchSchema.parse(body),
      schema: MeetingSeriesDetailSchema,
    }),
    onSuccess: () => invalidateMeetingCaches(qc),
  })
}
