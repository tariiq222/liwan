<script setup lang="ts">
export interface SharedAttachment { id: number; name: string; url: string }
export interface SharedAttachmentLabels {
  empty: string
  upload: string
  help: string
  delete: string
  deleteConfirm: string
  confirm: string
  keep: string
}

// The attachment list of a record: links, an inline delete confirmation and one upload field.
// It runs no request: the app passes the rows and two async handlers (`uploadFile`, `deleteFile`)
// that report their own failure through `error`. The handlers are props, not events, so the
// field is cleared and the delete confirmation closes only once the app has finished.
const props = withDefaults(defineProps<{
  attachments: SharedAttachment[]
  labels: SharedAttachmentLabels
  uploadFile: (file: File) => Promise<void>
  deleteFile: (id: number) => Promise<void>
  accept?: string
  canWrite?: boolean
  loading?: boolean
  loadError?: unknown
  error?: string
  uploadId?: string
}>(), { canWrite: false, uploadId: 'attachment-upload' })
defineEmits<{ retry: [] }>()

const hydrated = useHydrated()
const fileField = ref<{ reset: () => void } | null>(null)
const pendingDeleteId = ref<number | null>(null)
// Refs read back synchronously, so these are in-flight guards set before the first await.
const uploadBusy = ref(false)
const deleteBusy = ref(false)

async function onFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || uploadBusy.value) return
  uploadBusy.value = true
  try {
    await props.uploadFile(file)
  } finally {
    // Clearing the input lets the same file be chosen again after an error.
    fileField.value?.reset()
    uploadBusy.value = false
  }
}

async function confirmDelete(id: number) {
  if (pendingDeleteId.value !== id || deleteBusy.value || !props.canWrite) return
  deleteBusy.value = true
  try {
    await props.deleteFile(id)
    await nextTick()
    if (!props.error) pendingDeleteId.value = null
  } finally {
    deleteBusy.value = false
  }
}
</script>

<template>
  <div class="space-y-3">
    <SharedPageState :loading="loading" :error="loadError" :empty="!attachments.length" :empty-text="labels.empty" @retry="$emit('retry')">
      <ul class="divide-y divide-default">
        <li v-for="attachment in attachments" :key="attachment.id" class="grid min-w-0 gap-2 py-2 text-sm">
          <div class="flex items-center gap-2">
            <a :href="attachment.url" target="_blank" rel="noopener" class="min-w-0 flex-1 truncate text-brand-link underline">{{ attachment.name }}</a>
            <UButton
              v-if="canWrite && pendingDeleteId !== attachment.id"
              type="button"
              variant="ghost"
              size="sm"
              color="error"
              square
              icon="i-lucide-trash-2"
              :aria-label="labels.delete"
              :disabled="!hydrated || deleteBusy || pendingDeleteId !== null"
              @click="pendingDeleteId = attachment.id"
            />
          </div>
          <SharedInlineConfirm
            v-if="pendingDeleteId === attachment.id"
            :title="labels.deleteConfirm"
            :confirm-label="labels.confirm"
            :cancel-label="labels.keep"
            :pending="deleteBusy"
            @confirm="confirmDelete(attachment.id)"
            @cancel="pendingDeleteId = null"
          />
        </li>
      </ul>
    </SharedPageState>

    <div v-if="canWrite" class="grid gap-2">
      <label :for="uploadId" class="text-sm font-medium text-default">{{ labels.upload }}</label>
      <SharedFileField
        :id="uploadId"
        ref="fileField"
        :accept="accept"
        class="w-full min-w-0"
        :disabled="!hydrated || uploadBusy"
        @change="onFileChange"
      />
      <p class="text-xs text-muted">{{ labels.help }}</p>
    </div>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
  </div>
</template>
