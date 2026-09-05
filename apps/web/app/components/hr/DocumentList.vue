<script setup lang="ts">
import { Plus, Search } from 'lucide-vue-next'
import { refDebounced } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { useCreateDocument, useHrDocument, useHrDocuments, useUpdateDocument, type HrDocument } from '@/composables/useHrDocuments'
import DocumentEditor from './DocumentEditor.vue'
import DocumentReader from './DocumentReader.vue'

const props = defineProps<{ departmentId: number; canWrite: boolean }>()

const { t } = useI18n()
const search = ref('')
const debouncedSearch = refDebounced(search, 300)
const selectedId = ref<number | null>(null)
const createOpen = ref(false)
const newName = ref('')

const params = computed(() => ({
  q: debouncedSearch.value || undefined,
  department_id: props.departmentId,
}))

const { data, isLoading } = useHrDocuments(params)
const selectedRef = computed(() => selectedId.value)
const { data: selected } = useHrDocument(selectedRef)
const { mutateAsync: createDoc, isPending: creating } = useCreateDocument()
const { mutateAsync: updateDoc } = useUpdateDocument()

const items = computed<HrDocument[]>(() => data.value?.items ?? [])

function formatDate(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString()
}

async function submitCreate() {
  const name = newName.value.trim()
  if (!name) return
  try {
    const created = await createDoc({ name, body: '', department_id: props.departmentId })
    createOpen.value = false
    newName.value = ''
    selectedId.value = created.id
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : t('errors.generic'))
  }
}

async function onTitleBlur(event: Event) {
  const value = (event.target as HTMLInputElement).value.trim()
  if (!selected.value || !value || value === selected.value.name) return
  try {
    await updateDoc({ id: selected.value.id, patch: { name: value } })
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : t('errors.generic'))
  }
}

async function onBody(html: string) {
  if (!selected.value) return
  try {
    await updateDoc({ id: selected.value.id, patch: { body: html } })
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : t('errors.generic'))
  }
}

watch(
  () => props.departmentId,
  () => {
    selectedId.value = null
    search.value = ''
  },
)
</script>

<template>
  <section class="space-y-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-semibold">{{ t('hr.docs.title') }}</h2>
      <Button v-if="canWrite" size="sm" class="gap-1.5" @click="createOpen = true">
        <Plus class="size-4" />{{ t('hr.docs.new') }}
      </Button>
    </div>
    <div class="relative min-w-48">
      <Search class="pointer-events-none absolute start-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input v-model="search" :placeholder="t('hr.docs.search')" class="ps-8" />
    </div>
    <div class="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="text-start">{{ t('hr.docs.columns.name') }}</TableHead>
            <TableHead class="text-start">{{ t('hr.docs.columns.updated') }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <template v-if="isLoading">
            <TableRow v-for="n in 3" :key="n">
              <TableCell><Skeleton class="h-5 w-full" /></TableCell>
              <TableCell><Skeleton class="h-5 w-24" /></TableCell>
            </TableRow>
          </template>
          <TableEmpty v-else-if="items.length === 0" :colspan="2">
            <div class="flex flex-col items-center gap-2 text-center">
              <p class="text-muted-foreground">{{ t('hr.docs.empty') }}</p>
              <Button v-if="canWrite" size="sm" @click="createOpen = true">{{ t('hr.docs.new') }}</Button>
            </div>
          </TableEmpty>
          <template v-else>
            <TableRow
              v-for="doc in items"
              :key="doc.id"
              class="cursor-pointer"
              @click="selectedId = doc.id"
            >
              <TableCell class="text-start">{{ doc.name }}</TableCell>
              <TableCell class="text-start text-muted-foreground">{{ formatDate(doc.write_date) }}</TableCell>
            </TableRow>
          </template>
        </TableBody>
      </Table>
    </div>

    <Sheet :open="selectedId != null" @update:open="(v) => !v && (selectedId = null)">
      <SheetContent class="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{{ selected?.name || t('hr.docs.title') }}</SheetTitle>
        </SheetHeader>
        <div v-if="selected" class="grid gap-4 ps-4 pe-4 pb-4">
          <template v-if="canWrite">
            <div class="grid gap-2">
              <Label for="hr-doc-title">{{ t('hr.docs.columns.name') }}</Label>
              <Input id="hr-doc-title" :model-value="selected.name" @blur="onTitleBlur" />
            </div>
            <DocumentEditor :key="selected.id" :model-value="selected.body" :document-id="selected.id" @update:model-value="onBody" />
            <div v-if="selected.attachment_ids.length" class="grid gap-2">
              <h3 class="text-sm font-medium">{{ t('hr.docs.attachments') }}</h3>
              <ul class="grid gap-1 text-sm">
                <li v-for="att in selected.attachment_ids" :key="att.id">
                  <a :href="`/web/content/${att.id}`" class="underline" target="_blank" rel="noreferrer">{{ att.name }}</a>
                </li>
              </ul>
            </div>
          </template>
          <DocumentReader v-else :document="selected" />
        </div>
        <div v-else class="ps-4 pe-4 pb-4">
          <Skeleton class="h-40 w-full" />
        </div>
      </SheetContent>
    </Sheet>

    <Dialog :open="createOpen" @update:open="(v) => (createOpen = v)">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ t('hr.docs.new') }}</DialogTitle>
        </DialogHeader>
        <form class="grid gap-4" @submit.prevent="submitCreate">
          <div class="grid gap-2">
            <Label for="hr-doc-new-name">{{ t('hr.docs.newTitle') }}</Label>
            <Input id="hr-doc-new-name" v-model="newName" required />
          </div>
          <DialogFooter>
            <Button type="submit" :disabled="creating || !newName.trim()">{{ t('app.create') }}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </section>
</template>
