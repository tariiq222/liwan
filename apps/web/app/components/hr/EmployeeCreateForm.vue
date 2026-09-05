<script setup lang="ts">
import { toast } from "vue-sonner";
import type { HrDepartment } from "@/composables/useHrDepartments";
import {
  useCreateHrEmployee,
  type HrEmployee,
} from "@/composables/useHrEmployees";
defineProps<{ departments: HrDepartment[]; employees: HrEmployee[] }>();
const emit = defineEmits<{ created: [employee: HrEmployee] }>();
const { t } = useI18n();
const hydrated = useHydrated();
const name = ref("");
const email = ref("");
const phone = ref("");
const jobTitle = ref("");
const departmentId = ref<number | null>(null);
const managerId = ref<number | null>(null);
const { mutateAsync: create, isPending } = useCreateHrEmployee();
function idOrNull(value: unknown) {
  return !value || value === "none" ? null : Number(value);
}
async function submit() {
  if (!hydrated.value || !name.value.trim()) return;
  try {
    emit(
      "created",
      await create({
        name: name.value.trim(),
        work_email: email.value.trim(),
        work_phone: phone.value,
        job_title: jobTitle.value,
        department_id: departmentId.value,
        parent_id: managerId.value,
      }),
    );
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t("errors.generic"));
  }
}
</script>
<template>
  <form class="grid gap-3" @submit.prevent="submit">
    <div class="grid gap-2">
      <Label for="hr-create-name">{{ t("hr.employee.name") }}</Label
      ><Input
        id="hr-create-name"
        v-model="name"
        :disabled="!hydrated || isPending"
        required
      />
    </div>
    <div class="grid gap-2">
      <Label for="hr-create-email">{{ t("hr.employee.workEmail") }}</Label
      ><Input
        id="hr-create-email"
        v-model="email"
        type="email"
        :disabled="!hydrated || isPending"
      />
    </div>
    <div class="grid gap-2">
      <Label for="hr-create-phone">{{ t("hr.employee.workPhone") }}</Label
      ><Input
        id="hr-create-phone"
        v-model="phone"
        :disabled="!hydrated || isPending"
      />
    </div>
    <div class="grid gap-2">
      <Label for="hr-create-job">{{ t("hr.employee.jobTitle") }}</Label
      ><Input
        id="hr-create-job"
        v-model="jobTitle"
        :disabled="!hydrated || isPending"
      />
    </div>
    <div class="grid gap-2">
      <Label>{{ t("hr.employee.department") }}</Label
      ><Select
        :model-value="departmentId ? String(departmentId) : 'none'"
        :disabled="!hydrated || isPending"
        @update:model-value="departmentId = idOrNull($event)"
        ><SelectTrigger><SelectValue /></SelectTrigger
        ><SelectContent
          ><SelectItem value="none">{{ t("hr.depts.none") }}</SelectItem
          ><SelectItem
            v-for="department in departments"
            :key="department.id"
            :value="String(department.id)"
            >{{ department.name }}</SelectItem
          ></SelectContent
        ></Select
      >
    </div>
    <div class="grid gap-2">
      <Label>{{ t("hr.employee.manager") }}</Label
      ><Select
        :model-value="managerId ? String(managerId) : 'none'"
        :disabled="!hydrated || isPending"
        @update:model-value="managerId = idOrNull($event)"
        ><SelectTrigger><SelectValue /></SelectTrigger
        ><SelectContent
          ><SelectItem value="none">{{ t("hr.depts.none") }}</SelectItem
          ><SelectItem
            v-for="employee in employees"
            :key="employee.id"
            :value="String(employee.id)"
            >{{ employee.name }}</SelectItem
          ></SelectContent
        ></Select
      >
    </div>
    <Button type="submit" :disabled="!hydrated || isPending || !name.trim()">{{
      t("app.save")
    }}</Button>
  </form>
</template>
