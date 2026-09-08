import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  NotificationDigestDetailSchema,
  NotificationListSchema,
  NotificationReadResultSchema,
  type Notification,
} from '@nasq/contracts'

export const notificationKeys = {
  all: ['notifications'] as const,
  page: ['notifications', 'page'] as const,
}

export const NOTIFICATION_PAGE_SIZE = 50

export function useNotifications() {
  const { $api } = useApi()
  return useQuery({
    queryKey: notificationKeys.all,
    queryFn: () => $api('/api/v1/notifications', { query: { limit: NOTIFICATION_PAGE_SIZE, offset: 0 }, schema: NotificationListSchema }),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  })
}

export function useNotificationsPage() {
  const { $api } = useApi()
  return useInfiniteQuery({
    queryKey: notificationKeys.page,
    queryFn: ({ pageParam }) => $api('/api/v1/notifications', {
      query: { limit: NOTIFICATION_PAGE_SIZE, offset: pageParam },
      schema: NotificationListSchema,
    }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  })
}

export function useMarkNotificationRead() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (id: number) => $api(`/api/v1/notifications/${id}/read`, { method: 'POST', body: {}, schema: NotificationReadResultSchema }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.all })
      qc.invalidateQueries({ queryKey: notificationKeys.page })
    },
  })
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: () => $api('/api/v1/notifications/read-all', { method: 'POST', body: {}, schema: NotificationReadResultSchema }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.all })
      qc.invalidateQueries({ queryKey: notificationKeys.page })
    },
  })
}

export const DIGEST_PAGE_SIZE = 50

export function useNotificationDigest(id: { value: number | null }) {
  const { $api } = useApi()
  return useInfiniteQuery({
    queryKey: computed(() => ['notification-digest', id.value] as const),
    enabled: computed(() => !!id.value),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => $api(`/api/v1/notification-digests/${id.value}`, {
      query: { limit: DIGEST_PAGE_SIZE, offset: pageParam },
      schema: NotificationDigestDetailSchema,
    }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
  })
}

export function isDigestNotification(item: Notification): item is Extract<Notification, { kind: 'overdue_digest' }> {
  return item.kind === 'overdue_digest'
}

export function isMeetingNotification(item: Notification): item is Extract<Notification, { meeting_id: number }> {
  return item.kind.startsWith('meeting_')
}

export type { Notification }

