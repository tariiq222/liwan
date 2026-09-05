<script setup lang="ts">
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { useCreateDepartment, useHrDepartments, useUpdateDepartment, type HrDepartment } from '@/composables/useHrDepartments'
import { useHrEmployees } from '@/composables/useHrEmployees'

const props = defineProps<{ open: boolean; selectedId?: number | null }>()
const emit = defineEmits<{ 'update:open': [boolean]; select: [id: number] }>()

const { t } = useI18n()
const { data, isLoading } = useHrDepartments()
const { data: employeeData } = useHrEmployees({})
const { mutateAsync: createDept, isPending: creating } = useCreateDepartment()
const { mutateAsync: updateDept, isPending: updating } = useUpdateDepartment()

const departments = computed(() => data.value?.items ?? [])
const employees = computed(() => employeeData.value?.items ?? [])

const byId = computed(() => {
  const map = new Map<number, HrDepartment>()
  for (const dept of departments.value) map.set(dept.id, dept)
  return map
})

function depthOf(dept: HrDepartment): number {
  let depth = 0
  let current: HrDepartment | undefined = dept
  const seen = new Set<number>()
  while (current?.parent_id && !seen.has(current.id)) {
    seen.add(current.id)
    current = byId.value.get(current.parent_id)
    if (!current) break
    depth += 1
  }
  return depth
}

const sorted = computed(() => {
  return departments.value
    .map((dept) => ({ dept, depth: depthOf(dept) }))
    .sort((a, b) => a.dept.name.localeCompare(b.dept.name, 'ar'))
})

const name = ref('')
const parentId = ref<number | null>(null)
const managerId = ref<number | null>(null)
const editingId = ref<number | null>(null)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    resetForm()
  },
)

function resetForm() {
  editingId.value = null
  name.value = ''
  parentId.value = null
  managerId.value = null
}

function selectDept(dept: HrDepartment) {
  editingId.value = dept.id
  name.value = dept.name
  parentId.value = dept.parent_id
  managerId.value = dept.manager?.id ?? null
  emit('select', dept.id)
}

async function submit() {
  const trimmed = name.value.trim()
  if (!trimmed) return
  try {
    if (editingId.value) {
      await updateDept({
        id: editingId.value,
        patch: { name: trimmed, parent_id: parentId.value, manager_id: managerId.value },
      })
    } else {
      const created = await createDept({
        name: trimmed,
        parent_id: parentId.value,
        manager_id: managerId.value,
      })
      emit('select', created.id)
      resetForm()
    }
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : t('errors.generic'))
  }
}

function onParentChange(value: unknown) {
  parentId.value = !value || value === 'none' ? null : Number(value)
}
function onManagerChange(value: unknown) {
  managerId.value = !value || value === 'none' ? null : Number(value)
}
</script>

<template>
  <Sheet :open="open" @update:open="(v) => emit('update:open', v)">
    <SheetContent class="w-full overflow-y-auto sm:max-w-md">
      <SheetHeader>
        <SheetTitle>{{ t('hr.depts.title') }}</SheetTitle>
      </SheetHeader>
      <div class="flex flex-col gap-4 ps-4 pe-4 pb-4">
        <form class="grid gap-3" @submit.prevent="submit">
          <div class="grid gap-2">
            <Label for="hr-dept-name">{{ t('hr.depts.name') }}</Label>
            <Input id="hr-dept-name" v-model="name" required />
          </div>
          <div class="grid gap-2">
            <Label for="hr-dept-parent">{{ t('hr.depts.parent') }}</Label>
            <Select :model-value="parentId ? String(parentId) : 'none'" @update:model-value="onParentChange">
              <SelectTrigger id="hr-dept-parent" class="w-full">
                <SelectValue :placeholder="t('hr.depts.none')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{{ t('hr.depts.none') }}</SelectItem>
                <SelectItem
                  v-for="dept in departments.filter((d) => d.id !== editingId)"
                  :key="dept.id"
                  :value="String(dept.id)"
                >
                  {{ dept.name }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="grid gap-2">
            <Label for="hr-dept-manager">{{ t('hr.depts.manager') }}</Label>
            <Select :model-value="managerId ? String(managerId) : 'none'" @update:model-value="onManagerChange">
              <SelectTrigger id="hr-dept-manager" class="w-full">
                <SelectValue :placeholder="t('hr.depts.none')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{{ t('hr.depts.none') }}</SelectItem>
                <SelectItem v-for="emp in employees" :key="emp.id" :value="String(emp.id)">{{ emp.name }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button type="submit" size="sm" :disabled="creating || updating || !name.trim()">
              {{ editingId ? t('app.save') : t('hr.depts.new') }}
            </Button>
            <Button v-if="editingId" type="button" variant="outline" size="sm" @click="resetForm">
              {{ t('app.cancel') }}
            </Button>
          </div>
        </form>

        <div v-if="isLoading" class="grid gap-2">
          <Skeleton v-for="n in 4" :key="n" class="h-8 w-full" />
        </div>
        <ul v-else class="grid gap-1">
          <li v-for="{ dept, depth } in sorted" :key="dept.id">
            <button
              type="button"
              class="w-full rounded-md px-2 py-1.5 text-start text-sm hover:bg-accent"
              :class="{ 'bg-accent': (selectedId ?? editingId) === dept.id }"
              :style="{ paddingInlineStart: `${0.5 + depth}rem` }"
              @click="selectDept(dept)"
            >
              <span class="font-medium">{{ dept.name }}</span>
              <span v-if="dept.manager" class="ms-2 text-muted-foreground">{{ dept.manager.name }}</span>
            </button>
          </li>
        </ul>
      </div>
    </SheetContent>
  </Sheet>
</template>
